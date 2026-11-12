import { describe, expect, it } from "vitest";
import { normalizeAndCheck } from "@/lib/extract/validate";
import { sampleInvoice } from "./fixtures";

describe("normalizeAndCheck", () => {
  it("passes a consistent invoice with no warnings", () => {
    expect(normalizeAndCheck(sampleInvoice()).warnings).toEqual([]);
  });

  it("does not mutate the input", () => {
    const input = sampleInvoice({ currency: " usd " });
    normalizeAndCheck(input);
    expect(input.currency).toBe(" usd ");
  });

  it("normalises currency and clamps confidence", () => {
    const { data } = normalizeAndCheck(sampleInvoice({ currency: "eur", confidence: 1.4 }));
    expect(data.currency).toBe("EUR");
    expect(data.confidence).toBe(1);
  });

  it("flags bad dates, currencies and date order", () => {
    const { warnings } = normalizeAndCheck(
      sampleInvoice({ issue_date: "01/10/2026", currency: "$$", due_date: "2026-02-30" }),
    );
    expect(warnings.join("\n")).toMatch(/issue_date/);
    expect(warnings.join("\n")).toMatch(/due_date "2026-02-30"|currency/);
    const order = normalizeAndCheck(sampleInvoice({ issue_date: "2026-10-10", due_date: "2026-10-01" }));
    expect(order.warnings).toContain("due_date is before issue_date");
  });

  it("flags arithmetic that does not add up", () => {
    const inv = sampleInvoice({ total: 200 });
    inv.line_items[0].amount = 90;
    const { warnings } = normalizeAndCheck(inv);
    expect(warnings.some((w) => w.startsWith("line_items[0]"))).toBe(true);
    expect(warnings.some((w) => w.startsWith("sum of line_items"))).toBe(true);
    expect(warnings.some((w) => w.includes("!= total (200)"))).toBe(true);
  });

  it("accepts tax-inclusive receipts", () => {
    const receipt = sampleInvoice({
      document_type: "receipt",
      line_items: [{ description: "Coffee", quantity: 1, unit_price: 3.6, amount: 3.6, tax_rate: 20, sku: null }],
      subtotal: 3.6,
      tax: 0.6,
      total: 3.6,
    });
    expect(normalizeAndCheck(receipt).warnings).toEqual([]);
  });

  it("warns on missing total and low confidence", () => {
    const { warnings } = normalizeAndCheck(sampleInvoice({ total: null, confidence: 0.3 }));
    expect(warnings).toContain("total not found");
    expect(warnings).toContain("low confidence extraction; review manually");
  });
});
