import type Stripe from "stripe";
import { HttpError } from "@/lib/http";
import {
  OVERAGE_LOOKUP_KEYS,
  baseLookupKey,
  isBillingCycle,
  isOverageLookupKey,
  isPaidPlan,
  planFromLookupKey,
  type BillingCycle,
  type PaidPlanId,
} from "@/lib/billing/plans";
import { resolvePriceIds } from "@/lib/billing/prices";
import { getOrCreateCustomer, type BillingDeps } from "@/lib/billing/customer";

const LIVE_STATUSES = ["active", "trialing", "past_due"];

export interface CheckoutInput {
  user: { id: string; email: string };
  plan: unknown;
  /** "monthly" (default) or "annual". */
  cycle?: unknown;
  siteUrl: string;
}

export interface CheckoutResult {
  url: string;
  /**
   * "checkout": new subscription, redirect to Stripe Checkout.
   * "updated": existing subscription switched plan in place (prorated); url is the billing page.
   * "portal": already on this exact plan; url is the Customer Portal.
   */
  kind: "checkout" | "updated" | "portal";
}

/**
 * Starts a Stripe Checkout session for Pro or Business. Users who already
 * have a live subscription get it switched in place (with proration) so
 * nobody ends up with two subscriptions. The Customer Portal can't swap a
 * subscription that also carries a metered overage item, so we do it here.
 */
export async function createCheckout(deps: BillingDeps, input: CheckoutInput): Promise<CheckoutResult> {
  if (!isPaidPlan(input.plan)) {
    throw new HttpError(400, "invalid_plan", 'plan must be "pro" or "business".');
  }
  const plan: PaidPlanId = input.plan;
  const cycle: BillingCycle = input.cycle == null ? "monthly" : (input.cycle as BillingCycle);
  if (!isBillingCycle(cycle)) {
    throw new HttpError(400, "invalid_cycle", 'cycle must be "monthly" or "annual".');
  }
  const customerId = await getOrCreateCustomer(deps, input.user);

  const baseKey = baseLookupKey(plan, cycle);
  const overageKey = OVERAGE_LOOKUP_KEYS[plan];

  const { data: existing, error } = await deps.db
    .from("subscriptions")
    .select("id")
    .eq("user_id", input.user.id)
    .in("status", LIVE_STATUSES)
    .limit(1);
  if (error) throw new HttpError(503, "db_error", "Could not load subscription.");

  if (existing && existing.length > 0) {
    return changePlan(deps, {
      subscriptionId: existing[0].id as string,
      customerId,
      userId: input.user.id,
      plan,
      cycle,
      baseKey,
      overageKey,
      siteUrl: input.siteUrl,
    });
  }

  const prices = await resolvePriceIds(deps.stripe, [baseKey, overageKey]);

  const session = await deps.stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: input.user.id,
    line_items: [
      { price: prices[baseKey], quantity: 1 },
      // Metered overage price: no quantity; usage arrives through the Billing Meter.
      { price: prices[overageKey] },
    ],
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    // Flexible billing mode lets an annual base price sit beside the monthly metered overage price.
    subscription_data: {
      billing_mode: { type: "flexible" },
      metadata: { user_id: input.user.id, plan, cycle },
    },
    metadata: { user_id: input.user.id, plan, cycle },
    success_url: `${input.siteUrl}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.siteUrl}/pricing?checkout=canceled`,
  });

  if (!session.url) throw new HttpError(502, "stripe_error", "Stripe did not return a checkout URL.");
  return { url: session.url, kind: "checkout" };
}

/** Customer Portal: update card, switch plan, cancel, download invoices. */
export async function createPortal(
  deps: BillingDeps,
  input: { user: { id: string; email: string }; siteUrl: string },
): Promise<{ url: string }> {
  const { data: profile, error } = await deps.db
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", input.user.id)
    .maybeSingle();
  if (error) throw new HttpError(503, "db_error", "Could not load billing profile.");
  if (!profile?.stripe_customer_id) {
    throw new HttpError(409, "no_billing_account", "You don't have a billing account yet. Choose a plan first.");
  }

  const session = await deps.stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id as string,
    return_url: `${input.siteUrl}/billing`,
  });
  return { url: session.url };
}

async function changePlan(
  deps: BillingDeps,
  o: {
    subscriptionId: string;
    customerId: string;
    userId: string;
    plan: PaidPlanId;
    cycle: BillingCycle;
    baseKey: string;
    overageKey: string;
    siteUrl: string;
  },
): Promise<CheckoutResult> {
  const sub = await deps.stripe.subscriptions.retrieve(o.subscriptionId);
  const baseItem = sub.items.data.find((i) => planFromLookupKey(i.price?.lookup_key));
  const overageItem = sub.items.data.find((i) => isOverageLookupKey(i.price?.lookup_key));

  if (baseItem?.price.lookup_key === o.baseKey) {
    const portal = await deps.stripe.billingPortal.sessions.create({
      customer: o.customerId,
      return_url: `${o.siteUrl}/billing`,
    });
    return { url: portal.url, kind: "portal" };
  }

  const prices = await resolvePriceIds(deps.stripe, [o.baseKey, o.overageKey]);
  const items: Stripe.SubscriptionUpdateParams.Item[] = [
    baseItem ? { id: baseItem.id, price: prices[o.baseKey] } : { price: prices[o.baseKey], quantity: 1 },
    overageItem ? { id: overageItem.id, price: prices[o.overageKey] } : { price: prices[o.overageKey] },
  ];

  await deps.stripe.subscriptions.update(
    o.subscriptionId,
    {
      items,
      proration_behavior: "create_prorations",
      cancel_at_period_end: false,
      metadata: { user_id: o.userId, plan: o.plan, cycle: o.cycle },
    },
    // Same switch within a minute (double click) is deduplicated by Stripe.
    { idempotencyKey: `plan-change-${o.subscriptionId}-${o.baseKey}-${Math.floor(Date.now() / 60_000)}` },
  );
  // The customer.subscription.updated webhook syncs the DB and profile plan.
  return { url: `${o.siteUrl}/billing?checkout=updated`, kind: "updated" };
}
