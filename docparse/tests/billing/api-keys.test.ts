// @vitest-environment node
import { createApiKey, generateApiKey, hashApiKey, looksLikeApiKey, MAX_KEYS_PER_USER } from "@/lib/api-keys";
import { API_KEY_PATTERN } from "@/lib/server/auth";
import { FakeSupabase } from "./helpers/fake-supabase";

const USER = "user-1";

describe("API key generation", () => {
  it("creates well-formed, unique keys and stores only a hash", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(looksLikeApiKey(a.key)).toBe(true);
    expect(a.key).not.toBe(b.key);
    expect(a.key).toMatch(API_KEY_PATTERN); // Thread 2's authenticate() format
    expect(a.key.startsWith("dp_test_")).toBe(true); // no live Stripe key in tests
    expect(generateApiKey("dp_live_").key.startsWith("dp_live_")).toBe(true);
    expect(a.prefix).toBe(a.key.slice(0, 12));
    expect(a.hash).toBe(hashApiKey(a.key));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.key);
  });
});

describe("createApiKey", () => {
  it("refuses Free users", async () => {
    const db = new FakeSupabase().seed("profiles", [{ id: USER, plan: "free" }]);
    await expect(createApiKey(db.asClient(), USER, "ci")).rejects.toMatchObject({ status: 403, code: "plan_without_api_access" });
  });

  it("creates a key for Pro users and returns the secret once", async () => {
    const db = new FakeSupabase().seed("profiles", [{ id: USER, plan: "pro" }]);
    const { key, record } = await createApiKey(db.asClient(), USER, "  CI server  ");
    expect(looksLikeApiKey(key)).toBe(true);
    expect(record.name).toBe("CI server");
    const stored = db.rows("api_keys")[0];
    expect(stored.key_hash).toBe(hashApiKey(key));
    expect(JSON.stringify(stored)).not.toContain(key);
    expect(record).not.toHaveProperty("key_hash");
  });

  it("caps active keys per user", async () => {
    const keys = Array.from({ length: MAX_KEYS_PER_USER }, (_, i) => ({ id: `k${i}`, user_id: USER, revoked_at: null }));
    const db = new FakeSupabase().seed("profiles", [{ id: USER, plan: "business" }]).seed("api_keys", keys);
    await expect(createApiKey(db.asClient(), USER, "one more")).rejects.toMatchObject({ status: 409 });
  });

  it("validates the name", async () => {
    const db = new FakeSupabase().seed("profiles", [{ id: USER, plan: "pro" }]);
    await expect(createApiKey(db.asClient(), USER, "   ")).rejects.toMatchObject({ code: "invalid_name" });
    await expect(createApiKey(db.asClient(), USER, "x".repeat(65))).rejects.toMatchObject({ code: "invalid_name" });
  });
});

