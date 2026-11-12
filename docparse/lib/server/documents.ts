import type { DocumentListResponse, DocumentRecord } from "@/lib/api/types";

/**
 * Thread 3 implements against Supabase (`documents` table with user_id, RLS on).
 * `get` must only return documents owned by userId (null otherwise, so the API
 * answers 404 and never reveals another user's ids). `list` is newest first;
 * the cursor is opaque to callers.
 */
export interface DocumentStore {
  save(userId: string, doc: DocumentRecord): Promise<void>;
  get(userId: string, id: string): Promise<DocumentRecord | null>;
  list(userId: string, opts: { cursor?: string; limit: number }): Promise<DocumentListResponse>;
}
