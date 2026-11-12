import { describe, expect, it } from "vitest";
import { CSV_HEADERS, csvFilename, escapeCsv, resultToCsv } from "@/lib/csv";
import type { ExtractionResult } from "@/lib/api/types";

const result: ExtractionResult = {
  document_type: "invoice",
  vendor: { name: 'Acme, "Best" Ltd', address: null, tax_id: "X1" },
  customer: null,
  invoice_number: "INV-1",
  issue_date: "2026-11-01",
  due_date: null,
  currency: "USD",
  subtotal: 10,
  tax: 1,
  total: 11,
  line_items: [
    { description: "Widget", quantity: 2, unit_price: 5, amount: 10 },
    { description: "=HYPERLINK(\"evil\")", quantity: 1, unit_price: 0, amount: 0 },
  ],
  confidence: 0.9,
};

describe("escapeCsv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(escapeCsv("a,b")).toBe('"a,b"');
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsv("line\nbreak")).toBe('"line\nbreak"');
  });
  it("renders null as empty and keeps negative numbers", () => {
    expect(escapeCsv(null)).toBe("");
    expect(escapeCsv(-5)).toBe("-5");
  });
  it("neutralises formula injection", () => {
    expect(escapeCsv("=1+1")).toBe("'=1+1");
    expect(escapeCsv("@SUM(A1)")).toBe("'@SUM(A1)");
  });
});

describe("resultToCsv", () => {
  it("writes a header and one row per line item", () => {
    const lines = resultToCsv(result).trimEnd().split("\r\n");
    expect(lines[0]).toBe(CSV_HEADERS.join(","));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Acme, ""Best"" Ltd"');
    expect(lines[1].endsWith("Widget,2,5,10")).toBe(true);
    expect(lines[2]).toContain(`"'=HYPERLINK(""evil"")"`);
  });
  it("still writes one row when there are no line items", () => {
    const lines = resultToCsv({ ...result, line_items: [] }).trimEnd().split("\r\n");
    expect(lines).toHaveLength(2);
  });
  it("derives a .csv filename", () => {
    expect(csvFilename({ filename: "scan.final.pdf" })).toBe("scan.final.csv");
  });
});
