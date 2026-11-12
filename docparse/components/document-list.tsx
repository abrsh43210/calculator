"use client";

import { FileText, Image as ImageIcon } from "lucide-react";
import Link from "next/link";
import type { DocumentRecord } from "@/lib/api/types";
import { formatBytes, formatDate, formatMoney } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export function DocumentList({ documents, emptyText = "No documents yet. Upload one to get started." }: {
  documents: DocumentRecord[];
  emptyText?: string;
}) {
  if (!documents.length) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <Table>
      <THead>
        <TR className="hover:bg-transparent">
          <TH>File</TH>
          <TH>Status</TH>
          <TH className="hidden sm:table-cell">Type</TH>
          <TH className="hidden md:table-cell text-right">Total</TH>
          <TH className="hidden md:table-cell">Uploaded</TH>
        </TR>
      </THead>
      <TBody>
        {documents.map((d) => {
          const Icon = d.mime_type === "application/pdf" ? FileText : ImageIcon;
          return (
            <TR key={d.id}>
              <TD>
                <Link href={`/documents/${d.id}`} className="flex items-center gap-2 font-medium hover:underline">
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate max-w-[16rem]">{d.filename}</span>
                </Link>
                <span className="ml-6 text-xs text-muted-foreground">{formatBytes(d.size_bytes)}</span>
              </TD>
              <TD>
                <StatusBadge status={d.status} />
              </TD>
              <TD className="hidden sm:table-cell capitalize text-muted-foreground">{d.result?.document_type ?? "—"}</TD>
              <TD className="hidden md:table-cell text-right tabular-nums">
                {d.result ? formatMoney(d.result.total, d.result.currency) : "—"}
              </TD>
              <TD className="hidden md:table-cell text-muted-foreground">{formatDate(d.created_at)}</TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
