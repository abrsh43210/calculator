"use client";

import { ArrowLeft, CircleAlert, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/lib/api/client";
import type { DocumentRecord, ExtractionResult } from "@/lib/api/types";
import { useAsync } from "@/lib/use-async";
import { formatBytes, formatDate } from "@/lib/utils";
import { ResultViewer } from "@/components/result-viewer";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const doc = useAsync(() => api.getDocument(id), [id]);
  const d = doc.data;

  const pending = d?.status === "queued" || d?.status === "processing";
  const { reload } = doc;
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void reload(), 1500);
    return () => clearInterval(t);
  }, [pending, reload]);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/documents">
          <ArrowLeft className="size-4" /> All documents
        </Link>
      </Button>
      {doc.error ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-destructive" role="alert">
            <CircleAlert className="size-5" /> {doc.error}
          </CardContent>
        </Card>
      ) : !d ? (
        <div className="h-96 animate-pulse rounded-xl bg-muted" />
      ) : (
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="truncate text-lg">{d.filename}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatBytes(d.size_bytes)}
                {d.page_count ? ` · ${d.page_count} page${d.page_count === 1 ? "" : "s"}` : ""}
                {d.billable_units && d.billable_units > 1 ? ` · counts as ${d.billable_units} documents` : ""} · uploaded{" "}
                {formatDate(d.created_at)}
              </p>
            </div>
            <StatusBadge status={d.status} />
          </CardHeader>
          <CardContent>
            {d.status === "completed" && d.result ? (
              <ResultViewer doc={d as DocumentRecord & { result: ExtractionResult }} />
            ) : d.status === "failed" ? (
              <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div>
                  <p className="font-medium">We couldn&apos;t read this document.</p>
                  <p className="text-muted-foreground">{d.error ?? "Unknown error."}</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
                <Loader2 className="size-6 animate-spin" />
                <p className="text-sm">Extracting data… this usually takes a few seconds.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
