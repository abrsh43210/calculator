import type { DocumentListResponse, DocumentRecord, Usage } from "@/lib/api/types";
import { PLANS, type PlanId } from "@/lib/pricing";
import type { ApiKeyVerifier, Principal, SessionResolver } from "./auth";
import { hashApiKey } from "./auth";
import type { DocumentStore } from "./documents";
import type { QuotaStatus, UsageReservation, UsageService } from "./usage";

/**
 * In-memory implementations for local dev and tests. They lose state on every cold
 * start, so getServices() refuses them in production.
 */

export const DEV_API_KEY = "dp_test_devkey000000000000000000000000";
type Identity = Omit<Principal, "via">;

export class InMemoryApiKeyVerifier implements ApiKeyVerifier {
  private byHash = new Map<string, Identity>();
  add(rawKey: string, identity: Identity): this {
    this.byHash.set(hashApiKey(rawKey), identity);
    return this;
  }
  async verify(rawKey: string) {
    return this.byHash.get(hashApiKey(rawKey)) ?? null;
  }
}

/** Treats every request carrying the cookie `dp_session=<userId>` as that user. Tests/dev only. */
export class MockSessionResolver implements SessionResolver {
  constructor(private users: Record<string, Identity> = {}, private fallback: Identity | null = null) {}
  async resolve(req: Request) {
    const m = /(?:^|;\s*)dp_session=([^;]+)/.exec(req.headers.get("cookie") ?? "");
    return (m && this.users[m[1]]) || this.fallback;
  }
}

export class InMemoryUsageService implements UsageService {
  readonly used = new Map<string, number>();
  readonly events: Array<{ userId: string; documentId: string; units: number; pages: number }> = [];
  private plans: Record<string, { included: number; hardCap: boolean }>;

  constructor(overrides: Partial<Record<PlanId, { included: number; hardCap: boolean }>> = {}) {
    this.plans = Object.fromEntries(
      PLANS.map((p) => [p.id, overrides[p.id] ?? { included: p.includedDocs, hardCap: p.overagePerDoc === null }]),
    );
  }

  async reserve(p: Principal, units: number): Promise<UsageReservation | { exceeded: QuotaStatus }> {
    const plan = this.plans[p.plan] ?? { included: 0, hardCap: true };
    const current = this.used.get(p.userId) ?? 0;
    if (plan.hardCap && current + units > plan.included) {
      return { exceeded: { included: plan.included, used: current, hardCap: true, resetsAt: null } };
    }
    // Synchronous increment = atomic within one process.
    this.used.set(p.userId, current + units);
    let settled = false;
    return {
      quota: { included: plan.included, used: current + units, hardCap: plan.hardCap, resetsAt: null },
      commit: async (e) => {
        if (settled) return;
        settled = true;
        this.events.push({ userId: p.userId, documentId: e.documentId, units: e.units, pages: e.pages });
      },
      release: async () => {
        if (settled) return;
        settled = true;
        this.used.set(p.userId, Math.max(0, (this.used.get(p.userId) ?? units) - units));
      },
    };
  }

  async summary(p: Principal): Promise<Usage> {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return {
      plan: p.plan,
      period_start: start.toISOString(),
      period_end: end.toISOString(),
      docs_used: this.used.get(p.userId) ?? 0,
      docs_limit: this.plans[p.plan]?.included ?? 0,
    };
  }
}

export class InMemoryDocumentStore implements DocumentStore {
  private docs: Array<{ userId: string; doc: DocumentRecord }> = [];
  async save(userId: string, doc: DocumentRecord) {
    this.docs.push({ userId, doc });
  }
  async get(userId: string, id: string) {
    return this.docs.find((r) => r.userId === userId && r.doc.id === id)?.doc ?? null;
  }
  async list(userId: string, { cursor, limit }: { cursor?: string; limit: number }): Promise<DocumentListResponse> {
    const mine = this.docs.filter((r) => r.userId === userId).map((r) => r.doc).reverse();
    const start = cursor ? mine.findIndex((d) => d.id === cursor) + 1 : 0;
    const page = mine.slice(start, start + limit);
    const more = start + limit < mine.length;
    return { data: page, next_cursor: more ? page[page.length - 1].id : null };
  }
}
