// @vitest-environment node
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ExtractionError } from "@/lib/extract/errors";
import {
  defaultChain, ESCALATION_MODEL, extractDocument, inspectFile, mapApiError, PRIMARY_MODEL,
} from "@/lib/extract/extractor";
import { fakeClient, PDF_BYTES, pdfWithPages, PNG_BYTES, sampleInvoice, TEXT_BYTES } from "./fixtures";

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ExtractionError);
    return (e as ExtractionError).code;
  }
  return "no error";
}

describe("defaultChain", () => {
  it("is Haiku 5.5 then Sonnet 5.5, with refusal fallbacks only on Sonnet", () => {
    expect(defaultChain({})).toEqual([
      { model: PRIMARY_MODEL, effort: "medium", refusalFallbacks: false },
      { model: ESCALATION_MODEL, effort: "medium", refusalFallbacks: true },
    ]);
    expect(PRIMARY_MODEL).toBe("claude-haiku-5-5");
    expect(ESCALATION_MODEL).toBe("claude-sonnet-5-5");
  });
  it("can be overridden or reduced to one model", () => {
    expect(defaultChain({ DOCPARSE_ESCALATION_MODEL: "none" })).toHaveLength(1);
    expect(defaultChain({ DOCPARSE_PRIMARY_MODEL: "claude-opus-5-5", DOCPARSE_EFFORT: "low" })[0]).toEqual({
      model: "claude-opus-5-5", effort: "low", refusalFallbacks: true,
    });
  });
});

describe("inspectFile", () => {
  it.each([[1, 1], [5, 1], [6, 2], [11, 3]])("%i pages = %i billable units", (pages, units) => {
    expect(inspectFile(pdfWithPages(pages))).toMatchObject({ pageCount: pages, billableUnits: units });
  });
  it("counts an image as one unit", () => {
    expect(inspectFile(PNG_BYTES)).toEqual({ mimeType: "image/png", pageCount: 1, billableUnits: 1 });
  });
});

describe("extractDocument", () => {
  it("returns Haiku's answer when it is confident, with one call", async () => {
    const { client, calls } = fakeClient();
    const result = await extractDocument(PDF_BYTES, { client });

    expect(calls).toHaveLength(1);
    expect(result.model).toBe("claude-haiku-5-5");
    expect(result.attempts).toEqual([{ model: "claude-haiku-5-5", outcome: "ok" }]);
    expect(result.data.invoice_number).toBe("INV-1001");
    expect(result.data.field_confidence.total).toBe(0.99);
    expect(result).toMatchObject({ mimeType: "application/pdf", pageCount: 2, billableUnits: 1 });

    const params = calls[0];
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params).not.toHaveProperty("fallbacks"); // not supported on Haiku 5.5
    expect(params).not.toHaveProperty("thinking");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.messages[0].content[0].type).toBe("document");
    expect(params.messages[0].content[1].type).toBe("text");
  });

  it("escalates to Sonnet on low confidence and returns Sonnet's answer", async () => {
    const { client, calls } = fakeClient([
      { parsed_output: sampleInvoice({ confidence: 0.5, total: 1 }) },
      { parsed_output: sampleInvoice({ confidence: 0.97 }) },
    ]);
    const result = await extractDocument(PNG_BYTES, { client });
    expect(calls.map((c) => c.model)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    expect(calls[1].fallbacks).toBe("default");
    expect(calls[1].betas).toContain("server-side-fallback-2026-07-01");
    expect(calls[1].messages[0].content[0].type).toBe("image");
    expect(result.model).toBe("claude-sonnet-5-5");
    expect(result.warnings).toEqual([]);
    expect(result.attempts.map((a) => a.outcome)).toEqual(["escalated", "ok"]);
    expect(result.usage).toEqual({ input_tokens: 3000, output_tokens: 800 });
  });

  it("escalates when the numbers do not add up even if confidence is high", async () => {
    const { client, calls } = fakeClient([{ parsed_output: sampleInvoice({ total: 999 }) }, {}]);
    const result = await extractDocument(PDF_BYTES, { client });
    expect(calls).toHaveLength(2);
    expect(result.warnings).toEqual([]);
  });

  it("keeps the better answer when Sonnet is worse or fails", async () => {
    const haiku = sampleInvoice({ confidence: 0.7 });
    const worse = fakeClient([{ parsed_output: haiku }, { parsed_output: sampleInvoice({ confidence: 0.6, total: 5 }) }]);
    expect((await extractDocument(PDF_BYTES, { client: worse.client })).model).toBe("claude-haiku-5-5");

    const failing = fakeClient([{ parsed_output: haiku }, { stop_reason: "refusal", parsed_output: null }]);
    const r = await extractDocument(PDF_BYTES, { client: failing.client });
    expect(r.model).toBe("claude-haiku-5-5");
    expect(r.attempts.map((a) => a.outcome)).toEqual(["escalated", "refused"]);
  });

  it.each([
    ["refusal", { stop_reason: "refusal", parsed_output: null }],
    ["malformed output", { parsed_output: { document_type: "invoice" } }],
    ["'other' document type", { parsed_output: sampleInvoice({ document_type: "other" }) }],
  ])("escalates after a Haiku %s", async (_label, first) => {
    const { client, calls } = fakeClient([first, {}]);
    const result = await extractDocument(PDF_BYTES, { client });
    expect(calls).toHaveLength(2);
    expect(result.model).toBe("claude-sonnet-5-5");
  });

  it("escalates after an upstream error from Haiku", async () => {
    const { client } = fakeClient([
      async () => {
        throw Anthropic.APIError.generate(529, { type: "error" }, "overloaded", new Headers());
      },
      {},
    ]);
    expect((await extractDocument(PDF_BYTES, { client })).model).toBe("claude-sonnet-5-5");
  });

  it.each([
    [{ stop_reason: "refusal", parsed_output: null }, "refused"],
    [{ parsed_output: null }, "invalid_model_output"],
    [{ parsed_output: sampleInvoice({ document_type: "other" }) }, "unsupported_document"],
  ])("throws when every model fails (%#)", async (response, code) => {
    const { client, calls } = fakeClient(response);
    expect(await codeOf(extractDocument(PDF_BYTES, { client }))).toBe(code);
    expect(calls).toHaveLength(2);
  });

  it("does not escalate a truncated output (a bigger model will not fit more)", async () => {
    const { client, calls } = fakeClient({ stop_reason: "max_tokens", parsed_output: null });
    expect(await codeOf(extractDocument(PDF_BYTES, { client }))).toBe("output_truncated");
    expect(calls).toHaveLength(1);
  });

  it("validates the file before calling Claude", async () => {
    const { client, calls } = fakeClient();
    expect(await codeOf(extractDocument(TEXT_BYTES, { client }))).toBe("unsupported_file_type");
    expect(calls).toHaveLength(0);
  });

  it("honours a custom chain and threshold", async () => {
    const { client, calls } = fakeClient({ parsed_output: sampleInvoice({ confidence: 0.6 }) });
    await extractDocument(PDF_BYTES, {
      client,
      escalateBelow: 0.5,
      chain: [{ model: "claude-opus-5-5", effort: "high", refusalFallbacks: true }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "high" }, fallbacks: "default" });
  });
});

describe("mapApiError", () => {
  const apiErr = (status: number) => Anthropic.APIError.generate(status, { type: "error" }, "boom", new Headers());
  it.each([
    [429, "upstream_rate_limited", true],
    [500, "upstream_unavailable", true],
    [529, "upstream_unavailable", true],
    [400, "upstream_error", false],
  ])("status %i -> %s", (status, code, retryable) => {
    const e = mapApiError(apiErr(status));
    expect(e.code).toBe(code);
    expect(e.retryable).toBe(retryable);
  });
  it("maps connection errors, wraps unknown errors and passes ExtractionError through", () => {
    expect(mapApiError(new Anthropic.APIConnectionError({ message: "x" })).code).toBe("upstream_unavailable");
    expect(mapApiError(new Error("x")).code).toBe("upstream_error");
    const own = new ExtractionError("refused", "no");
    expect(mapApiError(own)).toBe(own);
  });
});
