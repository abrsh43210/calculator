import { z } from "zod";
import type { ConfidenceField, ExtractionResult } from "@/lib/api/types";

/**
 * Schema the model fills in via Claude structured outputs. Plain types only
 * (string / number / null / enum / array / object). Every field is
 * required-but-nullable: the model writes null when a value is not on the document.
 * Field names follow lib/api/types.ts so mapping to the public shape is trivial.
 */

export const PartySchema = z.object({
  name: z.string().nullable().describe("Legal or trading name"),
  address: z.string().nullable().describe("Full postal address on one line"),
  tax_id: z.string().nullable().describe("VAT / GST / EIN / ABN or similar tax number"),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});

export const LineItemSchema = z.object({
  description: z.string().describe("Item or service description as written"),
  quantity: z.number().nullable(),
  unit_price: z.number().nullable().describe("Price per unit, in document currency"),
  amount: z.number().nullable().describe("Line total, in document currency"),
  tax_rate: z.number().nullable().describe("Tax rate as a percentage, e.g. 20 for 20%"),
  sku: z.string().nullable().describe("Product code / SKU / item number if shown"),
});

const conf = () => z.number().nullable();
/** Per-field confidence (0 to 1). Keys map 1:1 onto ConfidenceField in lib/api/types.ts. */
export const FieldConfidenceSchema = z.object({
  vendor_name: conf(),
  vendor_tax_id: conf(),
  customer_name: conf(),
  invoice_number: conf(),
  issue_date: conf(),
  due_date: conf(),
  currency: conf(),
  subtotal: conf(),
  tax: conf(),
  total: conf(),
  line_items: conf(),
});

export const ExtractionSchema = z.object({
  document_type: z
    .enum(["invoice", "receipt", "other"])
    .describe("invoice for a bill requesting payment, receipt for proof of a completed payment, other for anything else"),
  invoice_number: z.string().nullable().describe("Invoice number, receipt number or transaction id"),
  issue_date: z.string().nullable().describe("Issue / transaction date in ISO 8601 (YYYY-MM-DD)"),
  due_date: z.string().nullable().describe("Payment due date in ISO 8601 (YYYY-MM-DD)"),
  currency: z.string().nullable().describe("ISO 4217 code, e.g. USD, EUR, GBP"),
  vendor: PartySchema.describe("The seller / merchant / issuer"),
  customer: PartySchema.describe("The buyer / bill-to party; all null if not shown"),
  line_items: z.array(LineItemSchema),
  subtotal: z.number().nullable(),
  discount_total: z.number().nullable(),
  tax: z.number().nullable().describe("Total tax amount"),
  shipping_total: z.number().nullable(),
  total: z.number().nullable().describe("Grand total payable / paid"),
  amount_paid: z.number().nullable(),
  amount_due: z.number().nullable(),
  payment_method: z.string().nullable().describe("e.g. card, cash, bank transfer, with last 4 digits if shown"),
  payment_terms: z.string().nullable().describe("e.g. Net 30"),
  notes: z.string().nullable().describe("Any other noteworthy free text, briefly"),
  field_confidence: FieldConfidenceSchema.describe(
    "Confidence from 0 to 1 that each value is correct. 1 = clearly printed and certain; null when the value is null",
  ),
  confidence: z.number().describe("Your overall confidence in the extraction, 0 to 1"),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

const CONFIDENCE_KEYS: Record<keyof z.infer<typeof FieldConfidenceSchema>, ConfidenceField> = {
  vendor_name: "vendor.name",
  vendor_tax_id: "vendor.tax_id",
  customer_name: "customer.name",
  invoice_number: "invoice_number",
  issue_date: "issue_date",
  due_date: "due_date",
  currency: "currency",
  subtotal: "subtotal",
  tax: "tax",
  total: "total",
  line_items: "line_items",
};

/** Map the model's output to the public ExtractionResult (lib/api/types.ts). */
export function toExtractionResult(e: Extraction): ExtractionResult {
  if (e.document_type === "other") throw new Error("'other' documents are rejected before mapping");
  const field_confidence: Partial<Record<ConfidenceField, number>> = {};
  for (const [k, v] of Object.entries(e.field_confidence)) {
    if (v !== null) field_confidence[CONFIDENCE_KEYS[k as keyof typeof CONFIDENCE_KEYS]] = v;
  }
  const c = e.customer;
  const hasCustomer = Object.values(c).some((v) => v !== null);
  return {
    document_type: e.document_type,
    vendor: e.vendor,
    customer: hasCustomer ? c : null,
    invoice_number: e.invoice_number,
    issue_date: e.issue_date,
    due_date: e.due_date,
    currency: e.currency,
    subtotal: e.subtotal,
    tax: e.tax,
    total: e.total,
    line_items: e.line_items,
    confidence: e.confidence,
    field_confidence,
    discount_total: e.discount_total,
    shipping_total: e.shipping_total,
    amount_paid: e.amount_paid,
    amount_due: e.amount_due,
    payment_method: e.payment_method,
    payment_terms: e.payment_terms,
    notes: e.notes,
  };
}
