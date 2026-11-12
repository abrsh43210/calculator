import { vi } from "vitest";
import Stripe from "stripe";

/** Lookup keys from lib/pricing.ts plus the overage keys, mapped to fake price ids. */
export const PRICES: Record<string, string> = {
  pro_monthly: "price_pro_m",
  pro_annual: "price_pro_y",
  business_monthly: "price_biz_m",
  business_annual: "price_biz_y",
  pro_overage: "price_pro_over",
  business_overage: "price_biz_over",
};

interface SubOpts {
  id?: string;
  customer?: string;
  status?: Stripe.Subscription.Status;
  lookupKey?: string;
  withOverage?: boolean;
  periodStart?: number;
  periodEnd?: number;
  metadata?: Record<string, string>;
  cancelAtPeriodEnd?: boolean;
}

export function makeSubscription(o: SubOpts = {}): Stripe.Subscription {
  const now = Math.floor(Date.now() / 1000);
  const lookupKey = o.lookupKey ?? "pro_monthly";
  const start = o.periodStart ?? now - 86400;
  const end = o.periodEnd ?? now + 29 * 86400;
  const items: any[] = [
    {
      id: "si_base",
      price: { id: PRICES[lookupKey] ?? "price_unknown", lookup_key: lookupKey },
      quantity: 1,
      current_period_start: start,
      current_period_end: end,
    },
  ];
  if (o.withOverage !== false) {
    const plan = lookupKey.split("_")[0];
    items.push({
      id: "si_overage",
      price: { id: PRICES[`${plan}_overage`], lookup_key: `${plan}_overage` },
      current_period_start: start,
      current_period_end: end,
    });
  }
  return {
    id: o.id ?? "sub_123",
    object: "subscription",
    customer: o.customer ?? "cus_123",
    status: o.status ?? "active",
    cancel_at_period_end: o.cancelAtPeriodEnd ?? false,
    canceled_at: null,
    ended_at: null,
    metadata: o.metadata ?? {},
    items: { object: "list", data: items },
  } as unknown as Stripe.Subscription;
}

/** Stripe client with network calls mocked. webhooks.* is the real implementation, so signatures are truly verified. */
export function makeFakeStripe() {
  const real = new Stripe("sk_test_fake_key_for_tests");
  const subscriptions = new Map<string, Stripe.Subscription>();

  const mocks = {
    webhooks: real.webhooks,
    customers: {
      create: vi.fn(async (params: any) => ({ id: "cus_new", object: "customer", email: params.email })),
    },
    prices: {
      list: vi.fn(async (params: { lookup_keys: string[] }) => ({
        data: params.lookup_keys.filter((k) => PRICES[k]).map((k) => ({ id: PRICES[k], lookup_key: k })),
      })),
    },
    checkout: {
      sessions: {
        create: vi.fn(async (_params: any) => ({ id: "cs_test_1", url: "https://checkout.stripe.test/cs_test_1" })),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn(async (_params: any) => ({ id: "bps_1", url: "https://billing.stripe.test/session" })),
      },
    },
    subscriptions: {
      retrieve: vi.fn(async (id: string) => {
        const sub = subscriptions.get(id);
        if (!sub) throw new Error(`No such subscription: ${id}`);
        return sub;
      }),
      update: vi.fn(async (id: string, _params: any, _opts?: any) => subscriptions.get(id)),
    },
    billing: {
      meterEvents: { create: vi.fn(async (params: any) => ({ object: "billing.meter_event", ...params })) },
    },
  };

  return {
    stripe: mocks as unknown as Stripe,
    mocks,
    real,
    setSubscription(sub: Stripe.Subscription) {
      subscriptions.set(sub.id, sub);
    },
  };
}

export function makeEvent(type: string, object: unknown, id = `evt_${Math.random().toString(36).slice(2)}`) {
  return { id, object: "event", type, data: { object } } as unknown as Stripe.Event;
}
