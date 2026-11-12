import type Stripe from "stripe";
import { HttpError } from "@/lib/http";

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { id: string; expires: number }>();

/**
 * Resolves Stripe price ids from lookup keys (pro_monthly, pro_overage, ...).
 * Cached for 10 minutes per server instance. Missing keys raise a 500 with a
 * hint to run `npm run stripe:setup`.
 */
export async function resolvePriceIds(stripe: Stripe, lookupKeys: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const key of lookupKeys) {
    const hit = cache.get(key);
    if (hit && hit.expires > now) out[key] = hit.id;
    else missing.push(key);
  }

  if (missing.length > 0) {
    const prices = await stripe.prices.list({ lookup_keys: missing, active: true, limit: 100 });
    for (const price of prices.data) {
      if (!price.lookup_key) continue;
      out[price.lookup_key] = price.id;
      cache.set(price.lookup_key, { id: price.id, expires: now + TTL_MS });
    }
  }

  const notFound = lookupKeys.filter((k) => !out[k]);
  if (notFound.length > 0) {
    throw new HttpError(500, "price_not_configured", `Stripe prices missing for: ${notFound.join(", ")}. Run npm run stripe:setup.`);
  }
  return out;
}

export function clearPriceCache() {
  cache.clear();
}
