"use client";

import Link from "next/link";
import { useCallback, useEffect } from "react";
import { api } from "@/lib/api/client";
import { useAsync } from "@/lib/use-async";
import { DocumentList } from "@/components/document-list";
import { PageHeader } from "@/components/page-header";
import { UploadDropzone } from "@/components/upload-dropzone";
import { isHardCapped, UsageMeter } from "@/components/usage-meter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function DashboardView() {
  const usage = useAsync(() => api.getUsage());
  const docs = useAsync(() => api.listDocuments({ limit: 5 }));

  const { reload: reloadUsage } = usage;
  const refresh = useCallback(() => {
    void reloadUsage();
    void docs.reload();
  }, [reloadUsage, docs.reload]);

  // Poll while anything is still processing.
  const reloadDocs = docs.reload;
  const pending = docs.data?.data.some((d) => d.status === "queued" || d.status === "processing");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void reloadDocs(), 1500);
    return () => clearInterval(t);
  }, [pending, reloadDocs]);

  const exceeded = usage.data ? isHardCapped(usage.data) : false;

  return (
    <>
      <PageHeader title="Dashboard" description="Upload invoices and receipts and get structured data back in seconds." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Upload</CardTitle>
            <CardDescription>Each file of up to 5 pages counts as one document toward your monthly limit.</CardDescription>
          </CardHeader>
          <CardContent>
            <UploadDropzone onUploaded={refresh} disabled={exceeded} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Usage this month</CardTitle>
            <CardDescription className="capitalize">{usage.data ? `${usage.data.plan} plan` : " "}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {usage.error ? (
              <p role="alert" className="text-sm text-destructive">{usage.error}</p>
            ) : usage.data ? (
              <UsageMeter usage={usage.data} />
            ) : (
              <div className="h-20 animate-pulse rounded-md bg-muted" />
            )}
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link href="/billing">Manage plan</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Recent documents</CardTitle>
          <Button asChild variant="link" size="sm">
            <Link href="/documents">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {docs.error ? (
            <p role="alert" className="text-sm text-destructive">{docs.error}</p>
          ) : docs.data ? (
            <DocumentList documents={docs.data.data} />
          ) : (
            <div className="h-40 animate-pulse rounded-md bg-muted" />
          )}
        </CardContent>
      </Card>
    </>
  );
}
