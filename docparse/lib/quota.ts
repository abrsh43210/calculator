import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/http";
import { OVERAGE_METER_EVENT, type PlanId } from "@/lib/billing/plans";

export type UsageSource = "web" | "api";

export interface UsageSummary {
  plan: PlanId;
  used: number;
  limit: number;
  remaining: number;
  /** Docs used beyond the included amount this period (billed on Pro/Business). */
  overage: number;
  periodStart: string;
  periodEnd: string;
}

export interface QuotaResult extends UsageSummary {
  allowed: boolean;
  /** usage_events.id of this reservation; null when blocked. Pass to releaseUsage(). */
  eventId: number | null;
  /** How many of the docs in *this* call are overage. */
  overageQuantity: number;
}

interface QuotaRow {
  allowed?: boolean;
  plan: PlanId;
  used: number;
  doc_limit: number;
  remaining: number;
  overage?: number;
  overage_quantity?: number;
  event_id?: number | null;
  period_start: string;
  period_end: string;
}

function toSummary(row: QuotaRow): UsageSummary {
  return {
    plan: row.plan,
    used: row.used,
    limit: row.doc_limit,
    remaining: row.remaining,
    overage: row.overage ?? Math.max(0, row.used - row.doc_limit),
    periodStart: row.period_start,
    periodEnd: row.period_end,
  };
}

export class QuotaExceededError extends HttpError {
  constructor(public readonly usage: UsageSummary) {
    super(
      402,
      "quota_exceeded",
      `Monthly limit of ${usage.limit} documents reached on the ${usage.plan} plan. Upgrade to process more.`,
      { usage },
    );
    this.name = "QuotaExceededError";
  }
}

export interface ConsumeQuotaInput {
  userId: string;
  /** Billable documents: docsForPages(pageCount) from lib/pricing.ts. Default 1. */
  quantity?: number;
  source?: UsageSource;
  documentId?: string | null;
  apiKeyId?: string | null;
}

/**
 * Atomically checks and records usage. Free is hard-capped; Pro and Business
 * are always allowed and anything past the included docs is flagged as
 * overage (reported to Stripe by settleUsage). Never throws for "over quota";
 * check `allowed`. Use `requireQuota` if you want a 402 thrown instead.
 *
 * `db` must be the service-role client (createAdminClient()).
 */
export async function consumeQuota(db: SupabaseClient, input: ConsumeQuotaInput): Promise<QuotaResult> {
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new HttpError(400, "invalid_quantity", "quantity must be a positive integer");
  }

  const { data, error } = await db.rpc("consume_quota", {
    p_user_id: input.userId,
    p_quantity: quantity,
    p_source: input.source ?? "web",
    p_document_id: input.documentId ?? null,
    p_api_key_id: input.apiKeyId ?? null,
  });

  if (error) {
    throw new HttpError(503, "quota_unavailable", "Could not check usage quota.", { cause: error.message });
  }
  const row = (Array.isArray(data) ? data[0] : data) as QuotaRow | undefined;
  if (!row) {
    throw new HttpError(503, "quota_unavailable", "Could not check usage quota.");
  }
  return {
    allowed: Boolean(row.allowed),
    eventId: row.event_id ?? null,
    overageQuantity: row.overage_quantity ?? 0,
    ...toSummary(row),
  };
}

/** Like consumeQuota, but throws QuotaExceededError (HTTP 402) when blocked. */
export async function requireQuota(db: SupabaseClient, input: ConsumeQuotaInput): Promise<QuotaResult> {
  const result = await consumeQuota(db, input);
  if (!result.allowed) throw new QuotaExceededError(result);
  return result;
}

/** Undo one reservation by its usage_events id. Idempotent; reported overage is kept. */
export async function releaseUsage(db: SupabaseClient, eventId: number): Promise<boolean> {
  const { data, error } = await db.rpc("release_usage", { p_event_id: eventId });
  if (error) throw new HttpError(503, "quota_unavailable", "Could not release usage.", { cause: error.message });
  return Boolean(data);
}

/** Give back the usage charged for a document, e.g. when extraction fails. */
export async function refundUsage(db: SupabaseClient, documentId: string): Promise<number> {
  const { data, error } = await db.rpc("refund_usage", { p_document_id: documentId });
  if (error) {
    console.error("[docparse] refund_usage failed", { documentId, error: error.message });
    return 0;
  }
  return (data as number) ?? 0;
}

/** Read-only usage. Works with the user client (own usage) or admin client. */
export async function getUsage(db: SupabaseClient, userId?: string): Promise<UsageSummary> {
  const { data, error } = await db.rpc("get_usage", userId ? { p_user_id: userId } : {});
  if (error) {
    throw new HttpError(503, "usage_unavailable", "Could not load usage.", { cause: error.message });
  }
  const row = (Array.isArray(data) ? data[0] : data) as QuotaRow | undefined;
  if (!row) throw new HttpError(404, "profile_not_found", "No profile for this user.");
  return toSummary(row);
}

export interface SettleDeps {
  stripe: Stripe;
  /** Service-role client. */
  db: SupabaseClient;
}

/**
 * Call once extraction for a document finishes.
 * - Failed: the usage is refunded (failed extractions are not billed).
 * - Succeeded: any overage is sent to the Stripe Billing Meter.
 * Reporting failures are logged and retried by the /api/cron/report-usage sweep.
 */
export async function settleUsage(
  deps: SettleDeps,
  input: { documentId: string; succeeded: boolean },
): Promise<{ refunded: number; reported: number }> {
  if (!input.succeeded) {
    return { refunded: await refundUsage(deps.db, input.documentId), reported: 0 };
  }
  const { data, error } = await deps.db
    .from("usage_events")
    .select("id, user_id, overage_quantity, created_at, reported_at")
    .eq("document_id", input.documentId)
    .is("reported_at", null);
  if (error) {
    console.error("[docparse] settleUsage lookup failed", error.message);
    return { refunded: 0, reported: 0 };
  }
  const pending = ((data ?? []) as PendingUsage[]).filter((e) => e.overage_quantity > 0);
  return { refunded: 0, reported: await reportOverage(deps, pending) };
}

export interface PendingUsage {
  id: number;
  user_id: string;
  overage_quantity: number;
  created_at: string;
}

/** Stripe accepts meter events up to 35 days old. */
const MAX_METER_AGE_MS = 35 * 24 * 60 * 60 * 1000;

/**
 * Sends overage rows to Stripe. The usage_event id is the meter event
 * identifier, so a retry after a crash can't double-bill.
 */
export async function reportOverage(deps: SettleDeps, events: PendingUsage[]): Promise<number> {
  if (events.length === 0) return 0;

  const userIds = [...new Set(events.map((e) => e.user_id))];
  const customers = new Map<string, string>();
  for (const userId of userIds) {
    const { data } = await deps.db.from("profiles").select("stripe_customer_id").eq("id", userId).maybeSingle();
    if (data?.stripe_customer_id) customers.set(userId, data.stripe_customer_id as string);
  }

  let reported = 0;
  for (const e of events) {
    const customer = customers.get(e.user_id);
    if (!customer) {
      console.error("[docparse] overage for user without Stripe customer", e.user_id);
      continue;
    }
    const createdMs = new Date(e.created_at).getTime();
    if (Date.now() - createdMs > MAX_METER_AGE_MS) {
      console.error("[docparse] overage event too old for Stripe meter, skipping", e.id);
      continue;
    }
    try {
      await deps.stripe.billing.meterEvents.create({
        event_name: OVERAGE_METER_EVENT,
        identifier: `usage_${e.id}`,
        timestamp: Math.floor(createdMs / 1000),
        payload: { stripe_customer_id: customer, value: String(e.overage_quantity) },
      });
    } catch (err) {
      console.error("[docparse] meter event failed", e.id, (err as Error).message);
      continue;
    }
    const { error } = await deps.db
      .from("usage_events")
      .update({ reported_at: new Date().toISOString() })
      .eq("id", e.id);
    if (error) console.error("[docparse] could not mark usage reported", e.id, error.message);
    else reported++;
  }
  return reported;
}

/** Cron sweep: reports any overage that settleUsage couldn't send. */
export async function reportPendingOverage(deps: SettleDeps, limit = 500): Promise<number> {
  const { data, error } = await deps.db
    .from("usage_events")
    .select("id, user_id, overage_quantity, created_at")
    .gt("overage_quantity", 0)
    .is("reported_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new HttpError(503, "db_error", "Could not load unreported usage.");
  return reportOverage(deps, (data ?? []) as PendingUsage[]);
}
