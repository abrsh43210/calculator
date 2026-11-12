// @vitest-environment node
import { describe, expect, it } from "vitest";
import { toExtractionResult } from "@/lib/extract/schema";
import { sampleInvoice } from "./fixtures";

describe("toExtractionResult", () => {
  it("maps to the public shape with dotted confidence keys and drops null scores", () => {
    const r = toExtractionResult(sampleInvoice());
    expect(r.field_confidence).toMatchObject({ "vendor.name": 0.98, "vendor.tax_id": 0.9, total: 0.99, tax: 0.99 });
    expect(r.field_confidence).not.toHaveProperty("customer.name");
    expect(r.invoice_number).toBe("INV-1001");
    expect(r.payment_terms).toBe("Net 30");
    expect(r.customer?.name).toBe("Globex LLC");
  });
  it("returns customer null when nothing about the customer is on the document", () => {
    const party = { name: null, address: null, tax_id: null, email: null, phone: null };
    expect(toExtractionResult(sampleInvoice({ customer: party })).customer).toBeNull();
  });
  it("refuses to map 'other' documents", () => {
    expect(() => toExtractionResult(sampleInvoice({ document_type: "other" }))).toThrow();
  });
});
