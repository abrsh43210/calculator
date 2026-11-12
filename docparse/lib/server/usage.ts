import type { Usage } from "@/lib/api/types";
import type { Principal } from "./auth";

export interface QuotaStatus {
  /** Documents included this billing period. */
  included: number;
  /** Documents used this period, including the current reservation if any. */
  used: number;
  /** true on plans without overage (Free): usage stops at `included`. */
  hardCap: boolean;
  /** ISO timestamp when the period resets. */
  resetsAt: string | null;
}

export interface UsageCommit {
  documentId: string;
  pages: number;
  /** Billable documents: ceil(pages / 5). Equal to the reserved units. */
  units: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageReservation {
  quota: QuotaStatus;
  /** After a successful extraction: record the usage row (and the Stripe meter event for overage). */
  commit(event: UsageCommit): Promise<void>;
  /** When extraction fails, so the customer is not charged. Idempotent. */
  release(): Promise<void>;
}

/**
 * Thread 3 implements with Supabase + Stripe. `reserve` must be atomic (one Postgres
 * UPDATE ... SET used = used + units WHERE NOT hard_cap OR used + units <= included
 * RETURNING ...) so concurrent requests cannot both take the last units. Return
 * { exceeded } when a hard-capped plan has no room left.
 */
export interface UsageService {
  reserve(principal: Principal, units: number): Promise<UsageReservation | { exceeded: QuotaStatus }>;
  /** Current period summary for GET /api/v1/usage. */
  summary(principal: Principal): Promise<Usage>;
}

export function isExceeded(r: UsageReservation | { exceeded: QuotaStatus }): r is { exceeded: QuotaStatus } {
  return "exceeded" in r;
}

export function quotaHeaders(q: QuotaStatus): Record<string, string> {
  const h: Record<string, string> = {
    "x-quota-included": String(q.included),
    "x-quota-used": String(q.used),
    "x-quota-remaining": String(Math.max(0, q.included - q.used)),
  };
  if (q.resetsAt) h["x-quota-reset"] = q.resetsAt;
  return h;
}
