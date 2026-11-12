export type ExtractionErrorCode =
  | "unsupported_file_type"
  | "file_too_large"
  | "empty_file"
  | "unsupported_document"
  | "refused"
  | "output_truncated"
  | "invalid_model_output"
  | "upstream_rate_limited"
  | "upstream_unavailable"
  | "upstream_error";

const STATUS: Record<ExtractionErrorCode, number> = {
  unsupported_file_type: 415,
  file_too_large: 413,
  empty_file: 400,
  unsupported_document: 422,
  refused: 422,
  output_truncated: 422,
  invalid_model_output: 502,
  upstream_rate_limited: 503,
  upstream_unavailable: 503,
  upstream_error: 502,
};

/** Errors that should not consume a customer's quota. All extraction errors qualify. */
export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: ExtractionErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ExtractionError";
    this.code = code;
    this.status = STATUS[code];
    this.retryable = code === "upstream_rate_limited" || code === "upstream_unavailable";
  }
}
