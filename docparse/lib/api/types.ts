/**
 * Shared API contract for DocParse.
 * Mirrors POST /api/v1/parse and GET /api/v1/documents/:id.
 * Thread 2 (extraction API) and Thread 3 (auth/DB/Stripe) should import these
 * types rather than redefine them, so the UI and server stay in sync.
 */

export type DocumentStatus = "queued" | "processing" | "completed" | "failed";
export type DocumentType = "invoice" | "receipt" | "unknown";
export type OutputFormat = "json" | "csv";

export interface Party {
  name: string | null;
  address: string | null;
  tax_id: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface LineItem {
  description: string;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
  /** Percent, e.g. 20 for 20%. */
  tax_rate?: number | null;
  sku?: string | null;
}

/** Fields that carry a per-field confidence score. */
export type ConfidenceField =
  | "vendor.name"
  | "vendor.tax_id"
  | "customer.name"
  | "invoice_number"
  | "issue_date"
  | "due_date"
  | "currency"
  | "subtotal"
  | "tax"
  | "total"
  | "line_items";

export interface ExtractionResult {
  document_type: DocumentType;
  vendor: Party;
  customer: Party | null;
  invoice_number: string | null;
  issue_date: string | null; // ISO date YYYY-MM-DD
  due_date: string | null;
  currency: string | null; // ISO 4217
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  line_items: LineItem[];
  /** 0..1 overall extraction confidence */
  confidence: number;
  /** 0..1 confidence per field. Fields the model didn't score are omitted. */
  field_confidence?: Partial<Record<ConfidenceField, number>>;
  // Extra fields returned by the server extractor (optional for older/mock data).
  discount_total?: number | null;
  shipping_total?: number | null;
  amount_paid?: number | null;
  amount_due?: number | null;
  payment_method?: string | null;
  payment_terms?: string | null;
  notes?: string | null;
}

export interface DocumentRecord {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: DocumentStatus;
  created_at: string; // ISO timestamp
  completed_at: string | null;
  result: ExtractionResult | null;
  error: string | null;
  // Set by the server extractor.
  /** Pages detected (images count as 1). */
  page_count?: number;
  /** Documents billed: ceil(page_count / 5). */
  billable_units?: number;
  /** Data-quality notes, e.g. totals that do not add up. */
  warnings?: string[];
  /** Claude model whose output was used. */
  model?: string;
}

/** Response of POST /api/v1/parse */
export interface ParseResponse {
  id: string;
  status: DocumentStatus;
  /** Present when the server parsed synchronously. */
  document?: DocumentRecord;
}

export interface DocumentListResponse {
  data: DocumentRecord[];
  next_cursor: string | null;
}

// Plans and prices live in lib/pricing.ts (single source of truth).
import type { PlanId } from "@/lib/pricing";
export type { PlanId };

export interface Usage {
  plan: PlanId;
  period_start: string;
  period_end: string;
  docs_used: number;
  docs_limit: number;
}

export interface ApiKey {
  id: string;
  name: string;
  /** e.g. "dp_live_3f9a" — never the full secret after creation */
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface CreatedApiKey extends ApiKey {
  /** Full secret, returned exactly once at creation. */
  secret: string;
}

export interface Subscription {
  plan: PlanId;
  status: "active" | "trialing" | "past_due" | "canceled" | "none";
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string; type?: string; request_id?: string };
}
