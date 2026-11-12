import type { ExtractorClient } from "@/lib/extract/extractor";
import type { ApiKeyVerifier, SessionResolver } from "./auth";
import type { DocumentStore } from "./documents";
import { DEV_API_KEY, InMemoryApiKeyVerifier, InMemoryDocumentStore, InMemoryUsageService, MockSessionResolver } from "./mocks";
import type { UsageService } from "./usage";
import type { UploadStore } from "./uploads";
import { createSupabaseServices, supabaseConfigured } from "./supabase-services";

export interface Services {
  apiKeys: ApiKeyVerifier;
  sessions: SessionResolver;
  usage: UsageService;
  documents: DocumentStore;
  /** Signed uploads to Supabase Storage for files over Vercel's 4.5 MB body limit. Absent with mocks. */
  uploads?: UploadStore;
  /** Override the Claude client (tests). Defaults to the real SDK client. */
  extractorClient?: ExtractorClient;
}

let current: Services | null = null;

/**
 * Thread 3 wires the real Supabase/Stripe implementations with setServices(), e.g.
 * from instrumentation.ts. Partial overrides keep the remaining mocks (dev only).
 */
export function setServices(services: Services): void {
  current = services;
}

export function getServices(): Services {
  if (current) return current;
  // Real Supabase + Stripe services whenever Supabase is configured (Thread 3).
  if (supabaseConfigured()) {
    current = createSupabaseServices();
    return current;
  }
  if (process.env.NODE_ENV === "production" && process.env.DOCPARSE_ALLOW_MOCKS !== "1") {
    throw new Error("DocParse services are not configured. Call setServices() with real implementations.");
  }
  const devUser = { userId: "user_dev", plan: "business" as const, livemode: false };
  console.warn(`[docparse] using in-memory mock services; every browser request is signed in as ${devUser.userId}. Dev API key: ${DEV_API_KEY}`);
  current = {
    apiKeys: new InMemoryApiKeyVerifier().add(DEV_API_KEY, { ...devUser, apiKeyId: "key_dev" }),
    sessions: new MockSessionResolver({}, devUser),
    usage: new InMemoryUsageService(),
    documents: new InMemoryDocumentStore(),
  };
  return current;
}
