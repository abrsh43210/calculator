import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/http";
import { hasApiAccess, type PlanId } from "@/lib/billing/plans";
import { API_KEY_PATTERN, hashApiKey } from "@/lib/server/auth";

export { hashApiKey };

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SECRET_CHARS = 32; // ~190 bits
export const MAX_KEYS_PER_USER = 10;

/** dp_live_ in Stripe live mode, dp_test_ otherwise, so test keys can't hit live billing by mistake. */
export function keyPrefixForEnv(): "dp_live_" | "dp_test_" {
  return process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "dp_live_" : "dp_test_";
}

export interface GeneratedKey {
  /** Full secret. Show once, never store. */
  key: string;
  /** Short non-secret prefix for display, e.g. "dp_live_Ab3x". */
  prefix: string;
  hash: string;
}

/** Keys match API_KEY_PATTERN from lib/server/auth.ts: dp_(live|test)_<32 alphanumerics>. */
export function generateApiKey(prefix: "dp_live_" | "dp_test_" = keyPrefixForEnv()): GeneratedKey {
  let secret = "";
  for (let i = 0; i < SECRET_CHARS; i++) secret += ALPHABET[randomInt(ALPHABET.length)];
  const key = prefix + secret;
  return { key, prefix: key.slice(0, prefix.length + 4), hash: hashApiKey(key) };
}

export function looksLikeApiKey(value: string): boolean {
  return API_KEY_PATTERN.test(value);
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/**
 * Creates a key for a user on a plan with API access (Pro or Business).
 * `db` must be the admin client: users can't insert into api_keys directly.
 */
export async function createApiKey(
  db: SupabaseClient,
  userId: string,
  name: string,
): Promise<{ key: string; record: ApiKeyRecord }> {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 64) {
    throw new HttpError(400, "invalid_name", "Key name must be 1 to 64 characters.");
  }

  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw new HttpError(503, "db_error", "Could not load profile.");
  const plan = (profile?.plan ?? "free") as PlanId;
  if (!hasApiAccess(plan)) {
    throw new HttpError(403, "plan_without_api_access", "API access is available on the Pro and Business plans.", {
      requiredPlan: "pro",
    });
  }

  const { count, error: countError } = await db
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (countError) throw new HttpError(503, "db_error", "Could not count API keys.");
  if ((count ?? 0) >= MAX_KEYS_PER_USER) {
    throw new HttpError(409, "too_many_keys", `You can have at most ${MAX_KEYS_PER_USER} active keys.`);
  }

  const generated = generateApiKey();
  const { data, error } = await db
    .from("api_keys")
    .insert({ user_id: userId, name: trimmed, prefix: generated.prefix, key_hash: generated.hash })
    .select("id, name, prefix, last_used_at, revoked_at, created_at")
    .single();
  if (error || !data) throw new HttpError(503, "db_error", "Could not create API key.");

  return { key: generated.key, record: data as ApiKeyRecord };
}
