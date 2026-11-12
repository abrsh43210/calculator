import type { DocParseApi } from "./client";
import { ApiError } from "./errors";
import type { ApiErrorBody, ParseResponse } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { credentials: "include", ...init });
  } catch {
    throw new ApiError(0, "network_error", "Could not reach DocParse. Check your connection and try again.");
  }
  if (!res.ok) {
    let body: Partial<ApiErrorBody> = {};
    try {
      body = await res.json();
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(
      res.status,
      body.error?.code ?? "http_error",
      body.error?.message ?? `Request failed (${res.status})`,
      body.error?.request_id ?? res.headers.get("x-request-id") ?? undefined,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Vercel rejects request bodies over 4.5 MB; bigger files go through a signed Storage upload. */
export const DIRECT_UPLOAD_THRESHOLD = 4 * 1024 * 1024;

interface SignedUpload {
  storage_path: string;
  upload_url: string;
}

async function parseLarge(file: File): Promise<ParseResponse> {
  const signed = await request<SignedUpload>(
    "/api/v1/uploads",
    json({ filename: file.name, size_bytes: file.size, mime_type: file.type }),
  );
  let put: Response;
  try {
    put = await fetch(signed.upload_url, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
  } catch {
    throw new ApiError(0, "network_error", "The upload was interrupted. Check your connection and try again.");
  }
  if (!put.ok) throw new ApiError(put.status, "upload_failed", `Uploading ${file.name} failed (${put.status}). Please try again.`);
  return request<ParseResponse>("/api/v1/parse", json({ storage_path: signed.storage_path, filename: file.name }));
}

export const httpApi: DocParseApi = {
  parse(file) {
    if (file.size > DIRECT_UPLOAD_THRESHOLD) return parseLarge(file);
    const form = new FormData();
    form.append("file", file);
    return request("/api/v1/parse", { method: "POST", body: form });
  },
  getDocument: (id) => request(`/api/v1/documents/${encodeURIComponent(id)}`),
  listDocuments(opts = {}) {
    const q = new URLSearchParams();
    if (opts.cursor) q.set("cursor", opts.cursor);
    if (opts.limit) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return request(`/api/v1/documents${qs ? `?${qs}` : ""}`);
  },
  getUsage: () => request("/api/v1/usage"),
  getSubscription: () => request("/api/billing/subscription"),
  startCheckout: (plan) => request("/api/billing/checkout", json({ plan })),
  openBillingPortal: () => request("/api/billing/portal", json({})),
  listApiKeys: () => request("/api/keys"),
  createApiKey: (name) => request("/api/keys", json({ name })),
  revokeApiKey: (id) => request(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
