import type { DocumentRecord, ExtractionResult } from "./api/types";

/** RFC 4180 field escaping. Also neutralises spreadsheet formula injection. */
export function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const CSV_HEADERS = [
  "document_type",
  "vendor_name",
  "vendor_tax_id",
  "customer_name",
  "invoice_number",
  "issue_date",
  "due_date",
  "currency",
  "subtotal",
  "tax",
  "total",
  "line_description",
  "line_quantity",
  "line_unit_price",
  "line_amount",
] as const;

/** One row per line item; header fields repeat so the file opens cleanly in Excel/Sheets. */
export function resultToCsv(r: ExtractionResult): string {
  const head = [
    r.document_type,
    r.vendor.name,
    r.vendor.tax_id,
    r.customer?.name ?? null,
    r.invoice_number,
    r.issue_date,
    r.due_date,
    r.currency,
    r.subtotal,
    r.tax,
    r.total,
  ];
  const items = r.line_items.length ? r.line_items : [{ description: "", quantity: null, unit_price: null, amount: null }];
  const rows = items.map((li) => [...head, li.description, li.quantity, li.unit_price, li.amount]);
  return [CSV_HEADERS.join(","), ...rows.map((row) => row.map(escapeCsv).join(","))].join("\r\n") + "\r\n";
}

export function csvFilename(doc: Pick<DocumentRecord, "filename">): string {
  return doc.filename.replace(/\.[^.]+$/, "") + ".csv";
}

export function downloadText(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
