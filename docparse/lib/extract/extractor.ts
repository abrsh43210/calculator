import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { PAGES_PER_DOC } from "@/lib/pricing";
import { ExtractionError, type ExtractionErrorCode } from "./errors";
import { estimatePageCount, prepareForClaude, toContentBlock, validateFile, type SupportedMime } from "./file";
import { SYSTEM_PROMPT, USER_PROMPT } from "./prompt";
import { ExtractionSchema, type Extraction } from "./schema";
import { normalizeAndCheck } from "./validate";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelStep {
  model: string;
  effort: Effort;
  /** Send server-side refusal fallbacks. Not supported on Haiku 5.5. */
  refusalFallbacks: boolean;
}

/**
 * Cost-driven chain (see docs/pricing-research.md): Haiku 5.5 handles most documents
 * for ~$0.001; Sonnet 5.5 re-runs the ones Haiku is unsure about. Override with
 * DOCPARSE_PRIMARY_MODEL / DOCPARSE_ESCALATION_MODEL (set the latter to "none" to disable).
 */
export const PRIMARY_MODEL = "claude-haiku-5-5";
export const ESCALATION_MODEL = "claude-sonnet-5-5";
/** Escalate when overall confidence is below this. Override with DOCPARSE_ESCALATE_BELOW. */
export const DEFAULT_ESCALATE_BELOW = 0.8;

export function defaultChain(env: Record<string, string | undefined> = process.env): ModelStep[] {
  const effort = (env.DOCPARSE_EFFORT as Effort | undefined) ?? "medium";
  const primary = env.DOCPARSE_PRIMARY_MODEL || PRIMARY_MODEL;
  const escalation = env.DOCPARSE_ESCALATION_MODEL || ESCALATION_MODEL;
  const supportsFallbacks = (m: string) => !m.startsWith("claude-haiku");
  const chain: ModelStep[] = [{ model: primary, effort, refusalFallbacks: supportsFallbacks(primary) }];
  if (escalation !== "none" && escalation !== primary) {
    chain.push({ model: escalation, effort, refusalFallbacks: supportsFallbacks(escalation) });
  }
  return chain;
}

/** The slice of the Anthropic SDK this module uses. Tests pass a fake. */
export interface ExtractorClient {
  beta: { messages: { parse: Anthropic["beta"]["messages"]["parse"] } };
}

export interface ExtractOptions {
  client?: ExtractorClient;
  chain?: ModelStep[];
  escalateBelow?: number;
  /** Abort if the caller goes away (e.g. client disconnects). */
  signal?: AbortSignal;
}

export interface FileInfo {
  mimeType: SupportedMime;
  pageCount: number;
  /** ceil(pages / 5): what the customer is billed. */
  billableUnits: number;
}

export interface ExtractorOutput extends FileInfo {
  data: Extraction;
  warnings: string[];
  /** Model whose output was returned. */
  model: string;
  /** Every model call made, in order (for logs / cost analytics). */
  attempts: Array<{ model: string; outcome: "ok" | "escalated" | ExtractionErrorCode }>;
  /** Tokens summed across all attempts. */
  usage: { input_tokens: number; output_tokens: number };
}

/** Validate the upload and work out what it will cost, before spending anything. */
export function inspectFile(bytes: Uint8Array): FileInfo {
  const mimeType = validateFile(bytes);
  const pageCount = estimatePageCount(bytes, mimeType);
  return { mimeType, pageCount, billableUnits: Math.max(1, Math.ceil(pageCount / PAGES_PER_DOC)) };
}

/** Errors worth a second opinion from the stronger model. */
const ESCALATE_ON: ReadonlySet<ExtractionErrorCode> = new Set([
  "refused",
  "invalid_model_output",
  "unsupported_document",
  "upstream_rate_limited",
  "upstream_unavailable",
  "upstream_error",
]);

let defaultClient: Anthropic | null = null;
function getDefaultClient(): ExtractorClient {
  // Reads ANTHROPIC_API_KEY. 2 retries on 429/5xx/connection errors are built in.
  defaultClient ??= new Anthropic({ maxRetries: 2, timeout: 120_000 });
  return defaultClient;
}

type Attempt =
  | { ok: true; data: Extraction; warnings: string[]; model: string; usage: { input_tokens: number; output_tokens: number } }
  | { ok: false; error: ExtractionError; usage: { input_tokens: number; output_tokens: number } };

async function runStep(
  client: ExtractorClient,
  step: ModelStep,
  content: Anthropic.Beta.BetaContentBlockParam,
  signal?: AbortSignal,
): Promise<Attempt> {
  const noUsage = { input_tokens: 0, output_tokens: 0 };
  let response: Awaited<ReturnType<ExtractorClient["beta"]["messages"]["parse"]>>;
  try {
    response = await client.beta.messages.parse(
      {
        model: step.model,
        max_tokens: 16000,
        ...(step.refusalFallbacks
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
        system: SYSTEM_PROMPT,
        output_config: { effort: step.effort, format: betaZodOutputFormat(ExtractionSchema) },
        messages: [{ role: "user", content: [content, { type: "text", text: USER_PROMPT }] }],
      },
      { signal },
    );
  } catch (err) {
    if (signal?.aborted) throw err; // caller went away; do not escalate
    return { ok: false, error: mapApiError(err), usage: noUsage };
  }

  const usage = { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens };
  const fail = (code: ExtractionErrorCode, message: string): Attempt => ({
    ok: false,
    error: new ExtractionError(code, message),
    usage,
  });

  if (response.stop_reason === "refusal") {
    return fail("refused", "The document could not be processed by the extraction model.");
  }
  if (response.stop_reason === "max_tokens" || response.stop_reason === "model_context_window_exceeded") {
    return fail("output_truncated", "The document is too long to extract in one request. Split it into smaller files.");
  }
  // parse() validated already; re-check so a malformed response never reaches customers.
  const parsed = ExtractionSchema.safeParse(response.parsed_output);
  if (!parsed.success) {
    return fail("invalid_model_output", "The extraction model returned malformed data. Please retry.");
  }
  if (parsed.data.document_type === "other") {
    return fail("unsupported_document", "This file does not look like an invoice or receipt.");
  }
  const { data, warnings } = normalizeAndCheck(parsed.data);
  return { ok: true, data, warnings, model: response.model, usage };
}

/**
 * Turn an invoice or receipt (PDF or image bytes) into validated structured data.
 * Runs the model chain: the next model is tried when the current one fails with a
 * recoverable error, reports low confidence, or its numbers do not add up.
 * Throws ExtractionError for every expected failure.
 */
export async function extractDocument(bytes: Uint8Array, options: ExtractOptions = {}): Promise<ExtractorOutput> {
  const info = inspectFile(bytes);
  const client = options.client ?? getDefaultClient();
  const chain = options.chain ?? defaultChain();
  const escalateBelow =
    options.escalateBelow ?? Number(process.env.DOCPARSE_ESCALATE_BELOW ?? DEFAULT_ESCALATE_BELOW);

  const prepared = await prepareForClaude(bytes, info.mimeType);
  const content = toContentBlock(prepared.bytes, prepared.mime);

  const attempts: ExtractorOutput["attempts"] = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  let best: Extract<Attempt, { ok: true }> | null = null;
  let lastError: ExtractionError | null = null;

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    const isLast = i === chain.length - 1;
    const attempt = await runStep(client, step, content, options.signal);
    usage.input_tokens += attempt.usage.input_tokens;
    usage.output_tokens += attempt.usage.output_tokens;

    if (!attempt.ok) {
      attempts.push({ model: step.model, outcome: attempt.error.code });
      lastError = attempt.error;
      if (!ESCALATE_ON.has(attempt.error.code)) break;
      continue;
    }

    const unsure = attempt.data.confidence < escalateBelow || attempt.warnings.length > 0;
    // Keep the better of the attempts so far (fewer warnings, then higher confidence).
    if (
      !best ||
      attempt.warnings.length < best.warnings.length ||
      (attempt.warnings.length === best.warnings.length && attempt.data.confidence >= best.data.confidence)
    ) {
      best = attempt;
    }
    if (!unsure || isLast) {
      attempts.push({ model: step.model, outcome: "ok" });
      break;
    }
    attempts.push({ model: step.model, outcome: "escalated" });
  }

  if (best) {
    return { ...info, data: best.data, warnings: best.warnings, model: best.model, attempts, usage };
  }
  throw lastError ?? new ExtractionError("upstream_error", "No extraction model is configured.");
}

/** Most-specific-first mapping from SDK errors to ExtractionError. */
export function mapApiError(err: unknown): ExtractionError {
  if (err instanceof ExtractionError) return err;
  if (err instanceof Anthropic.RateLimitError) {
    return new ExtractionError("upstream_rate_limited", "Extraction capacity is temporarily exhausted. Retry shortly.", { cause: err });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    // Includes APIConnectionTimeoutError.
    return new ExtractionError("upstream_unavailable", "The extraction service could not be reached. Retry shortly.", { cause: err });
  }
  if (err instanceof Anthropic.InternalServerError || (err instanceof Anthropic.APIError && err.status === 529)) {
    return new ExtractionError("upstream_unavailable", "The extraction service is overloaded. Retry shortly.", { cause: err });
  }
  if (err instanceof Anthropic.APIError) {
    return new ExtractionError("upstream_error", "The extraction service rejected the request.", { cause: err });
  }
  return new ExtractionError("upstream_error", "Unexpected extraction failure.", { cause: err });
}
