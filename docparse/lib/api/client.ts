import type {
  ApiKey,
  CreatedApiKey,
  DocumentListResponse,
  DocumentRecord,
  ParseResponse,
  PlanId,
  Subscription,
  Usage,
} from "./types";
import { mockApi } from "./mock";
import { httpApi } from "./http";

export { ApiError, errorMessage } from "./errors";

export interface DocParseApi {
  parse(file: File): Promise<ParseResponse>;
  getDocument(id: string): Promise<DocumentRecord>;
  listDocuments(opts?: { cursor?: string; limit?: number }): Promise<DocumentListResponse>;
  getUsage(): Promise<Usage>;
  getSubscription(): Promise<Subscription>;
  /** Returns a Stripe Checkout or Billing Portal URL to redirect to. */
  startCheckout(plan: PlanId): Promise<{ url: string; kind?: "checkout" | "updated" }>;
  openBillingPortal(): Promise<{ url: string }>;
  listApiKeys(): Promise<ApiKey[]>;
  createApiKey(name: string): Promise<CreatedApiKey>;
  revokeApiKey(id: string): Promise<void>;
}

export const ACCEPTED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
/** Matches the server limit in lib/extract (20 MB). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function validateUpload(file: File): string | null {
  if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return `${file.name}: only PDF, PNG, JPG or WEBP files are supported.`;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `${file.name}: file is larger than 20 MB.`;
  }
  return null;
}

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS !== "false";

export const api: DocParseApi = useMocks ? mockApi : httpApi;
