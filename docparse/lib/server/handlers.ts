import { randomBytes, randomUUID } from "node:crypto";
import type { DocumentRecord, ParseResponse } from "@/lib/api/types";
import { resultToCsv, csvFilename } from "@/lib/csv";
import { extractDocument, inspectFile } from "@/lib/extract/extractor";
import { MAX_FILE_BYTES } from "@/lib/extract/file";
import { toExtractionResult } from "@/lib/extract/schema";
import { authenticate } from "./auth";
import type { Principal } from "./auth";
import { HttpError, errorResponse } from "./errors";
import { ExtractionError } from "@/lib/extract/errors";
import type { Services } from "./services";
import { isExceeded, quotaHeaders } from "./usage";

type Format = "json" | "csv";
const DOC_ID_PATTERN = /^doc_[A-Za-z0-9]{20,40}$/;
/** Multipart overhead allowance on top of the largest accepted file. */
const MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024;
const MAX_MB = MAX_FILE_BYTES / 1024 / 1024;

export function newDocumentId(): string {
  return "doc_" + randomBytes(18).toString("base64url").replace(/[-_]/g, "0").slice(0, 24);
}

function requestIdOf(req: Request): string {
  const given = req.headers.get("x-request-id");
  return given && /^[\w-]{1,64}$/.test(given) ? given : `req_${randomUUID().replace(/-/g, "")}`;
}

function parseFormat(url: URL): Format {
  const f = (url.searchParams.get("format") ?? "json").toLowerCase();
  if (f !== "json" && f !== "csv") {
    throw new HttpError(400, "invalid_request_error", "invalid_format", "format must be 'json' or 'csv'.");
  }
  return f;
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json" } });
}

function csv(doc: DocumentRecord, status: number, headers: Record<string, string>): Response {
  return new Response(doc.result ? resultToCsv(doc.result) : "", {
    status,
    headers: {
      ...headers,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${csvFilename(doc).replace(/["\\\r\n]/g, "_")}"`,
    },
  });
}

interface Upload {
  bytes: Uint8Array;
  fileName: string | null;
  /** Set when the file came from Supabase Storage; deleted after extraction. */
  storagePath?: string;
}

/**
 * Accepts, in order:
 * - JSON `{ "storage_path": "...", "filename"?: "..." }` for files uploaded with a
 *   signed URL from POST /api/v1/uploads (the way to send files over Vercel's 4.5 MB body cap),
 * - multipart/form-data with a `file` field,
 * - the raw file as the request body (Content-Type: application/pdf, image/*, application/octet-stream).
 */
async function readUpload(req: Request, principal: Principal, services: Services): Promise<Upload> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  const tooLarge = () => new HttpError(413, "invalid_request_error", "file_too_large", `Files are limited to ${MAX_MB} MB.`);
  if (declared > MAX_BODY_BYTES) throw tooLarge();
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.toLowerCase().startsWith("application/json")) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "invalid_request_error", "invalid_json", "The request body is not valid JSON.");
    }
    const { storage_path, filename } = (body ?? {}) as { storage_path?: unknown; filename?: unknown };
    if (typeof storage_path !== "string" || storage_path.length === 0 || storage_path.length > 512) {
      throw new HttpError(400, "invalid_request_error", "missing_storage_path",
        "Send { \"storage_path\": \"...\" } from POST /api/v1/uploads, or upload the file as multipart/form-data.");
    }
    if (!services.uploads) {
      throw new HttpError(501, "invalid_request_error", "uploads_unavailable", "Storage uploads are not configured on this server.");
    }
    const fetched = await services.uploads.fetch(principal.userId, storage_path);
    const displayName = typeof filename === "string" && filename.trim() ? filename.trim().slice(0, 255) : fetched.fileName;
    return { bytes: fetched.bytes, fileName: displayName, storagePath: storage_path };
  }

  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new HttpError(400, "invalid_request_error", "invalid_multipart", "Could not read the multipart body.");
    }
    const file = form.get("file");
    if (!file || typeof file === "string") {
      throw new HttpError(400, "invalid_request_error", "missing_file", "Attach the document in a form field named 'file'.");
    }
    if (file.size > MAX_BODY_BYTES) throw tooLarge();
    return { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name || null };
  }

  if (!req.body) {
    throw new HttpError(400, "invalid_request_error", "missing_file",
      "Send the document as multipart/form-data (field 'file') or as the raw request body.");
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > MAX_BODY_BYTES) throw tooLarge();
  const name = req.headers.get("x-file-name");
  return { bytes, fileName: name ? name.slice(0, 255) : null };
}

/** POST /api/v1/parse → 201 ParseResponse (or CSV with ?format=csv). */
export async function handleParse(req: Request, services: Services): Promise<Response> {
  const requestId = requestIdOf(req);
  const headers: Record<string, string> = { "x-request-id": requestId };
  try {
    const format = parseFormat(new URL(req.url));
    const principal = await authenticate(req, services);
    // Read and validate the upload before spending quota.
    const upload = await readUpload(req, principal, services);
    const { bytes, fileName } = upload;
    // Stored uploads are deleted once we are done with them, except after a
    // retryable failure (quota, upstream outage) so the client can retry the same path.
    const cleanup = async () => {
      if (upload.storagePath && services.uploads) {
        await services.uploads.remove(principal.userId, upload.storagePath).catch((e) =>
          console.warn("[docparse] upload cleanup failed", e));
      }
    };
    let info;
    try {
      info = inspectFile(bytes);
    } catch (err) {
      await cleanup();
      throw err;
    }

    const reservation = await services.usage.reserve(principal, info.billableUnits);
    if (isExceeded(reservation)) {
      throw new HttpError(429, "quota_exceeded_error", "quota_exceeded",
        `This file counts as ${info.billableUnits} document(s) and your plan has no documents left this period. Upgrade or wait for the reset.`,
        quotaHeaders(reservation.exceeded));
    }
    Object.assign(headers, quotaHeaders(reservation.quota));

    const createdAt = new Date().toISOString();
    let out;
    try {
      out = await extractDocument(bytes, { client: services.extractorClient, signal: req.signal });
    } catch (err) {
      await reservation.release().catch((e) => console.error("[docparse] usage release failed", e));
      if (!(err instanceof ExtractionError && err.retryable)) await cleanup();
      throw err;
    }
    await cleanup();
    console.info(
      `[docparse] extracted request_id=${requestId} attempts=${JSON.stringify(out.attempts)} tokens=${out.usage.input_tokens}/${out.usage.output_tokens}`,
    );

    const doc: DocumentRecord = {
      id: newDocumentId(),
      filename: fileName ?? `upload.${out.mimeType === "application/pdf" ? "pdf" : out.mimeType.split("/")[1]}`,
      mime_type: out.mimeType,
      size_bytes: bytes.length,
      status: "completed",
      created_at: createdAt,
      completed_at: new Date().toISOString(),
      result: toExtractionResult(out.data),
      error: null,
      page_count: out.pageCount,
      billable_units: out.billableUnits,
      warnings: out.warnings,
      model: out.model,
    };

    // Persist first, then bill: if the save fails the customer is not charged.
    try {
      await services.documents.save(principal.userId, doc);
    } catch (err) {
      await reservation.release().catch(() => {});
      throw err;
    }
    await reservation
      .commit({
        documentId: doc.id,
        pages: out.pageCount,
        units: out.billableUnits,
        model: out.model,
        inputTokens: out.usage.input_tokens,
        outputTokens: out.usage.output_tokens,
      })
      .catch((e) => console.error(`[docparse] usage commit failed request_id=${requestId}`, e));

    headers.location = `/api/v1/documents/${doc.id}`;
    if (format === "csv") return csv(doc, 201, headers);
    const body: ParseResponse = { id: doc.id, status: doc.status, document: doc };
    return json(body, 201, headers);
  } catch (err) {
    const res = errorResponse(err, requestId);
    for (const [k, v] of Object.entries(headers)) if (!res.headers.has(k)) res.headers.set(k, v);
    return res;
  }
}

/** GET /api/v1/documents/:id → DocumentRecord (or CSV with ?format=csv). */
export async function handleGetDocument(req: Request, id: string, services: Services): Promise<Response> {
  const requestId = requestIdOf(req);
  try {
    const format = parseFormat(new URL(req.url));
    const principal = await authenticate(req, services);
    const doc = DOC_ID_PATTERN.test(id) ? await services.documents.get(principal.userId, id) : null;
    if (!doc) throw new HttpError(404, "not_found_error", "document_not_found", `No document with id '${id}'.`);
    return format === "csv" ? csv(doc, 200, { "x-request-id": requestId }) : json(doc, 200, { "x-request-id": requestId });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}

/** GET /api/v1/documents?cursor&limit → DocumentListResponse, newest first. */
export async function handleListDocuments(req: Request, services: Services): Promise<Response> {
  const requestId = requestIdOf(req);
  try {
    const url = new URL(req.url);
    const principal = await authenticate(req, services);
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit === null ? 20 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new HttpError(400, "invalid_request_error", "invalid_limit", "limit must be an integer from 1 to 100.");
    }
    const cursor = url.searchParams.get("cursor") ?? undefined;
    return json(await services.documents.list(principal.userId, { cursor, limit }), 200, { "x-request-id": requestId });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}

/** GET /api/v1/usage → Usage for the current billing period. */
export async function handleGetUsage(req: Request, services: Services): Promise<Response> {
  const requestId = requestIdOf(req);
  try {
    const principal = await authenticate(req, services);
    return json(await services.usage.summary(principal), 200, { "x-request-id": requestId });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
