import { getPlan, type BillingCycle, type PlanId } from "@/lib/pricing";

/**
 * Server-side billing helpers on top of lib/pricing.ts, which stays the single
 * source of truth for prices, included docs, overage and API access.
 * Stripe prices are referenced by lookup key, never by hard-coded price id.
 */
export type { BillingCycle, PlanId };
export type PaidPlanId = Exclude<PlanId, "free">;

export const PLAN_RANK: Record<PlanId, number> = { free: 0, pro: 1, business: 2 };

/** Metered overage prices (one per paid plan), billed monthly via a Stripe Billing Meter. */
export const OVERAGE_LOOKUP_KEYS: Record<PaidPlanId, string> = {
  pro: "pro_overage",
  business: "business_overage",
};

/** event_name of the Stripe Billing Meter that counts overage documents. */
export const OVERAGE_METER_EVENT = "docparse_overage_docs";

export function isPaidPlan(value: unknown): value is PaidPlanId {
  return value === "pro" || value === "business";
}

export function isBillingCycle(value: unknown): value is BillingCycle {
  return value === "monthly" || value === "annual";
}

export function baseLookupKey(plan: PaidPlanId, cycle: BillingCycle): string {
  const keys = getPlan(plan).stripeLookupKeys;
  if (!keys) throw new Error(`Plan ${plan} has no Stripe lookup keys`);
  return keys[cycle];
}

export function includedDocs(plan: PlanId): number {
  return getPlan(plan).includedDocs;
}

export function hasApiAccess(plan: PlanId): boolean {
  return getPlan(plan).apiAccess;
}

export function hasOverage(plan: PlanId): boolean {
  return getPlan(plan).overagePerDoc !== null;
}

/** Maps a Stripe price lookup key to the base plan and cycle it represents. */
export function planFromLookupKey(
  key: string | null | undefined,
): { plan: PaidPlanId; cycle: BillingCycle } | null {
  if (!key) return null;
  for (const plan of ["pro", "business"] as const) {
    for (const cycle of ["monthly", "annual"] as const) {
      if (baseLookupKey(plan, cycle) === key) return { plan, cycle };
    }
  }
  return null;
}

export function isOverageLookupKey(key: string | null | undefined): boolean {
  return !!key && Object.values(OVERAGE_LOOKUP_KEYS).includes(key);
}

export function highestPlan(plans: PlanId[]): PlanId {
  return plans.reduce<PlanId>((best, p) => (PLAN_RANK[p] > PLAN_RANK[best] ? p : best), "free");
}
