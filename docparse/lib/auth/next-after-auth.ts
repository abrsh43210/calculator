import { isBillingCycle, isPaidPlan } from "@/lib/billing/plans";
import { getPlan } from "@/lib/pricing";
import { safeNextPath } from "@/lib/http";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Where to send someone after they sign up or in. A paid plan from the pricing
 * page (/signup?plan=pro&cycle=annual) goes straight to checkout; otherwise
 * honour ?next= or fall back to the dashboard.
 */
export function nextAfterAuth(params: Params): { next: string; planLabel?: string } {
  const plan = one(params.plan);
  const rawCycle = one(params.cycle);
  if (isPaidPlan(plan)) {
    const cycle = isBillingCycle(rawCycle) ? rawCycle : "monthly";
    return {
      next: `/checkout?${new URLSearchParams({ plan, cycle })}`,
      planLabel: `${getPlan(plan).name} (${cycle})`,
    };
  }
  return { next: safeNextPath(one(params.next)) };
}
