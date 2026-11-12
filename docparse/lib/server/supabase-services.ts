import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DocumentListResponse, DocumentRecord, Usage } from "@/lib/api/types";
import type { PlanId } from "@/lib/pricing";
import { hasOverage } from "@/lib/billing/plans";
import { consumeQuota, getUsage, releaseUsage, reportOverage, type PendingUsage } from "@/lib/quota";
import { MAX_FILE_BYTES } from "@/lib/extract/file";
import type { ApiKeyVerifier, Principal, SessionResolver } from "./auth";
import { hashApiKey } from "./auth";
import type { DocumentStore } from "./documents";
import { HttpError } from "./errors";
import type { QuotaStatus, UsageCommit, UsageReservation, UsageService } from "./usage";
import type { Services } from "./services";
import type { SignedUpload, UploadStore } from "./uploads";

/**
 * Supabase + Stripe implementations of Thread 2's service interfaces.
 * Wired up by getServices() in lib/server/services.ts when Supabase env is set.
 * (No "server-only" import here so the module can load under Vitest; nothing
 * in it is imported by client components.)
 */

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Builds the production Services from env. */
export function createSupabaseServices(): Services {
  const admin = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const getUserClient = async () => (await import("@/lib/supabase/server")).createClient();
  const getStripe = async () => (await import("@/lib/stripe")).getStripe();
  return {
    apiKeys: new SupabaseApiKeyVerifier(admin),
    sessions: new SupabaseSessionResolver(admin, getUserClient),
    usage: new SupabaseUsageService(admin, getStripe),
    documents: new SupabaseDocumentStore(admin),
    uploads: new SupabaseUploadStore(admin),
  };
}

const livemodeFromStripe = () => Boolean(process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_"));

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------
export class SupabaseApiKeyVerifier implements ApiKeyVerifier {
  constructor(private admin: SupabaseClient) {}

  /** Looks up sha256(rawKey), rejects revoked keys, stamps last_used_at. Plan checks happen in authenticate(). */
  async verify(rawKey: string): Promise<Omit<Principal, "via"> | null> {
    const { data, error } = await this.admin.rpc("verify_api_key", { p_key_hash: hashApiKey(rawKey) });
    if (error) {
      throw new HttpError(503, "api_error", "auth_unavailable", "Could not verify the API key. Please retry.");
    }
    const row = (Array.isArray(data) ? data[0] : data) as { key_id: string; user_id: string; plan: PlanId } | undefined;
    if (!row) return null;
    return { userId: row.user_id, plan: row.plan, apiKeyId: row.key_id, livemode: rawKey.startsWith("dp_live_") };
  }
}

// ---------------------------------------------------------------------------
// Browser sessions
// ---------------------------------------------------------------------------
export class SupabaseSessionResolver implements SessionResolver {
  constructor(
    private admin: SupabaseClient,
    /** Cookie-bound client for the current request (lib/supabase/server createClient). */
    private getUserClient: () => Promise<SupabaseClient>,
  ) {}

  async resolve(_req: Request): Promise<Omit<Principal, "via"> | null> {
    const supabase = await this.getUserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await this.admin.from("profiles").select("plan").eq("id", user.id).maybeSingle();
    if (error) throw new HttpError(503, "api_error", "auth_unavailable", "Could not load your account. Please retry.");
    return { userId: user.id, plan: ((data?.plan as PlanId) ?? "free"), livemode: livemodeFromStripe() };
  }
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------
export class SupabaseUsageService implements UsageService {
  constructor(
    private admin: SupabaseClient,
    private stripe: () => Promise<Stripe>,
  ) {}

  /** Atomic reserve via consume_quota (advisory lock + insert in one transaction). */
  async reserve(principal: Principal, units: number): Promise<UsageReservation | { exceeded: QuotaStatus }> {
    const q = await consumeQuota(this.admin, {
      userId: principal.userId,
      quantity: units,
      source: principal.via === "api_key" ? "api" : "web",
      apiKeyId: principal.apiKeyId ?? null,
    });
    const quota: QuotaStatus = {
      included: q.limit,
      used: q.used,
      hardCap: !hasOverage(q.plan),
      resetsAt: q.periodEnd,
    };
    if (!q.allowed || q.eventId == null) return { exceeded: quota };

    const eventId = q.eventId;
    const overage = q.overageQuantity;
    let settled = false;
    const admin = this.admin;
    const stripe = this.stripe;

    return {
      quota,
      async commit(e: UsageCommit) {
        if (settled) return;
        settled = true;
        const { data, error } = await admin
          .from("usage_events")
          .update({
            document_id: e.documentId,
            pages: e.pages,
            model: e.model,
            input_tokens: e.inputTokens,
            output_tokens: e.outputTokens,
          })
          .eq("id", eventId)
          .select("id, user_id, overage_quantity, created_at")
          .maybeSingle();
        if (error) throw new Error(`usage commit failed: ${error.message}`);
        if (overage > 0 && data) {
          // Failure here is retried by the hourly /api/cron/report-usage sweep.
          await reportOverage({ stripe: await stripe(), db: admin }, [data as PendingUsage]);
        }
      },
      async release() {
        if (settled) return;
        settled = true;
        await releaseUsage(admin, eventId);
      },
    };
  }

  async summary(principal: Principal): Promise<Usage> {
    const u = await getUsage(this.admin, principal.userId);
    return {
      plan: u.plan,
      period_start: u.periodStart,
      period_end: u.periodEnd,
      docs_used: u.used,
      docs_limit: u.limit,
    };
  }
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
interface DocumentRow {
  id: string;
  user_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: DocumentRecord["status"];
  page_count: number | null;
  billable_units: number | null;
  model: string | null;
  warnings: string[] | null;
  result: DocumentRecord["result"];
  error: string | null;
  completed_at: string | null;
  created_at: string;
}

const DOC_COLUMNS =
  "id, user_id, filename, mime_type, size_bytes, status, page_count, billable_units, model, warnings, result, error, completed_at, created_at";

function toRecord(r: DocumentRow): DocumentRecord {
  const doc: DocumentRecord = {
    id: r.id,
    filename: r.filename,
    mime_type: r.mime_type,
    size_bytes: Number(r.size_bytes),
    status: r.status,
    created_at: new Date(r.created_at).toISOString(),
    completed_at: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    result: r.result,
    error: r.error,
  };
  if (r.page_count != null) doc.page_count = r.page_count;
  if (r.billable_units != null) doc.billable_units = r.billable_units;
  if (r.warnings && r.warnings.length > 0) doc.warnings = r.warnings;
  if (r.model) doc.model = r.model;
  return doc;
}

export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAt, id])).toString("base64url");
}

export function decodeCursor(cursor: string): [string, string] | null {
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(v) && v.length === 2 && !Number.isNaN(Date.parse(v[0])) && /^[\w-]{1,64}$/.test(v[1])) {
      return [v[0], v[1]];
    }
  } catch {
    /* fall through */
  }
  return null;
}

export class SupabaseDocumentStore implements DocumentStore {
  constructor(private admin: SupabaseClient) {}

  async save(userId: string, doc: DocumentRecord): Promise<void> {
    const { error } = await this.admin.from("documents").upsert(
      {
        id: doc.id,
        user_id: userId,
        filename: doc.filename,
        mime_type: doc.mime_type,
        size_bytes: doc.size_bytes,
        status: doc.status,
        page_count: doc.page_count ?? null,
        billable_units: doc.billable_units ?? null,
        model: doc.model ?? null,
        warnings: doc.warnings ?? [],
        result: doc.result,
        error: doc.error,
        completed_at: doc.completed_at,
        created_at: doc.created_at,
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(`document save failed: ${error.message}`);
  }

  async get(userId: string, id: string): Promise<DocumentRecord | null> {
    const { data, error } = await this.admin
      .from("documents")
      .select(DOC_COLUMNS)
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`document get failed: ${error.message}`);
    return data ? toRecord(data as DocumentRow) : null;
  }

  /** Newest first, keyset-paginated on (created_at, id). */
  async list(userId: string, opts: { cursor?: string; limit: number }): Promise<DocumentListResponse> {
    let query = this.admin
      .from("documents")
      .select(DOC_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(opts.limit + 1);

    if (opts.cursor) {
      const c = decodeCursor(opts.cursor);
      if (!c) throw new HttpError(400, "invalid_request_error", "invalid_cursor", "The cursor is invalid.");
      const [ts, id] = c;
      query = query.or(`created_at.lt."${ts}",and(created_at.eq."${ts}",id.lt."${id}")`);
    }

    const { data, error } = await query;
    if (error) throw new Error(`document list failed: ${error.message}`);
    const rows = (data ?? []) as DocumentRow[];
    const page = rows.slice(0, opts.limit).map(toRecord);
    const last = rows.length > opts.limit ? rows[opts.limit - 1] : null;
    return {
      data: page,
      next_cursor: last ? encodeCursor(new Date(last.created_at).toISOString(), last.id) : null,
    };
  }
}

// ---------------------------------------------------------------------------
// Large uploads: signed upload straight to Supabase Storage (skips Vercel's 4.5 MB body limit)
// ---------------------------------------------------------------------------
export const UPLOAD_BUCKET = "documents";
const UPLOAD_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export class SupabaseUploadStore implements UploadStore {
  constructor(private admin: SupabaseClient) {}

  async createSignedUpload(
    userId: string,
    file: { filename?: unknown; size_bytes?: unknown; mime_type?: unknown },
  ): Promise<SignedUpload> {
    const mime = typeof file.mime_type === "string" ? file.mime_type.toLowerCase() : "";
    const ext = UPLOAD_TYPES[mime];
    if (!ext) {
      throw new HttpError(415, "invalid_request_error", "unsupported_file_type", "Upload a PDF, PNG, JPG or WEBP file.");
    }
    const size = Number(file.size_bytes);
    if (!Number.isFinite(size) || size <= 0) {
      throw new HttpError(400, "invalid_request_error", "invalid_size", "size_bytes must be a positive number.");
    }
    if (size > MAX_FILE_BYTES) {
      throw new HttpError(413, "invalid_request_error", "file_too_large", `The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
    }

    const path = `${userId}/${randomUUID()}.${ext}`;
    const { data, error } = await this.admin.storage.from(UPLOAD_BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      throw new HttpError(503, "api_error", "storage_unavailable", "Could not prepare the upload. Please retry.");
    }
    return { storage_path: data.path ?? path, upload_url: data.signedUrl, token: data.token, max_bytes: MAX_FILE_BYTES };
  }

  /** Reads an uploaded file. Only paths inside the caller's own folder are allowed. */
  async fetch(userId: string, storagePath: string): Promise<{ bytes: Uint8Array; fileName: string }> {
    if (!isOwnUploadPath(userId, storagePath)) {
      throw new HttpError(404, "not_found_error", "upload_not_found", "No upload at that storage_path.");
    }
    const { data, error } = await this.admin.storage.from(UPLOAD_BUCKET).download(storagePath);
    if (error || !data) {
      throw new HttpError(404, "not_found_error", "upload_not_found", "No upload at that storage_path.");
    }
    if (data.size > MAX_FILE_BYTES) {
      throw new HttpError(413, "invalid_request_error", "file_too_large", `The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
    }
    return { bytes: new Uint8Array(await data.arrayBuffer()), fileName: storagePath.split("/").pop()! };
  }

  /** Delete the original after extraction (we promise not to keep files longer than needed). */
  async remove(userId: string, storagePath: string): Promise<void> {
    if (!isOwnUploadPath(userId, storagePath)) return;
    const { error } = await this.admin.storage.from(UPLOAD_BUCKET).remove([storagePath]);
    if (error) console.warn("[docparse] could not delete upload", storagePath, error.message);
  }
}

export function isOwnUploadPath(userId: string, path: string): boolean {
  return /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|png|jpg|webp)$/.test(path) && path.startsWith(`${userId}/`);
}
