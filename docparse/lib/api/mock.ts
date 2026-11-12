import type { DocParseApi } from "./client";
import { ApiError } from "./errors";
import { getPlan } from "@/lib/pricing";
import type {
  ApiKey,
  DocumentRecord,
  ExtractionResult,
  Subscription,
  Usage,
} from "./types";

/**
 * In-memory mock of the DocParse API. Lives in the browser, resets on reload.
 * Upload a file and it moves queued → processing → completed over ~2s.
 */


const sampleInvoice: ExtractionResult = {
  document_type: "invoice",
  vendor: { name: "Northwind Supplies Ltd.", address: "12 Harbour St, Bristol BS1 4QA, UK", tax_id: "GB123456789" },
  customer: { name: "Acme Analytics Inc.", address: "500 Market St, San Francisco, CA 94105", tax_id: null },
  invoice_number: "INV-2026-0417",
  issue_date: "2026-11-02",
  due_date: "2026-12-02",
  currency: "USD",
  subtotal: 1240,
  tax: 99.2,
  total: 1339.2,
  line_items: [
    { description: "Ergonomic office chair", quantity: 4, unit_price: 210, amount: 840 },
    { description: "Standing desk converter", quantity: 2, unit_price: 150, amount: 300 },
    { description: "Delivery & assembly", quantity: 1, unit_price: 100, amount: 100 },
  ],
  confidence: 0.97,
  field_confidence: {
    "vendor.name": 0.99,
    "vendor.tax_id": 0.95,
    "customer.name": 0.98,
    invoice_number: 0.99,
    issue_date: 0.97,
    due_date: 0.9,
    currency: 0.99,
    subtotal: 0.98,
    tax: 0.93,
    total: 0.99,
    line_items: 0.95,
  },
};

const sampleReceipt: ExtractionResult = {
  document_type: "receipt",
  vendor: { name: "Blue Bottle Coffee", address: "66 Mint St, San Francisco, CA", tax_id: null },
  customer: null,
  invoice_number: "R-88213",
  issue_date: "2026-11-09",
  due_date: null,
  currency: "USD",
  subtotal: 18.5,
  tax: 1.6,
  total: 20.1,
  line_items: [
    { description: "Oat latte", quantity: 2, unit_price: 6.25, amount: 12.5 },
    { description: "Almond croissant", quantity: 1, unit_price: 6, amount: 6 },
  ],
  confidence: 0.92,
  field_confidence: {
    "vendor.name": 0.97,
    invoice_number: 0.71,
    issue_date: 0.94,
    currency: 0.9,
    subtotal: 0.95,
    tax: 0.82,
    total: 0.98,
    line_items: 0.89,
  },
};

function seed(): DocumentRecord[] {
  return [
    {
      id: "doc_01HX9A",
      filename: "northwind-invoice-0417.pdf",
      mime_type: "application/pdf",
      size_bytes: 248_312,
      status: "completed",
      created_at: "2026-11-10T14:03:00Z",
      completed_at: "2026-11-10T14:03:04Z",
      result: sampleInvoice,
      error: null,
    },
    {
      id: "doc_01HX9B",
      filename: "coffee-receipt.jpg",
      mime_type: "image/jpeg",
      size_bytes: 1_204_221,
      status: "completed",
      created_at: "2026-11-09T09:12:00Z",
      completed_at: "2026-11-09T09:12:03Z",
      result: sampleReceipt,
      error: null,
    },
    {
      id: "doc_01HX9C",
      filename: "blurry-scan.png",
      mime_type: "image/png",
      size_bytes: 3_901_002,
      status: "failed",
      created_at: "2026-11-08T17:45:00Z",
      completed_at: "2026-11-08T17:45:06Z",
      result: null,
      error: "The image is too blurry to read. Try a sharper scan or photo.",
    },
  ];
}

interface MockState {
  docs: DocumentRecord[];
  keys: ApiKey[];
  subscription: Subscription;
  docsUsed: number;
}

function initialState(): MockState {
  return {
    docs: seed(),
    keys: [
      {
        id: "key_01",
        name: "Production server",
        prefix: "dp_live_7c1e",
        created_at: "2026-10-28T10:00:00Z",
        last_used_at: "2026-11-11T22:14:00Z",
      },
    ],
    subscription: { plan: "pro", status: "active", current_period_end: "2026-12-01T00:00:00Z", cancel_at_period_end: false },
    docsUsed: 137,
  };
}

let state = initialState();

/** Test helper: reset the mock store. */
export function __resetMock() {
  state = initialState();
}

/** Latency in ms; tests set it to 0. */
export const mockConfig = { latency: 300, processingMs: 1800 };

const wait = (ms = mockConfig.latency) => new Promise((r) => setTimeout(r, ms));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const rid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;


export const mockApi: DocParseApi = {
  async parse(file) {
    await wait();
    const plan = getPlan(state.subscription.plan);
    if (plan.overagePerDoc === null && state.docsUsed >= plan.includedDocs) {
      throw new ApiError(429, "quota_exceeded", "You've used all documents for this month. Upgrade to keep parsing.");
    }
    const doc: DocumentRecord = {
      id: rid("doc"),
      filename: file.name,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      status: "processing",
      created_at: new Date().toISOString(),
      completed_at: null,
      result: null,
      error: null,
    };
    state.docs.unshift(doc);
    state.docsUsed += 1;
    setTimeout(() => {
      const d = state.docs.find((x) => x.id === doc.id);
      if (!d) return;
      d.status = "completed";
      d.completed_at = new Date().toISOString();
      const isReceipt = /receipt|\.jpe?g$|\.png$|\.webp$/i.test(file.name);
      d.result = clone(isReceipt ? sampleReceipt : sampleInvoice);
    }, mockConfig.processingMs);
    return { id: doc.id, status: doc.status };
  },

  async getDocument(id) {
    await wait();
    const d = state.docs.find((x) => x.id === id);
    if (!d) throw new ApiError(404, "not_found", "Document not found.");
    return clone(d);
  },

  async listDocuments(opts = {}) {
    await wait();
    const limit = opts.limit ?? 50;
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const data = state.docs.slice(start, start + limit);
    const next = start + limit < state.docs.length ? String(start + limit) : null;
    return { data: clone(data), next_cursor: next };
  },

  async getUsage(): Promise<Usage> {
    await wait();
    const plan = getPlan(state.subscription.plan);
    return {
      plan: plan.id,
      period_start: "2026-11-01T00:00:00Z",
      period_end: "2026-12-01T00:00:00Z",
      docs_used: state.docsUsed,
      docs_limit: plan.includedDocs,
    };
  },

  async getSubscription() {
    await wait();
    return clone(state.subscription);
  },

  async startCheckout(plan) {
    await wait();
    const wasPaying = state.subscription.status === "active" && state.subscription.plan !== "free";
    state.subscription = { ...state.subscription, plan, status: "active" };
    return wasPaying
      ? { url: `/billing?checkout=updated&plan=${plan}`, kind: "updated" as const }
      : { url: `/billing?checkout=success&plan=${plan}`, kind: "checkout" as const };
  },

  async openBillingPortal() {
    await wait();
    return { url: "/billing?portal=mock" };
  },

  async listApiKeys() {
    await wait();
    return clone(state.keys);
  },

  async createApiKey(name) {
    await wait();
    if (!getPlan(state.subscription.plan).apiAccess) {
      throw new ApiError(403, "plan_without_api_access", "API access is available on the Pro and Business plans.");
    }
    const trimmed = name.trim();
    if (!trimmed) throw new ApiError(400, "invalid_name", "Give the key a name.");
    const secret = `dp_live_${Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
    const key: ApiKey = {
      id: rid("key"),
      name: trimmed,
      prefix: secret.slice(0, 12),
      created_at: new Date().toISOString(),
      last_used_at: null,
    };
    state.keys.unshift(key);
    return { ...clone(key), secret };
  },

  async revokeApiKey(id) {
    await wait();
    const before = state.keys.length;
    state.keys = state.keys.filter((k) => k.id !== id);
    if (state.keys.length === before) throw new ApiError(404, "not_found", "API key not found.");
  },
};
