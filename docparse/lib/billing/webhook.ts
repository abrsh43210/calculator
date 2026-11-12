import type Stripe from "stripe";
import type { BillingDeps } from "@/lib/billing/customer";
import { highestPlan, isOverageLookupKey, planFromLookupKey, type PlanId } from "@/lib/billing/plans";

/** Subscription statuses that keep paid features on. past_due keeps access during dunning. */
const ENTITLED_STATUSES = new Set<Stripe.Subscription.Status>(["active", "trialing", "past_due"]);

export const HANDLED_EVENTS = new Set<string>([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
]);

export type WebhookOutcome =
  | { status: "processed"; subscriptionId?: string; userId?: string; plan?: PlanId }
  | { status: "duplicate" }
  | { status: "ignored"; reason: string };

/** Thrown for problems Stripe should retry (the route answers 500). */
export class RetryableWebhookError extends Error {}

const toIso = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : null);
const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : v?.id ?? null);

/**
 * Handles one verified Stripe event. Idempotent: events already recorded in
 * stripe_events are skipped, and subscription state is always re-fetched from
 * Stripe so out-of-order delivery can't roll a user back to stale data.
 */
export async function handleStripeEvent(deps: BillingDeps, event: Stripe.Event): Promise<WebhookOutcome> {
  if (!HANDLED_EVENTS.has(event.type)) return { status: "ignored", reason: `unhandled type ${event.type}` };

  const { data: seen, error: seenError } = await deps.db
    .from("stripe_events")
    .select("id")
    .eq("id", event.id)
    .maybeSingle();
  if (seenError) throw new RetryableWebhookError(`stripe_events lookup failed: ${seenError.message}`);
  if (seen) return { status: "duplicate" };

  const subscriptionId = subscriptionIdFromEvent(event);
  let outcome: WebhookOutcome;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    await linkCustomerFromCheckout(deps, session);
  }

  if (subscriptionId) {
    outcome = await syncSubscription(deps, subscriptionId, hintedUserId(event));
  } else {
    outcome = { status: "ignored", reason: "event has no subscription" };
  }

  const { error: recordError } = await deps.db
    .from("stripe_events")
    .upsert({ id: event.id, type: event.type }, { onConflict: "id", ignoreDuplicates: true });
  if (recordError) {
    // State is already synced and the sync is idempotent, so a retry is harmless.
    console.warn("[docparse] could not record stripe event", event.id, recordError.message);
  }
  return outcome;
}

function subscriptionIdFromEvent(event: Stripe.Event): string | null {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      return s.mode === "subscription" ? idOf(s.subscription) : null;
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      return idOf(inv.parent?.subscription_details?.subscription);
    }
    default:
      return (event.data.object as Stripe.Subscription).id;
  }
}

function hintedUserId(event: Stripe.Event): string | null {
  const obj = event.data.object as { metadata?: Record<string, string> | null; client_reference_id?: string | null };
  return obj.client_reference_id ?? obj.metadata?.user_id ?? null;
}

async function linkCustomerFromCheckout(deps: BillingDeps, session: Stripe.Checkout.Session) {
  const userId = session.client_reference_id ?? session.metadata?.user_id;
  const customerId = idOf(session.customer);
  if (!userId || !customerId) return;
  const { error } = await deps.db
    .from("profiles")
    .update({ stripe_customer_id: customerId })
    .eq("id", userId)
    .is("stripe_customer_id", null);
  if (error) throw new RetryableWebhookError(`link customer failed: ${error.message}`);
}

async function resolveUserId(
  deps: BillingDeps,
  sub: Stripe.Subscription,
  hint: string | null,
): Promise<string | null> {
  const customerId = idOf(sub.customer);
  if (customerId) {
    const { data, error } = await deps.db
      .from("profiles")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    if (error) throw new RetryableWebhookError(`profile lookup failed: ${error.message}`);
    if (data?.id) return data.id as string;
  }
  return sub.metadata?.user_id ?? hint ?? null;
}

export async function syncSubscription(
  deps: BillingDeps,
  subscriptionId: string,
  userHint: string | null = null,
): Promise<WebhookOutcome> {
  const sub = await deps.stripe.subscriptions.retrieve(subscriptionId);
  const userId = await resolveUserId(deps, sub, userHint);
  if (!userId) {
    // Not ours (e.g. created by hand in the dashboard). Acknowledge so Stripe stops retrying.
    console.warn("[docparse] subscription has no matching user", subscriptionId);
    return { status: "ignored", reason: "no matching user" };
  }

  const items = sub.items.data;
  const baseItem = items.find((i) => planFromLookupKey(i.price?.lookup_key));
  const overageItem = items.find((i) => isOverageLookupKey(i.price?.lookup_key));
  const match = baseItem ? planFromLookupKey(baseItem.price.lookup_key) : null;
  if (!baseItem || !match) {
    console.warn("[docparse] subscription has no DocParse plan price", {
      subscriptionId,
      lookupKeys: items.map((i) => i.price?.lookup_key),
    });
    return { status: "ignored", reason: "no DocParse plan price on subscription" };
  }

  const { error: upsertError } = await deps.db.from("subscriptions").upsert(
    {
      id: sub.id,
      user_id: userId,
      stripe_customer_id: idOf(sub.customer),
      status: sub.status,
      plan: match.plan,
      billing_cycle: match.cycle,
      price_id: baseItem.price.id,
      overage_item_id: overageItem?.id ?? null,
      quantity: baseItem.quantity ?? 1,
      cancel_at_period_end: sub.cancel_at_period_end,
      current_period_start: toIso(baseItem.current_period_start),
      current_period_end: toIso(baseItem.current_period_end),
      canceled_at: toIso(sub.canceled_at),
      ended_at: toIso(sub.ended_at),
    },
    { onConflict: "id" },
  );
  if (upsertError) throw new RetryableWebhookError(`subscription upsert failed: ${upsertError.message}`);

  const effectivePlan = await recomputeProfilePlan(deps, userId);
  return { status: "processed", subscriptionId: sub.id, userId, plan: effectivePlan };
}

/** A user's plan is the best plan among their entitled subscriptions, else free. */
export async function recomputeProfilePlan(deps: BillingDeps, userId: string): Promise<PlanId> {
  const { data, error } = await deps.db.from("subscriptions").select("plan, status").eq("user_id", userId);
  if (error) throw new RetryableWebhookError(`subscription read failed: ${error.message}`);

  const plans = (data ?? [])
    .filter((s) => ENTITLED_STATUSES.has(s.status as Stripe.Subscription.Status))
    .map((s) => s.plan as PlanId);
  const plan = highestPlan(plans);

  const { error: updateError } = await deps.db.from("profiles").update({ plan }).eq("id", userId);
  if (updateError) throw new RetryableWebhookError(`profile plan update failed: ${updateError.message}`);
  return plan;
}
