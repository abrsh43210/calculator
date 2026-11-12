#!/usr/bin/env node
/**
 * Creates (or finds) everything DocParse needs in Stripe. Safe to re-run.
 *   STRIPE_SECRET_KEY=sk_test_... npm run stripe:setup
 *
 * - Billing Meter "docparse_overage_docs" (sum of `value` per customer)
 * - Products "DocParse Pro" and "DocParse Business"
 * - Prices with lookup keys: pro_monthly $19, pro_annual $190, business_monthly $49,
 *   business_annual $490, pro_overage $0.04/doc, business_overage $0.025/doc (metered, monthly)
 * Amounts mirror lib/pricing.ts.
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY first.");
  process.exit(1);
}
if (key.startsWith("sk_live_") && process.env.CONFIRM_LIVE !== "yes") {
  console.error("Refusing to run against live mode without CONFIRM_LIVE=yes.");
  process.exit(1);
}
const stripe = new Stripe(key);
const METER_EVENT = "docparse_overage_docs";

const PLANS = [
  {
    id: "pro",
    name: "DocParse Pro",
    monthlyCents: 1900,
    annualCents: 19000,
    overageCentsDecimal: "4", // $0.04
  },
  {
    id: "business",
    name: "DocParse Business",
    monthlyCents: 4900,
    annualCents: 49000,
    overageCentsDecimal: "2.5", // $0.025
  },
];

async function findOrCreateMeter() {
  for await (const meter of stripe.billing.meters.list({ status: "active", limit: 100 })) {
    if (meter.event_name === METER_EVENT) return meter;
  }
  return stripe.billing.meters.create({
    display_name: "DocParse overage documents",
    event_name: METER_EVENT,
    default_aggregation: { formula: "sum" },
    customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
    value_settings: { event_payload_key: "value" },
  });
}

async function findOrCreateProduct(plan) {
  const found = await stripe.products.search({ query: `metadata['docparse_plan']:'${plan.id}'` });
  if (found.data[0]) return found.data[0];
  return stripe.products.create({ name: plan.name, metadata: { docparse_plan: plan.id } });
}

async function ensurePrice(lookupKey, params) {
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true });
  if (existing.data[0]) {
    console.log(`  = ${lookupKey} (${existing.data[0].id})`);
    return existing.data[0];
  }
  const price = await stripe.prices.create({ ...params, lookup_key: lookupKey, currency: "usd" });
  console.log(`  + ${lookupKey} (${price.id})`);
  return price;
}

const meter = await findOrCreateMeter();
console.log(`Meter ${meter.event_name} (${meter.id})`);

for (const plan of PLANS) {
  const product = await findOrCreateProduct(plan);
  console.log(`${plan.name} (${product.id})`);
  await ensurePrice(`${plan.id}_monthly`, {
    product: product.id,
    unit_amount: plan.monthlyCents,
    recurring: { interval: "month" },
  });
  await ensurePrice(`${plan.id}_annual`, {
    product: product.id,
    unit_amount: plan.annualCents,
    recurring: { interval: "year" },
  });
  await ensurePrice(`${plan.id}_overage`, {
    product: product.id,
    nickname: `${plan.name} overage`,
    unit_amount_decimal: plan.overageCentsDecimal,
    recurring: { interval: "month", usage_type: "metered", meter: meter.id },
    billing_scheme: "per_unit",
  });
}

console.log("\nDone. Next: Developers > Webhooks, add an endpoint for /api/webhooks/stripe (see README).");
