"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import type { DocumentRecord } from "@/lib/api/types";
import { useAsync } from "@/lib/use-async";
import { DocumentList } from "@/components/document-list";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function DocumentsPage() {
  const docs = useAsync(() => api.listDocuments({ limit: 100 }));
  const [q, setQ] = useState("");

  const reloadDocs = docs.reload;
  const pending = docs.data?.data.some((d) => d.status === "queued" || d.status === "processing");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void reloadDocs(), 1500);
    return () => clearInterval(t);
  }, [pending, reloadDocs]);

  const filtered: DocumentRecord[] = (docs.data?.data ?? []).filter((d) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (
      d.filename.toLowerCase().includes(s) ||
      (d.result?.vendor.name ?? "").toLowerCase().includes(s) ||
      (d.result?.invoice_number ?? "").toLowerCase().includes(s)
    );
  });

  return (
    <>
      <PageHeader title="Documents" description="Everything you've uploaded, newest first.">
        <Input
          aria-label="Search documents"
          placeholder="Search by file, vendor or number"
          className="w-full sm:w-72"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </PageHeader>
      <Card>
        <CardContent className="pt-4">
          {docs.error ? (
            <p role="alert" className="text-sm text-destructive">{docs.error}</p>
          ) : docs.data ? (
            <DocumentList documents={filtered} emptyText={q ? "No documents match your search." : undefined} />
          ) : (
            <div className="h-60 animate-pulse rounded-md bg-muted" />
          )}
        </CardContent>
      </Card>
    </>
  );
}
