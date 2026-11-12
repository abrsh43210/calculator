// @vitest-environment node
import { handleStripeEvent, RetryableWebhookError } from "@/lib/billing/webhook";
import { processStripeWebhook } from "@/app/api/webhooks/stripe/handler";
import { FakeSupabase } from "./helpers/fake-supabase";
import { makeEvent, makeFakeStripe, makeSubscription } from "./helpers/fake-stripe";

function setup() {
  const db = new FakeSupabase().seed("profiles", [{ id: "u1", plan: "free", stripe_customer_id: "cus_123" }]);
  const fake = makeFakeStripe();
  return { db, ...fake, deps: { stripe: fake.stripe, db: db.asClient() } };
}

describe("handleStripeEvent", () => {
  it("syncs a new subscription and upgrades the profile", async () => {
    const { db, deps, setSubscription } = setup();
    const sub = makeSubscription({ lookupKey: "business_annual" });
    setSubscription(sub);

    const out = await handleStripeEvent(deps, makeEvent("customer.subscription.created", sub, "evt_1"));

    expect(out).toEqual({ status: "processed", subscriptionId: "sub_123", userId: "u1", plan: "business" });
    expect(db.rows("subscriptions")[0]).toMatchObject({
      id: "sub_123",
      user_id: "u1",
      status: "active",
      plan: "business",
      billing_cycle: "annual",
      price_id: "price_biz_y",
      overage_item_id: "si_overage",
    });
    expect(db.rows("profiles")[0].plan).toBe("business");
    expect(db.rows("stripe_events")).toEqual([{ id: "evt_1", type: "customer.subscription.created" }]);
  });

  it("skips events it has already processed", async () => {
    const { db, deps, mocks } = setup();
    db.seed("stripe_events", [{ id: "evt_dup", type: "customer.subscription.updated" }]);
    const out = await handleStripeEvent(deps, makeEvent("customer.subscription.updated", makeSubscription(), "evt_dup"));
    expect(out).toEqual({ status: "duplicate" });
    expect(mocks.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it("re-fetches from Stripe so a stale out-of-order event can't downgrade", async () => {
    const { db, deps, setSubscription } = setup();
    setSubscription(makeSubscription({ status: "active", lookupKey: "pro_monthly" })); // current truth
    const stale = makeSubscription({ status: "incomplete" });
    await handleStripeEvent(deps, makeEvent("customer.subscription.updated", stale));
    expect(db.rows("subscriptions")[0].status).toBe("active");
    expect(db.rows("profiles")[0].plan).toBe("pro");
  });

  it("drops the user to Free when the subscription is canceled", async () => {
    const { db, deps, setSubscription } = setup();
    setSubscription(makeSubscription({ status: "active" }));
    await handleStripeEvent(deps, makeEvent("customer.subscription.created", makeSubscription()));
    expect(db.rows("profiles")[0].plan).toBe("pro");

    setSubscription(makeSubscription({ status: "canceled" }));
    const out = await handleStripeEvent(deps, makeEvent("customer.subscription.deleted", makeSubscription()));
    expect(out).toMatchObject({ plan: "free" });
    expect(db.rows("profiles")[0].plan).toBe("free");
  });

  it("keeps access while past_due (dunning)", async () => {
    const { db, deps, setSubscription } = setup();
    setSubscription(makeSubscription({ status: "past_due" }));
    await handleStripeEvent(deps, makeEvent("invoice.payment_failed", { parent: { subscription_details: { subscription: "sub_123" } } }));
    expect(db.rows("profiles")[0].plan).toBe("pro");
    expect(db.rows("subscriptions")[0].status).toBe("past_due");
  });

  it("links the customer on checkout.session.completed when the profile has none", async () => {
    const { db, deps, setSubscription } = setup();
    db.rows("profiles")[0].stripe_customer_id = null;
    setSubscription(makeSubscription({ customer: "cus_from_checkout", metadata: { user_id: "u1" } }));
    const session = { mode: "subscription", subscription: "sub_123", customer: "cus_from_checkout", client_reference_id: "u1" };
    const out = await handleStripeEvent(deps, makeEvent("checkout.session.completed", session));
    expect(out.status).toBe("processed");
    expect(db.rows("profiles")[0]).toMatchObject({ stripe_customer_id: "cus_from_checkout", plan: "pro" });
  });

  it("ignores one-off payments, unrelated events and foreign subscriptions", async () => {
    const { deps, setSubscription } = setup();
    expect((await handleStripeEvent(deps, makeEvent("checkout.session.completed", { mode: "payment" }))).status).toBe("ignored");
    expect((await handleStripeEvent(deps, makeEvent("charge.refunded", {}))).status).toBe("ignored");

    setSubscription(makeSubscription({ id: "sub_other", customer: "cus_unknown" }));
    expect((await handleStripeEvent(deps, makeEvent("customer.subscription.updated", { id: "sub_other" }))).status).toBe("ignored");

    setSubscription(makeSubscription({ id: "sub_weird", lookupKey: "some_other_product", withOverage: false }));
    expect((await handleStripeEvent(deps, makeEvent("customer.subscription.updated", { id: "sub_weird" }))).status).toBe("ignored");
  });

  it("keeps the best plan when a user has two subscriptions", async () => {
    const { db, deps, setSubscription } = setup();
    db.seed("subscriptions", [{ id: "sub_biz", user_id: "u1", plan: "business", status: "active" }]);
    setSubscription(makeSubscription({ id: "sub_pro", lookupKey: "pro_monthly" }));
    await handleStripeEvent(deps, makeEvent("customer.subscription.created", { id: "sub_pro" }));
    expect(db.rows("profiles")[0].plan).toBe("business");
  });

  it("throws a retryable error (and records nothing) when the DB write fails", async () => {
    const { db, deps, setSubscription } = setup();
    setSubscription(makeSubscription());
    db.failOn("subscriptions", "upsert");
    await expect(handleStripeEvent(deps, makeEvent("customer.subscription.updated", makeSubscription(), "evt_x"))).rejects.toBeInstanceOf(
      RetryableWebhookError,
    );
    expect(db.rows("stripe_events")).toHaveLength(0);
  });
});

describe("POST /api/webhooks/stripe", () => {
  const secret = "whsec_test_secret";

  function signedRequest(real: ReturnType<typeof makeFakeStripe>["real"], payload: string, sigSecret = secret) {
    const header = real.webhooks.generateTestHeaderString({ payload, secret: sigSecret });
    return new Request("https://docparse.test/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": header, "content-type": "application/json" },
      body: payload,
    });
  }

  it("verifies the real signature and processes the event", async () => {
    const { db, stripe, real, setSubscription } = setup();
    setSubscription(makeSubscription());
    const payload = JSON.stringify(makeEvent("customer.subscription.created", makeSubscription(), "evt_sig"));
    const res = await processStripeWebhook(signedRequest(real, payload), { stripe, db: db.asClient(), webhookSecret: secret });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, status: "processed" });
    expect(db.rows("profiles")[0].plan).toBe("pro");
  });

  it("400s on a bad or missing signature", async () => {
    const { db, stripe, real } = setup();
    const payload = JSON.stringify(makeEvent("customer.subscription.created", {}));
    const forged = await processStripeWebhook(signedRequest(real, payload, "whsec_wrong"), { stripe, db: db.asClient(), webhookSecret: secret });
    expect(forged.status).toBe(400);
    const missing = await processStripeWebhook(new Request("https://x.test", { method: "POST", body: payload }), {
      stripe,
      db: db.asClient(),
      webhookSecret: secret,
    });
    expect(missing.status).toBe(400);
    expect(db.rows("subscriptions")).toHaveLength(0);
  });

  it("500s on handler failure so Stripe retries", async () => {
    const { db, stripe, real, setSubscription } = setup();
    setSubscription(makeSubscription());
    db.failOn("stripe_events", "select");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const payload = JSON.stringify(makeEvent("customer.subscription.updated", makeSubscription()));
    const res = await processStripeWebhook(signedRequest(real, payload), { stripe, db: db.asClient(), webhookSecret: secret });
    expect(res.status).toBe(500);
  });
});
