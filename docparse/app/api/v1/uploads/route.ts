import { authenticate } from "@/lib/server/auth";
import { errorResponse, HttpError } from "@/lib/server/errors";
import { getServices } from "@/lib/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/uploads { filename, size_bytes, mime_type } -> 201 SignedUpload
 * For files over ~4 MB: PUT the file to upload_url, then POST /api/v1/parse { storage_path }.
 * Session or API key, same as /api/v1/parse.
 */
export async function POST(req: Request): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? `req_${crypto.randomUUID().replace(/-/g, "")}`;
  try {
    const services = getServices();
    const principal = await authenticate(req, services);
    if (!services.uploads) {
      throw new HttpError(501, "api_error", "uploads_unavailable", "Large uploads need Supabase Storage to be configured.");
    }
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new HttpError(400, "invalid_request_error", "invalid_json", "Send JSON: { filename, size_bytes, mime_type }.");
    const upload = await services.uploads.createSignedUpload(principal.userId, body);
    return Response.json(upload, { status: 201, headers: { "x-request-id": requestId } });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
