// @vitest-environment node
import { consumeQuota, getUsage, QuotaExceededError, reportPendingOverage, requireQuota, settleUsage } from "@/lib/quota";
import { OVERAGE_METER_EVENT } from "@/lib/billing/plans";
import { FakeSupabase } from "./helpers/fake-supabase";
import { makeFakeStripe } from "./helpers/fake-stripe";

const row = (o: Record<string, unknown> = {}) => ({
  allowed: true,
  plan: "free",
  used: 1,
  doc_limit: 20,
  remaining: 19,
  overage_quantity: 0,
  period_start: "2026-11-01T00:00:00Z",
  period_end: "2026-12-01T00:00:00Z",
  ...o,
});

describe("consumeQuota", () => {
  it("passes arguments to the consume_quota RPC and maps the result", async () => {
    const db = new FakeSupabase();
    const rpc = vi.fn(() => ({ data: [row({ plan: "pro", used: 502, doc_limit: 500, remaining: 0, overage_quantity: 2 })], error: null }));
    db.rpcHandlers.consume_quota = rpc;
    const res = await consumeQuota(db.asClient(), { userId: "u1", quantity: 3, source: "api", documentId: "d1", apiKeyId: "k1" });
    expect(rpc).toHaveBeenCalledWith({ p_user_id: "u1", p_quantity: 3, p_source: "api", p_document_id: "d1", p_api_key_id: "k1" });
    expect(res).toMatchObject({ allowed: true, plan: "pro", used: 502, limit: 500, remaining: 0, overage: 2, overageQuantity: 2 });
  });

  it("defaults to 1 web document", async () => {
    const db = new FakeSupabase();
    const rpc = vi.fn(() => ({ data: [row()], error: null }));
    db.rpcHandlers.consume_quota = rpc;
    await consumeQuota(db.asClient(), { userId: "u1" });
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ p_quantity: 1, p_source: "web", p_document_id: null }));
  });

  it("rejects bad quantities before calling the DB", async () => {
    const db = new FakeSupabase();
    await expect(consumeQuota(db.asClient(), { userId: "u1", quantity: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(consumeQuota(db.asClient(), { userId: "u1", quantity: 1.5 })).rejects.toMatchObject({ status: 400 });
  });

  it("maps DB errors to 503", async () => {
    const db = new FakeSupabase();
    db.rpcHandlers.consume_quota = () => ({ data: null, error: { message: "timeout" } });
    await expect(consumeQuota(db.asClient(), { userId: "u1" })).rejects.toMatchObject({ status: 503, code: "quota_unavailable" });
  });

  it("requireQuota throws a 402 with usage when Free is over the cap", async () => {
    const db = new FakeSupabase();
    db.rpcHandlers.consume_quota = () => ({ data: [row({ allowed: false, used: 20, remaining: 0 })], error: null });
    const err = await requireQuota(db.asClient(), { userId: "u1" }).catch((e) => e);
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect(err.status).toBe(402);
    expect(err.details.usage).toMatchObject({ used: 20, limit: 20 });
  });
});

describe("getUsage", () => {
  it("maps get_usage", async () => {
    const db = new FakeSupabase();
    db.rpcHandlers.get_usage = () => ({ data: [row({ plan: "business", used: 2600, doc_limit: 2500, remaining: 0, overage: 100 })], error: null });
    expect(await getUsage(db.asClient(), "u1")).toMatchObject({ plan: "business", used: 2600, overage: 100 });
  });
});

describe("settleUsage", () => {
  const recent = new Date(Date.now() - 60_000).toISOString();

  function setup() {
    const db = new FakeSupabase()
      .seed("profiles", [{ id: "u1", stripe_customer_id: "cus_1" }])
      .seed("usage_events", [
        { id: 1, user_id: "u1", document_id: "d1", overage_quantity: 2, created_at: recent, reported_at: null },
        { id: 2, user_id: "u1", document_id: "d2", overage_quantity: 0, created_at: recent, reported_at: null },
      ]);
    return { db, ...makeFakeStripe() };
  }

  it("refunds failed extractions and reports nothing", async () => {
    const { db, stripe, mocks } = setup();
    const refund = vi.fn(() => ({ data: 1, error: null }));
    db.rpcHandlers.refund_usage = refund;
    expect(await settleUsage({ stripe, db: db.asClient() }, { documentId: "d1", succeeded: false })).toEqual({ refunded: 1, reported: 0 });
    expect(refund).toHaveBeenCalledWith({ p_document_id: "d1" });
    expect(mocks.billing.meterEvents.create).not.toHaveBeenCalled();
  });

  it("sends overage to the Stripe meter with an idempotent identifier", async () => {
    const { db, stripe, mocks } = setup();
    const res = await settleUsage({ stripe, db: db.asClient() }, { documentId: "d1", succeeded: true });
    expect(res).toEqual({ refunded: 0, reported: 1 });
    expect(mocks.billing.meterEvents.create).toHaveBeenCalledWith({
      event_name: OVERAGE_METER_EVENT,
      identifier: "usage_1",
      timestamp: Math.floor(new Date(recent).getTime() / 1000),
      payload: { stripe_customer_id: "cus_1", value: "2" },
    });
    expect(db.rows("usage_events")[0].reported_at).not.toBeNull();
  });

  it("does nothing for docs within the included amount", async () => {
    const { db, stripe, mocks } = setup();
    expect((await settleUsage({ stripe, db: db.asClient() }, { documentId: "d2", succeeded: true })).reported).toBe(0);
    expect(mocks.billing.meterEvents.create).not.toHaveBeenCalled();
  });

  it("leaves the row unreported when Stripe fails, and the cron sweep retries it", async () => {
    const { db, stripe, mocks } = setup();
    mocks.billing.meterEvents.create.mockRejectedValueOnce(new Error("stripe down"));
    expect((await settleUsage({ stripe, db: db.asClient() }, { documentId: "d1", succeeded: true })).reported).toBe(0);
    expect(db.rows("usage_events")[0].reported_at).toBeNull();

    expect(await reportPendingOverage({ stripe, db: db.asClient() })).toBe(1);
    expect(db.rows("usage_events")[0].reported_at).not.toBeNull();
    expect(mocks.billing.meterEvents.create).toHaveBeenLastCalledWith(expect.objectContaining({ identifier: "usage_1" }));
  });

  it("skips events older than Stripe's 35-day meter window", async () => {
    const { db, stripe, mocks } = setup();
    db.rows("usage_events")[0].created_at = new Date(Date.now() - 40 * 86400_000).toISOString();
    expect(await reportPendingOverage({ stripe, db: db.asClient() })).toBe(0);
    expect(mocks.billing.meterEvents.create).not.toHaveBeenCalled();
  });
});
