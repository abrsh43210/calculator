import { createHash } from "node:crypto";
import { PLANS, type PlanId } from "@/lib/pricing";
import { HttpError } from "./errors";

/** Keys look like dp_live_<24-64 alphanumerics> or dp_test_<...>. */
export const API_KEY_PATTERN = /^dp_(live|test)_[A-Za-z0-9]{24,64}$/;

export interface Principal {
  userId: string;
  /** Current plan from billing (lib/pricing.ts). */
  plan: PlanId;
  /** How the caller authenticated. API-key calls need a plan with API access. */
  via: "api_key" | "session";
  /** Set when via === "api_key". */
  apiKeyId?: string;
  livemode: boolean;
}

/**
 * Thread 3 implements against Supabase: look up hashApiKey(rawKey) (never store raw
 * keys), reject revoked keys, update last_used_at. Return null if unknown.
 */
export interface ApiKeyVerifier {
  verify(rawKey: string): Promise<Omit<Principal, "via"> | null>;
}

/**
 * Thread 3 implements with the Supabase SSR client: read the auth cookie from the
 * request, return the signed-in user and their plan, or null if not signed in.
 */
export interface SessionResolver {
  resolve(req: Request): Promise<Omit<Principal, "via"> | null>;
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

/** Accepts `Authorization: Bearer <key>` or `x-api-key: <key>`. */
export function extractApiKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(auth);
    return m ? m[1] : null;
  }
  return req.headers.get("x-api-key")?.trim() || null;
}

/**
 * API key if one is sent (it wins, and must be valid), otherwise the browser session
 * used by the dashboard. API-key callers must be on a plan with API access.
 */
export async function authenticate(
  req: Request,
  deps: { apiKeys: ApiKeyVerifier; sessions: SessionResolver },
): Promise<Principal> {
  const sentKey = req.headers.has("authorization") || req.headers.has("x-api-key");
  if (sentKey) {
    const key = extractApiKey(req);
    if (!key || !API_KEY_PATTERN.test(key)) {
      throw new HttpError(401, "authentication_error", "invalid_api_key", "The API key is malformed.");
    }
    const found = await deps.apiKeys.verify(key);
    if (!found) {
      throw new HttpError(401, "authentication_error", "invalid_api_key", "The API key is invalid or has been revoked.");
    }
    const principal: Principal = { ...found, via: "api_key" };
    requireApiAccess(principal);
    return principal;
  }
  const session = await deps.sessions.resolve(req);
  if (session) return { ...session, via: "session" };
  throw new HttpError(401, "authentication_error", "unauthenticated",
    "Sign in, or provide an API key as 'Authorization: Bearer <key>' or the 'x-api-key' header.",
    { "www-authenticate": 'Bearer realm="docparse"' });
}

/** API access is a paid feature (Pro and Business); Free is web-app only. */
export function requireApiAccess(principal: Principal): void {
  const plan = PLANS.find((p) => p.id === principal.plan);
  if (!plan?.apiAccess) {
    throw new HttpError(403, "permission_error", "plan_without_api_access",
      "Your plan does not include API access. Upgrade to Pro or Business to use the API.");
  }
}
