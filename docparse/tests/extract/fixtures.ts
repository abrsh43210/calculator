import type { Extraction } from "@/lib/extract/schema";
import type { ExtractorClient } from "@/lib/extract/extractor";

export const PDF_BYTES = new Uint8Array(
  Buffer.from("%PDF-1.7\n1 0 obj << /Type /Pages /Count 2 >>\n2 0 obj << /Type /Page >>\n3 0 obj << /Type /Page >>\n%%EOF"),
);
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
export const WEBP_BYTES = new Uint8Array(Buffer.from("RIFF\0\0\0\0WEBPVP8 "));
export const GIF_BYTES_UNSUPPORTED = new Uint8Array(Buffer.from("GIF89a"));
export const TEXT_BYTES = new Uint8Array(Buffer.from("hello, this is not a document"));

const party = { name: null, address: null, tax_id: null, email: null, phone: null };

export function sampleInvoice(overrides: Partial<Extraction> = {}): Extraction {
  return {
    document_type: "invoice",
    invoice_number: "INV-1001",
    issue_date: "2026-10-01",
    due_date: "2026-10-31",
    currency: "USD",
    vendor: { ...party, name: "Acme Corp", tax_id: "US123", address: "1 Main St, Springfield" },
    customer: { ...party, name: "Globex LLC" },
    line_items: [
      { description: "Widget", quantity: 2, unit_price: 50, amount: 100, tax_rate: 10, sku: "W-1" },
      { description: "Setup, on-site", quantity: 1, unit_price: 25.5, amount: 25.5, tax_rate: 10, sku: null },
    ],
    subtotal: 125.5,
    discount_total: null,
    tax: 12.55,
    shipping_total: null,
    total: 138.05,
    amount_paid: null,
    amount_due: 138.05,
    payment_method: null,
    payment_terms: "Net 30",
    notes: null,
    field_confidence: {
      vendor_name: 0.98, vendor_tax_id: 0.9, customer_name: null, invoice_number: 0.99, issue_date: 0.98,
      due_date: 0.97, currency: 0.9, subtotal: 0.99, tax: 0.99, total: 0.99, line_items: 0.92,
    },
    confidence: 0.95,
    ...overrides,
  };
}

export interface FakeResponse {
  stop_reason?: string;
  parsed_output?: unknown;
  model?: string;
}

/** A fake Anthropic client. Records every params object it was called with. */
export function pdfWithPages(n: number): Uint8Array {
  return new Uint8Array(Buffer.from("%PDF-1.7\n" + "<< /Type /Page >>\n".repeat(n) + "%%EOF"));
}

type Responder = FakeResponse | (() => Promise<FakeResponse>);

/** A fake Anthropic client. Pass an array to answer successive calls differently. */
export function fakeClient(respond: Responder | Responder[] = {}) {
  const calls: any[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (params: any) => {
          calls.push(params);
          const pick = Array.isArray(respond) ? respond[Math.min(calls.length - 1, respond.length - 1)] : respond;
          const r = typeof pick === "function" ? await pick() : pick;
          return {
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: r.model ?? params.model,
            stop_reason: r.stop_reason ?? "end_turn",
            content: [],
            parsed_output: "parsed_output" in r ? r.parsed_output : sampleInvoice(),
            usage: { input_tokens: 1500, output_tokens: 400 },
          };
        },
      },
    },
  } as unknown as ExtractorClient;
  return { client, calls };
}
