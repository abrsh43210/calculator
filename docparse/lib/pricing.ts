/**
 * DocParse plans: the single source of truth for marketing pages.
 * Thread 3 (Stripe) should create Prices with these lookup keys and amounts.
 *
 * A "document" is one uploaded file of up to 5 pages. Longer files count as
 * ceil(pages / 5) documents.
 */

export type BillingCycle = "monthly" | "annual";
export type PlanId = "free" | "pro" | "business";

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** USD per month when billed monthly. */
  monthlyPrice: number;
  /** USD per year when billed annually (2 months free). */
  annualPrice: number;
  /** Documents included per month. */
  includedDocs: number;
  /** USD per extra document, or null if usage is hard-capped. */
  overagePerDoc: number | null;
  apiAccess: boolean;
  features: string[];
  cta: string;
  highlighted?: boolean;
  stripeLookupKeys: Record<BillingCycle, string> | null;
}

export const PAGES_PER_DOC = 5;

export const PLANS: readonly Plan[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Try it on your own documents.",
    monthlyPrice: 0,
    annualPrice: 0,
    includedDocs: 20,
    overagePerDoc: null,
    apiAccess: false,
    features: [
      "20 documents per month",
      "Web app upload (PDF, PNG, JPG)",
      "JSON and CSV export",
      "Line items and totals",
      "No credit card required",
    ],
    cta: "Start free",
    stripeLookupKeys: null,
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For freelancers and small finance teams.",
    monthlyPrice: 19,
    annualPrice: 190,
    includedDocs: 500,
    overagePerDoc: 0.04,
    apiAccess: true,
    features: [
      "500 documents per month",
      "REST API access (60 requests/min)",
      "Batch upload up to 50 files",
      "Per-field confidence scores",
      "$0.04 per extra document",
      "Email support",
    ],
    cta: "Start Pro",
    highlighted: true,
    stripeLookupKeys: { monthly: "pro_monthly", annual: "pro_annual" },
  },
  {
    id: "business",
    name: "Business",
    tagline: "For teams processing documents at volume.",
    monthlyPrice: 49,
    annualPrice: 490,
    includedDocs: 2500,
    overagePerDoc: 0.025,
    apiAccess: true,
    features: [
      "2,500 documents per month",
      "REST API (300 requests/min) and webhooks",
      "Custom extraction fields",
      "Batch upload up to 500 files",
      "5 team seats",
      "$0.025 per extra document",
      "Priority support",
    ],
    cta: "Start Business",
    stripeLookupKeys: { monthly: "business_monthly", annual: "business_annual" },
  },
] as const;

export function getPlan(id: PlanId): Plan {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`Unknown plan: ${id}`);
  return plan;
}

/** Price shown per month for a billing cycle (annual is divided by 12). */
export function displayMonthlyPrice(plan: Plan, cycle: BillingCycle): number {
  if (cycle === "monthly") return plan.monthlyPrice;
  return Math.round((plan.annualPrice / 12) * 100) / 100;
}

/** Percent saved by paying annually, rounded to a whole number. */
export function annualSavingsPercent(plan: Plan): number {
  if (plan.monthlyPrice === 0) return 0;
  const full = plan.monthlyPrice * 12;
  return Math.round(((full - plan.annualPrice) / full) * 100);
}

/** Effective USD per included document. */
export function pricePerDoc(plan: Plan, cycle: BillingCycle = "monthly"): number {
  if (plan.includedDocs === 0) return 0;
  return displayMonthlyPrice(plan, cycle) / plan.includedDocs;
}

/** Number of billable documents for a file with the given page count. */
export function docsForPages(pages: number): number {
  if (!Number.isFinite(pages) || pages <= 0) return 0;
  return Math.ceil(pages / PAGES_PER_DOC);
}

/**
 * Monthly cost on a plan for a given volume, including overage.
 * Returns null when the plan cannot serve the volume (hard cap exceeded).
 */
export function monthlyCost(
  plan: Plan,
  docsPerMonth: number,
  cycle: BillingCycle = "monthly",
): number | null {
  const docs = Math.max(0, Math.ceil(docsPerMonth));
  const base = displayMonthlyPrice(plan, cycle);
  const extra = Math.max(0, docs - plan.includedDocs);
  if (extra === 0) return base;
  if (plan.overagePerDoc === null) return null;
  return Math.round((base + extra * plan.overagePerDoc) * 100) / 100;
}

/** Cheapest plan for a volume. Ties go to the higher tier (more features). */
export function recommendPlan(
  docsPerMonth: number,
  cycle: BillingCycle = "monthly",
): { plan: Plan; cost: number } {
  let best: { plan: Plan; cost: number } | null = null;
  for (const plan of PLANS) {
    const cost = monthlyCost(plan, docsPerMonth, cycle);
    if (cost === null) continue;
    if (!best || cost <= best.cost) best = { plan, cost };
  }
  // PLANS always contains a plan with overage, so best is set.
  return best!;
}

export function formatUsd(amount: number): string {
  const hasCents = Math.round(amount * 100) % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: amount < 1 && amount > 0 ? 3 : 2,
  }).format(amount);
}

/** Competitor entry-plan pricing, checked November 2026. */
export const COMPETITORS = [
  { name: "DocParse Pro", price: 19, docs: 500, note: "Includes API", us: true },
  { name: "Airparser Growth", price: 49, docs: 500, note: "1 credit per page" },
  { name: "Docparser Starter", price: 39, docs: 100, note: "Up to 5 pages per doc" },
  { name: "Veryfi Starter", price: 500, docs: null, note: "$500/mo minimum, $0.08 to $0.16 per doc" },
] as const;
