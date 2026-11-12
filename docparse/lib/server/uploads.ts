/**
 * Large-file uploads (Thread 3). Vercel caps request bodies at 4.5 MB, so files
 * up to 20 MB go straight to Supabase Storage with a signed upload URL:
 *
 *   1. POST /api/v1/uploads { filename, size_bytes, mime_type }  -> SignedUpload
 *   2. PUT <upload_url> with the raw file and its Content-Type
 *   3. POST /api/v1/parse with JSON { "storage_path": "<storage_path>" }
 *
 * Step 3 reads the file with UploadStore.fetch() and deletes it with remove()
 * once extraction finishes.
 */
export interface SignedUpload {
  storage_path: string;
  /** PUT the raw file here with its Content-Type. Valid for 2 hours. */
  upload_url: string;
  token: string;
  max_bytes: number;
}

export interface UploadStore {
  createSignedUpload(
    userId: string,
    file: { filename?: unknown; size_bytes?: unknown; mime_type?: unknown },
  ): Promise<SignedUpload>;
  /** Only paths in the caller's own folder resolve; anything else is a 404. */
  fetch(userId: string, storagePath: string): Promise<{ bytes: Uint8Array; fileName: string }>;
  remove(userId: string, storagePath: string): Promise<void>;
}
