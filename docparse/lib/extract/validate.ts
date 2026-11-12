import type { Extraction } from "./schema";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_CURRENCY = /^[A-Z]{3}$/;

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Tolerance: 1 cent, or 0.5% for large totals (rounding on per-line tax). */
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.005);

/**
 * Light normalisation plus arithmetic sanity checks. Returns the cleaned extraction
 * and human-readable warnings; it never throws, because a slightly-off invoice is
 * still useful to the customer.
 */
export function normalizeAndCheck(input: Extraction): { data: Extraction; warnings: string[] } {
  const warnings: string[] = [];
  const data: Extraction = structuredClone(input);

  if (data.currency) {
    data.currency = data.currency.trim().toUpperCase();
    if (!ISO_CURRENCY.test(data.currency)) {
      warnings.push(`currency "${data.currency}" is not an ISO 4217 code`);
    }
  }

  for (const key of ["issue_date", "due_date"] as const) {
    const v = data[key];
    if (v !== null && (!ISO_DATE.test(v) || Number.isNaN(Date.parse(v)))) {
      warnings.push(`${key} "${v}" is not a valid YYYY-MM-DD date`);
    }
  }
  if (data.issue_date && data.due_date && ISO_DATE.test(data.issue_date) && ISO_DATE.test(data.due_date)) {
    if (data.due_date < data.issue_date) warnings.push("due_date is before issue_date");
  }

  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  data.confidence = clamp(data.confidence);
  for (const k of Object.keys(data.field_confidence) as (keyof typeof data.field_confidence)[]) {
    const v = data.field_confidence[k];
    if (v !== null) data.field_confidence[k] = clamp(v);
  }

  data.line_items.forEach((item, i) => {
    if (item.quantity !== null && item.unit_price !== null && item.amount !== null) {
      if (!close(round2(item.quantity * item.unit_price), item.amount)) {
        warnings.push(`line_items[${i}]: quantity x unit_price (${round2(item.quantity * item.unit_price)}) != amount (${item.amount})`);
      }
    }
  });

  const amounts = data.line_items.map((l) => l.amount);
  if (data.subtotal !== null && amounts.length > 0 && amounts.every((a): a is number => a !== null)) {
    const sum = round2(amounts.reduce((s, a) => s + a, 0));
    // Line amounts may be tax-inclusive, so only warn when neither interpretation fits.
    if (!close(sum, data.subtotal) && !(data.total !== null && close(sum, data.total))) {
      warnings.push(`sum of line_items (${sum}) != subtotal (${data.subtotal})`);
    }
  }

  if (data.subtotal !== null && data.total !== null) {
    const expected = round2(
      data.subtotal - (data.discount_total ?? 0) + (data.tax ?? 0) + (data.shipping_total ?? 0),
    );
    // Tax-inclusive pricing (common on EU/UK receipts) makes total == subtotal.
    if (!close(expected, data.total) && !close(data.subtotal - (data.discount_total ?? 0) + (data.shipping_total ?? 0), data.total)) {
      warnings.push(`subtotal - discount + tax + shipping (${expected}) != total (${data.total})`);
    }
  }

  if (data.total === null) warnings.push("total not found");
  if (data.confidence < 0.5) warnings.push("low confidence extraction; review manually");

  return { data, warnings };
}
