import { ExtractionError } from "@/lib/extract/errors";

export type ApiErrorType =
  | "authentication_error"
  | "permission_error"
  | "invalid_request_error"
  | "not_found_error"
  | "quota_exceeded_error"
  | "extraction_error"
  | "upstream_error"
  | "api_error";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly type: ApiErrorType,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface ErrorBody {
  error: { type: ApiErrorType; code: string; message: string; request_id: string };
}

/** Convert anything thrown inside a handler into a JSON error Response. Never leaks internals. */
export function errorResponse(err: unknown, requestId: string): Response {
  let status = 500;
  let type: ApiErrorType = "api_error";
  let code = "internal_error";
  let message = "An unexpected error occurred.";
  const headers: Record<string, string> = { "content-type": "application/json", "x-request-id": requestId };

  if (err instanceof HttpError) {
    ({ status, type, code, message } = err);
    Object.assign(headers, err.headers);
  } else if (err instanceof ExtractionError) {
    status = err.status;
    code = err.code;
    message = err.message;
    type = err.code.startsWith("upstream_") || err.code === "invalid_model_output" ? "upstream_error" : "extraction_error";
    if (err.retryable) headers["retry-after"] = "10";
  } else {
    console.error(`[docparse] unhandled error request_id=${requestId}`, err);
  }

  const body: ErrorBody = { error: { type, code, message, request_id: requestId } };
  return new Response(JSON.stringify(body), { status, headers });
}
