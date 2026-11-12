// @vitest-environment node
import { createCheckout, createPortal } from "@/lib/billing/checkout";
import { clearPriceCache } from "@/lib/billing/prices";
import { FakeSupabase } from "./helpers/fake-supabase";
import { makeFakeStripe, makeSubscription, PRICES } from "./helpers/fake-stripe";

const user = { id: "u1", email: "a@example.com" };
const siteUrl = "https://docparse.test";

function setup(profile: Record<string, unknown> = {}) {
  clearPriceCache();
  const db = new FakeSupabase().seed("profiles", [{ id: "u1", plan: "free", stripe_customer_id: null, ...profile }]);
  return { db, ...makeFakeStripe() };
}

describe("createCheckout", () => {
  it("rejects unknown plans and cycles", async () => {
    const { db, stripe } = setup();
    const deps = { stripe, db: db.asClient() };
    await expect(createCheckout(deps, { user, plan: "free", siteUrl })).rejects.toMatchObject({ status: 400, code: "invalid_plan" });
    await expect(createCheckout(deps, { user, plan: "pro", cycle: "weekly", siteUrl })).rejects.toMatchObject({ code: "invalid_cycle" });
  });

  it("creates the Stripe customer on first checkout and saves it", async () => {
    const { db, stripe, mocks } = setup();
    await createCheckout({ stripe, db: db.asClient() }, { user, plan: "pro", siteUrl });
    expect(mocks.customers.create).toHaveBeenCalledWith(
      { email: user.email, metadata: { user_id: "u1" } },
      { idempotencyKey: "customer-create-u1" },
    );
    expect(db.rows("profiles")[0].stripe_customer_id).toBe("cus_new");
  });

  it("reuses an existing customer", async () => {
    const { db, stripe, mocks } = setup({ stripe_customer_id: "cus_old" });
    await createCheckout({ stripe, db: db.asClient() }, { user, plan: "pro", siteUrl });
    expect(mocks.customers.create).not.toHaveBeenCalled();
    expect(mocks.checkout.sessions.create.mock.calls[0][0].customer).toBe("cus_old");
  });

  it("builds an annual Business session with the base price and metered overage", async () => {
    const { db, stripe, mocks } = setup({ stripe_customer_id: "cus_1" });
    const res = await createCheckout({ stripe, db: db.asClient() }, { user, plan: "business", cycle: "annual", siteUrl });
    expect(res).toEqual({ url: "https://checkout.stripe.test/cs_test_1", kind: "checkout" });
    expect(mocks.prices.list).toHaveBeenCalledWith(
      expect.objectContaining({ lookup_keys: ["business_annual", "business_overage"] }),
    );
    const params = mocks.checkout.sessions.create.mock.calls[0][0];
    expect(params.line_items).toEqual([{ price: PRICES.business_annual, quantity: 1 }, { price: PRICES.business_overage }]);
    expect(params.mode).toBe("subscription");
    expect(params.client_reference_id).toBe("u1");
    expect(params.subscription_data.billing_mode).toEqual({ type: "flexible" });
    expect(params.subscription_data.metadata).toEqual({ user_id: "u1", plan: "business", cycle: "annual" });
    expect(params.success_url).toBe(`${siteUrl}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
  });

  it("caches price lookups", async () => {
    const { db, stripe, mocks } = setup({ stripe_customer_id: "cus_1" });
    await createCheckout({ stripe, db: db.asClient() }, { user, plan: "pro", siteUrl });
    await createCheckout({ stripe, db: db.asClient() }, { user, plan: "pro", siteUrl });
    expect(mocks.prices.list).toHaveBeenCalledTimes(1);
  });

  it("explains how to fix missing Stripe prices", async () => {
    const { db, stripe, mocks } = setup({ stripe_customer_id: "cus_1" });
    mocks.prices.list.mockResolvedValueOnce({ data: [] });
    await expect(createCheckout({ stripe, db: db.asClient() }, { user, plan: "pro", siteUrl })).rejects.toMatchObject({
      status: 500,
      code: "price_not_configured",
    });
  });

  it("switches an existing subscription in place instead of creating a second one", async () => {
    const { db, stripe, mocks, setSubscription } = setup({ stripe_customer_id: "cus_1" });
    db.seed("subscriptions", [{ id: "sub_123", user_id: "u1", status: "active" }]);
    setSubscription(makeSubscription({ lookupKey: "pro_monthly" }));
    const res = await createCheckout({ stripe, db: db.asClient() }, { user, plan: "business", cycle: "annual", siteUrl });
    expect(res).toEqual({ url: `${siteUrl}/billing?checkout=updated`, kind: "updated" });
    expect(mocks.checkout.sessions.create).not.toHaveBeenCalled();
    const [subId, params] = mocks.subscriptions.update.mock.calls[0];
    expect(subId).toBe("sub_123");
    expect(params.items).toEqual([
      { id: "si_base", price: PRICES.business_annual },
      { id: "si_overage", price: PRICES.business_overage },
    ]);
    expect(params.proration_behavior).toBe("create_prorations");
  });

  it("opens the portal when they pick the plan they already have", async () => {
    const { db, stripe, mocks, setSubscription } = setup({ stripe_customer_id: "cus_1" });
    db.seed("subscriptions", [{ id: "sub_123", user_id: "u1", status: "active" }]);
    setSubscription(makeSubscription({ lookupKey: "pro_monthly" }));
    const res = await createCheckout({ stripe, db: db.asClient() }, { user, plan: "pro", siteUrl });
    expect(res.kind).toBe("portal");
    expect(mocks.subscriptions.update).not.toHaveBeenCalled();
  });

  it("returns 503 when the DB is down", async () => {
    const { db, stripe } = setup();
    db.failOn("profiles", "select");
    await expect(createCheckout({ stripe, db: db.asClient() }, { user, plan: "pro", siteUrl })).rejects.toMatchObject({ status: 503 });
  });
});

describe("createPortal", () => {
  it("409s for users who never paid", async () => {
    const { db, stripe } = setup();
    await expect(createPortal({ stripe, db: db.asClient() }, { user, siteUrl })).rejects.toMatchObject({ status: 409 });
  });

  it("opens the portal for customers", async () => {
    const { db, stripe, mocks } = setup({ stripe_customer_id: "cus_1" });
    expect(await createPortal({ stripe, db: db.asClient() }, { user, siteUrl })).toEqual({ url: "https://billing.stripe.test/session" });
    expect(mocks.billingPortal.sessions.create).toHaveBeenCalledWith({ customer: "cus_1", return_url: `${siteUrl}/billing` });
  });
});
