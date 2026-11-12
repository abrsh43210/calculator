// @vitest-environment node
import {
  decodeCursor,
  encodeCursor,
  isOwnUploadPath,
  SupabaseApiKeyVerifier,
  SupabaseDocumentStore,
  SupabaseSessionResolver,
  SupabaseUploadStore,
  SupabaseUsageService,
} from "@/lib/server/supabase-services";
import { authenticate, hashApiKey, type Principal } from "@/lib/server/auth";
import { isExceeded } from "@/lib/server/usage";
import type { DocumentRecord } from "@/lib/api/types";
import { generateApiKey } from "@/lib/api-keys";
import { FakeSupabase } from "./helpers/fake-supabase";
import { makeFakeStripe } from "./helpers/fake-stripe";

const UID = "11111111-1111-4111-8111-111111111111";
const proUser: Principal = { userId: UID, plan: "pro", via: "api_key", apiKeyId: "k1", livemode: false };

const quotaRow = (o: Record<string, unknown> = {}) => ({
  allowed: true,
  plan: "pro",
  used: 10,
  doc_limit: 500,
  remaining: 490,
  overage_quantity: 0,
  event_id: 7,
  period_start: "2026-11-01T00:00:00.000Z",
  period_end: "2026-12-01T00:00:00.000Z",
  ...o,
});

describe("SupabaseApiKeyVerifier + authenticate()", () => {
  it("resolves a key by its hash and lets Thread 2's authenticate() apply plan rules", async () => {
    const { key } = generateApiKey();
    const db = new FakeSupabase();
    db.rpcHandlers.verify_api_key = ({ p_key_hash }) => ({
      data: p_key_hash === hashApiKey(key) ? [{ key_id: "k1", user_id: UID, plan: "pro" }] : [],
      error: null,
    });
    const verifier = new SupabaseApiKeyVerifier(db.asClient());
    const sessions = { resolve: vi.fn() };
    const req = new Request("https://x.test", { headers: { authorization: `Bearer ${key}` } });
    expect(await authenticate(req, { apiKeys: verifier, sessions })).toEqual({
      userId: UID,
      plan: "pro",
      apiKeyId: "k1",
      livemode: false,
      via: "api_key",
    });
    expect(await verifier.verify(generateApiKey().key)).toBeNull();
  });

  it("Free-plan keys are refused with 403 by authenticate()", async () => {
    const { key } = generateApiKey();
    const db = new FakeSupabase();
    db.rpcHandlers.verify_api_key = () => ({ data: [{ key_id: "k1", user_id: UID, plan: "free" }], error: null });
    const req = new Request("https://x.test", { headers: { "x-api-key": key } });
    await expect(
      authenticate(req, { apiKeys: new SupabaseApiKeyVerifier(db.asClient()), sessions: { resolve: vi.fn() } }),
    ).rejects.toMatchObject({ status: 403, code: "plan_without_api_access" });
  });
});

describe("SupabaseSessionResolver", () => {
  it("returns the signed-in user with their plan, or null", async () => {
    const admin = new FakeSupabase().seed("profiles", [{ id: UID, plan: "business" }]);
    const userClient = new FakeSupabase();
    userClient.auth.getUser = async () => ({ data: { user: { id: UID } }, error: null }) as any;
    const resolver = new SupabaseSessionResolver(admin.asClient(), async () => userClient.asClient());
    expect(await resolver.resolve(new Request("https://x.test"))).toEqual({ userId: UID, plan: "business", livemode: false });

    const anon = new SupabaseSessionResolver(admin.asClient(), async () => new FakeSupabase().asClient());
    expect(await anon.resolve(new Request("https://x.test"))).toBeNull();
  });
});

describe("SupabaseUsageService", () => {
  function setup() {
    const db = new FakeSupabase().seed("profiles", [{ id: UID, stripe_customer_id: "cus_1" }]);
    const fake = makeFakeStripe();
    return { db, ...fake, svc: new SupabaseUsageService(db.asClient(), async () => fake.stripe) };
  }

  it("reserves through consume_quota with the API key and source", async () => {
    const { db, svc } = setup();
    const rpc = vi.fn(() => ({ data: [quotaRow()], error: null }));
    db.rpcHandlers.consume_quota = rpc;
    const r = await svc.reserve(proUser, 2);
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ p_user_id: UID, p_quantity: 2, p_source: "api", p_api_key_id: "k1" }));
    expect(isExceeded(r)).toBe(false);
    if (!isExceeded(r)) expect(r.quota).toEqual({ included: 500, used: 10, hardCap: false, resetsAt: "2026-12-01T00:00:00.000Z" });
  });

  it("returns exceeded for Free at the cap", async () => {
    const { db, svc } = setup();
    db.rpcHandlers.consume_quota = () => ({
      data: [quotaRow({ allowed: false, plan: "free", used: 20, doc_limit: 20, remaining: 0, event_id: null })],
      error: null,
    });
    const r = await svc.reserve({ ...proUser, plan: "free", via: "session" }, 1);
    expect(isExceeded(r) && r.exceeded).toMatchObject({ included: 20, used: 20, hardCap: true });
  });

  it("commit links the document and reports overage to Stripe", async () => {
    const { db, svc, mocks } = setup();
    db.seed("usage_events", [{ id: 7, user_id: UID, overage_quantity: 1, created_at: new Date().toISOString(), reported_at: null }]);
    db.rpcHandlers.consume_quota = () => ({ data: [quotaRow({ used: 501, remaining: 0, overage_quantity: 1 })], error: null });
    const r = await svc.reserve(proUser, 1);
    if (isExceeded(r)) throw new Error("unexpected");
    await r.commit({ documentId: "doc_1", pages: 3, units: 1, model: "m", inputTokens: 10, outputTokens: 5 });
    expect(db.rows("usage_events")[0]).toMatchObject({ document_id: "doc_1", pages: 3, model: "m" });
    expect(mocks.billing.meterEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: "usage_7", payload: { stripe_customer_id: "cus_1", value: "1" } }),
    );
    expect(db.rows("usage_events")[0].reported_at).not.toBeNull();
    await r.release(); // no-op after commit
  });

  it("release frees the reservation once", async () => {
    const { db, svc } = setup();
    db.rpcHandlers.consume_quota = () => ({ data: [quotaRow()], error: null });
    const release = vi.fn(() => ({ data: true, error: null }));
    db.rpcHandlers.release_usage = release;
    const r = await svc.reserve(proUser, 1);
    if (isExceeded(r)) throw new Error("unexpected");
    await r.release();
    await r.release();
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith({ p_event_id: 7 });
  });

  it("summary maps to the dashboard Usage shape", async () => {
    const { db, svc } = setup();
    db.rpcHandlers.get_usage = () => ({ data: [quotaRow({ used: 42, overage: 0 })], error: null });
    expect(await svc.summary(proUser)).toEqual({
      plan: "pro",
      period_start: "2026-11-01T00:00:00.000Z",
      period_end: "2026-12-01T00:00:00.000Z",
      docs_used: 42,
      docs_limit: 500,
    });
  });
});

describe("SupabaseDocumentStore", () => {
  const doc = (id: string, created: string): DocumentRecord => ({
    id,
    filename: `${id}.pdf`,
    mime_type: "application/pdf",
    size_bytes: 100,
    status: "completed",
    created_at: created,
    completed_at: created,
    result: null,
    error: null,
    page_count: 2,
    billable_units: 1,
    warnings: ["totals differ"],
    model: "claude-haiku-5-5",
  });

  it("round-trips a record and hides other users' documents", async () => {
    const db = new FakeSupabase();
    const store = new SupabaseDocumentStore(db.asClient());
    const d = doc("doc_a", "2026-11-12T00:00:00.000Z");
    await store.save(UID, d);
    expect(await store.get(UID, "doc_a")).toEqual(d);
    expect(await store.get("someone-else", "doc_a")).toBeNull();
  });

  it("paginates newest first with a stable cursor, including same-timestamp ties", async () => {
    const db = new FakeSupabase();
    const store = new SupabaseDocumentStore(db.asClient());
    const t = "2026-11-12T00:00:00.000Z";
    for (const [id, ts] of [["doc_1", "2026-11-10T00:00:00.000Z"], ["doc_2", t], ["doc_3", t], ["doc_4", "2026-11-13T00:00:00.000Z"]]) {
      await store.save(UID, doc(id, ts));
    }
    await store.save("other", doc("doc_x", t));

    const p1 = await store.list(UID, { limit: 2 });
    expect(p1.data.map((d) => d.id)).toEqual(["doc_4", "doc_3"]);
    const p2 = await store.list(UID, { limit: 2, cursor: p1.next_cursor! });
    expect(p2.data.map((d) => d.id)).toEqual(["doc_2", "doc_1"]);
    expect(p2.next_cursor).toBeNull();
  });

  it("rejects tampered cursors", async () => {
    const store = new SupabaseDocumentStore(new FakeSupabase().asClient());
    await expect(store.list(UID, { limit: 5, cursor: "garbage" })).rejects.toMatchObject({ status: 400 });
    expect(decodeCursor(encodeCursor("2026-11-12T00:00:00.000Z", 'x",id.gt."'))).toBeNull();
  });
});

describe("SupabaseUploadStore", () => {
  function storage() {
    const createSignedUploadUrl = vi.fn(async (path: string) => ({
      data: { path, signedUrl: `https://sb.test/upload/${path}?token=t`, token: "t" },
      error: null,
    }));
    const download = vi.fn(async (_p: string) => ({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null }));
    const remove = vi.fn(async (_p: string[]) => ({ data: [], error: null }));
    const db = new FakeSupabase() as any;
    db.storage = { from: vi.fn(() => ({ createSignedUploadUrl, download, remove })) };
    return { store: new SupabaseUploadStore(db), createSignedUploadUrl, download, remove };
  }

  it("signs uploads into the user's own folder, up to 20 MB", async () => {
    const { store } = storage();
    const up = await store.createSignedUpload(UID, { filename: "a.pdf", size_bytes: 15_000_000, mime_type: "application/pdf" });
    expect(isOwnUploadPath(UID, up.storage_path)).toBe(true);
    expect(up.upload_url).toContain(up.storage_path);
    expect(up.max_bytes).toBe(20 * 1024 * 1024);
    await expect(store.createSignedUpload(UID, { size_bytes: 21 * 1024 * 1024, mime_type: "application/pdf" })).rejects.toMatchObject({ status: 413 });
    await expect(store.createSignedUpload(UID, { size_bytes: 10, mime_type: "text/html" })).rejects.toMatchObject({ status: 415 });
  });

  it("only reads paths inside the caller's folder", async () => {
    const { store, download } = storage();
    const other = "22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.pdf";
    await expect(store.fetch(UID, other)).rejects.toMatchObject({ status: 404 });
    await expect(store.fetch(UID, `${UID}/../${other}`)).rejects.toMatchObject({ status: 404 });
    expect(download).not.toHaveBeenCalled();
    const mine = `${UID}/33333333-3333-4333-8333-333333333333.pdf`;
    expect((await store.fetch(UID, mine)).bytes).toEqual(new Uint8Array([1, 2, 3]));
  });
});
