"use client";

import { Check, Copy, KeyRound, Lock, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api, type DocParseApi } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import type { ApiKey, CreatedApiKey } from "@/lib/api/types";
import { useAsync } from "@/lib/use-async";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

type KeysClient = Pick<DocParseApi, "listApiKeys" | "createApiKey" | "revokeApiKey">;

export function ApiKeysManager({ client = api, apiAccess = true }: { client?: KeysClient; apiAccess?: boolean }) {
  const keys = useAsync(() => client.listApiKeys(), [client]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give the key a name, like “Production server”.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const k = await client.createApiKey(name);
      setCreated(k);
      setName("");
      const { secret: _secret, ...pub } = k;
      keys.setData([pub as ApiKey, ...(keys.data ?? [])]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    setRevoking(id);
    setError(null);
    try {
      await client.revokeApiKey(id);
      keys.setData((keys.data ?? []).filter((k) => k.id !== id));
      if (created?.id === id) setCreated(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div className="space-y-6">
      {!apiAccess && (
        <div data-testid="upgrade-notice" className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 p-4 text-sm">
          <Lock className="size-4 text-muted-foreground" aria-hidden />
          <span className="flex-1">API keys are available on the Pro and Business plans.</span>
          <Button asChild size="sm">
            <Link href="/billing">See plans</Link>
          </Button>
        </div>
      )}
      {apiAccess && (
      <form onSubmit={create} className="flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Key name"
          placeholder="Key name, e.g. Production server"
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={creating}>
          <KeyRound className="size-4" />
          {creating ? "Creating…" : "Create key"}
        </Button>
      </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {created && (
        <div className="rounded-lg border border-success/40 bg-success/10 p-4" data-testid="new-key">
          <p className="text-sm font-medium">Copy your new key now. You won&apos;t be able to see it again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-background px-2 py-1.5 font-mono text-xs">{created.secret}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(created.secret);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* ignore */
                }
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}

      {keys.loading && !keys.data ? (
        <p className="text-sm text-muted-foreground">Loading keys…</p>
      ) : keys.error ? (
        <p role="alert" className="text-sm text-destructive">{keys.error}</p>
      ) : !keys.data?.length ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No API keys yet.</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Name</TH>
                <TH>Key</TH>
                <TH className="hidden sm:table-cell">Created</TH>
                <TH className="hidden sm:table-cell">Last used</TH>
                <TH className="w-0" />
              </TR>
            </THead>
            <TBody>
              {keys.data.map((k) => (
                <TR key={k.id}>
                  <TD className="font-medium">{k.name}</TD>
                  <TD>
                    <code className="font-mono text-xs text-muted-foreground">{k.prefix}…</code>
                  </TD>
                  <TD className="hidden sm:table-cell text-muted-foreground">{formatDate(k.created_at)}</TD>
                  <TD className="hidden sm:table-cell text-muted-foreground">{k.last_used_at ? formatDate(k.last_used_at) : "Never"}</TD>
                  <TD>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Revoke ${k.name}`}
                      disabled={revoking === k.id}
                      onClick={() => revoke(k.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                      Revoke
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  );
}
