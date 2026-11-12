"use client";

import { api } from "@/lib/api/client";
import { getPlan } from "@/lib/pricing";
import { useAsync } from "@/lib/use-async";
import { ApiKeysManager } from "@/components/api-keys-manager";

/** Loads the user's plan so the key manager can gate creation on API access. */
export function ApiKeysSection() {
  const sub = useAsync(() => api.getSubscription());
  // Default to allowed while loading or on error; the server enforces the rule anyway.
  const apiAccess = sub.data ? getPlan(sub.data.plan).apiAccess : true;
  return <ApiKeysManager apiAccess={apiAccess} />;
}
