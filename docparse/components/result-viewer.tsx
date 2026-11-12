"use client";

import { AlertTriangle, Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import type { ConfidenceField, DocumentRecord, ExtractionResult } from "@/lib/api/types";
import { csvFilename, downloadText, resultToCsv } from "@/lib/csv";
import { formatDate, formatMoney } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type View = "table" | "json";

/** Below this, a field is flagged for review. */
export const LOW_CONFIDENCE = 0.8;

export function confidenceVariant(c: number) {
  return c >= 0.9 ? "success" : c >= LOW_CONFIDENCE ? "warning" : "destructive";
}

function ConfidenceTag({ value, label }: { value: number | undefined; label: string }) {
  if (value === undefined) return null;
  const pct = Math.round(value * 100);
  return (
    <Badge
      variant={confidenceVariant(value)}
      className="px-1.5 py-0 text-[10px] tabular-nums"
      title={`${label}: ${pct}% confidence`}
      aria-label={`${label} confidence ${pct}%`}
    >
      {pct}%
    </Badge>
  );
}

export function ResultViewer({ doc }: { doc: DocumentRecord & { result: ExtractionResult } }) {
  const [view, setView] = useState<View>("table");
  const [copied, setCopied] = useState(false);
  const r = doc.result;
  const fc = r.field_confidence ?? {};
  const conf = (f: ConfidenceField) => fc[f];
  const lowFields = (Object.entries(fc) as [ConfidenceField, number][])
    .filter(([, v]) => v < LOW_CONFIDENCE)
    .map(([k]) => FIELD_LABELS[k]);
  const json = JSON.stringify(r, null, 2);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; ignore */
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Result view" className="inline-flex rounded-lg bg-muted p-1">
          {(["table", "json"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium transition-colors cursor-pointer",
                view === v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "table" ? "Table" : "JSON"}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy JSON"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadText(json, doc.filename.replace(/\.[^.]+$/, "") + ".json", "application/json")}
          >
            <Download className="size-4" />
            JSON
          </Button>
          <Button size="sm" onClick={() => downloadText(resultToCsv(r), csvFilename(doc), "text/csv;charset=utf-8")}>
            <Download className="size-4" />
            Download CSV
          </Button>
        </div>
      </div>

      {doc.warnings && doc.warnings.length > 0 && (
        <div role="status" data-testid="warnings" className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="font-medium">Review before using this data</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
              {doc.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {view === "json" ? (
        <pre
          data-testid="json-view"
          className="max-h-[32rem] overflow-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-relaxed"
        >
          {json}
        </pre>
      ) : (
        <div data-testid="table-view" className="space-y-6">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Vendor" value={r.vendor.name} sub={r.vendor.tax_id ?? undefined} confidence={conf("vendor.name")} />
            <Field label="Customer" value={r.customer?.name ?? null} confidence={conf("customer.name")} />
            <Field label="Number" value={r.invoice_number} confidence={conf("invoice_number")} />
            <Field
              label="Issued"
              value={formatDate(r.issue_date)}
              sub={r.due_date ? `Due ${formatDate(r.due_date)}` : undefined}
              confidence={conf("issue_date")}
            />
          </dl>
          <div className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
              <span>Line items</span>
              <ConfidenceTag value={conf("line_items")} label="Line items" />
            </div>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Description</TH>
                  <TH className="text-right">Qty</TH>
                  <TH className="text-right">Unit price</TH>
                  <TH className="text-right">Amount</TH>
                </TR>
              </THead>
              <TBody>
                {r.line_items.map((li, i) => (
                  <TR key={i}>
                    <TD>{li.description}</TD>
                    <TD className="text-right tabular-nums">{li.quantity ?? "—"}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(li.unit_price, r.currency)}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(li.amount, r.currency)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <div className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
            <Row label="Subtotal" value={formatMoney(r.subtotal, r.currency)} confidence={conf("subtotal")} />
            {r.discount_total != null && r.discount_total !== 0 && (
              <Row label="Discount" value={formatMoney(-Math.abs(r.discount_total), r.currency)} />
            )}
            {r.shipping_total != null && r.shipping_total !== 0 && (
              <Row label="Shipping" value={formatMoney(r.shipping_total, r.currency)} />
            )}
            <Row label="Tax" value={formatMoney(r.tax, r.currency)} confidence={conf("tax")} />
            <Row label="Total" value={formatMoney(r.total, r.currency)} confidence={conf("total")} strong />
            {r.amount_paid != null && <Row label="Paid" value={formatMoney(r.amount_paid, r.currency)} />}
            {r.amount_due != null && <Row label="Amount due" value={formatMoney(r.amount_due, r.currency)} />}
          </div>
          {(r.payment_terms || r.payment_method || r.notes) && (
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              {r.payment_terms && <Meta label="Payment terms" value={r.payment_terms} />}
              {r.payment_method && <Meta label="Payment method" value={r.payment_method} />}
              {r.notes && <Meta label="Notes" value={r.notes} />}
            </dl>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Overall confidence</span>
            <Badge variant={confidenceVariant(r.confidence)}>{Math.round(r.confidence * 100)}%</Badge>
            {lowFields.length > 0 ? (
              <span data-testid="low-confidence">Check these fields before using the data: {lowFields.join(", ")}.</span>
            ) : (
              r.confidence < 0.9 && <span>Double-check the totals before using this data.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const FIELD_LABELS: Record<ConfidenceField, string> = {
  "vendor.name": "Vendor",
  "vendor.tax_id": "Vendor tax ID",
  "customer.name": "Customer",
  invoice_number: "Number",
  issue_date: "Issue date",
  due_date: "Due date",
  currency: "Currency",
  subtotal: "Subtotal",
  tax: "Tax",
  total: "Total",
  line_items: "Line items",
};

function Field({ label, value, sub, confidence }: { label: string; value: string | null; sub?: string; confidence?: number }) {
  return (
    <div className={cn("rounded-lg border p-3", confidence !== undefined && confidence < LOW_CONFIDENCE && "border-destructive/50")}>
      <dt className="flex items-center justify-between gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
        <ConfidenceTag value={confidence} label={label} />
      </dt>
      <dd className="mt-1 truncate font-medium">{value ?? "—"}</dd>
      {sub && <dd className="text-xs text-muted-foreground">{sub}</dd>}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}

function Row({ label, value, strong, confidence }: { label: string; value: string; strong?: boolean; confidence?: number }) {
  return (
    <div className={cn("flex items-center justify-between gap-2 tabular-nums", strong && "border-t pt-1.5 text-base font-semibold")}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="flex items-center gap-2">
        <ConfidenceTag value={confidence} label={label} />
        {value}
      </span>
    </div>
  );
}
