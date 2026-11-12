import type { Metadata } from "next";
import { ApiKeysSection } from "@/components/api-keys-section";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "API keys" };

const curl = `curl -X POST https://docparse.app/api/v1/parse \\
  -H "Authorization: Bearer $DOCPARSE_API_KEY" \\
  -F "file=@invoice.pdf"`;

export default function ApiKeysPage() {
  return (
    <>
      <PageHeader title="API keys" description="Use keys to call the DocParse REST API from your own code. API access is included on the Pro and Business plans." />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Your keys</CardTitle>
            <CardDescription>Keep keys secret. Revoke any key you think has leaked.</CardDescription>
          </CardHeader>
          <CardContent>
            <ApiKeysSection />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Quick start</CardTitle>
            <CardDescription>Send a file, get JSON back. Poll GET /api/v1/documents/:id if the status is still processing.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs">{curl}</pre>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
