// @vitest-environment node
import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { handleGetDocument, handleGetUsage, handleListDocuments, handleParse } from "@/lib/server/handlers";
import { InMemoryApiKeyVerifier, InMemoryDocumentStore, InMemoryUsageService, MockSessionResolver } from "@/lib/server/mocks";
import type { Services } from "@/lib/server/services";
import { HttpError } from "@/lib/server/errors";
import type { UploadStore } from "@/lib/server/uploads";
import { fakeClient, PDF_BYTES, pdfWithPages, PNG_BYTES, sampleInvoice, TEXT_BYTES } from "../extract/fixtures";

const KEY_A = "dp_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const KEY_B = "dp_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const KEY_FREE = "dp_test_ffffffffffffffffffffffffffffffff";
const BASE = "https://docparse.test/api/v1";

let services: Services;
let usage: InMemoryUsageService;
let calls: any[];

function setup(response?: Parameters<typeof fakeClient>[0], plans?: ConstructorParameters<typeof InMemoryUsageService>[0]) {
  const fake = fakeClient(response);
  calls = fake.calls;
  usage = new InMemoryUsageService(plans);
  services = {
    apiKeys: new InMemoryApiKeyVerifier()
      .add(KEY_A, { userId: "user_a", apiKeyId: "key_a", plan: "pro", livemode: false })
      .add(KEY_B, { userId: "user_b", apiKeyId: "key_b", plan: "business", livemode: false })
      .add(KEY_FREE, { userId: "user_f", apiKeyId: "key_f", plan: "free", livemode: false }),
    sessions: new MockSessionResolver({
      a: { userId: "user_a", plan: "pro", livemode: false },
      f: { userId: "user_f", plan: "free", livemode: false },
    }),
    usage,
    documents: new InMemoryDocumentStore(),
    extractorClient: fake.client,
  };
}

type Auth = { key?: string | null; session?: string };
function authHeaders({ key, session }: Auth = {}): Record<string, string> {
  if (session) return { cookie: `theme=dark; dp_session=${session}` };
  if (key === null) return {};
  return { authorization: `Bearer ${key ?? KEY_A}` };
}

function multipart(bytes: Uint8Array, opts: Auth & { query?: string; name?: string } = {}) {
  const form = new FormData();
  form.append("file", new Blob([bytes as BlobPart]), opts.name ?? "invoice.pdf");
  return new Request(`${BASE}/parse${opts.query ?? ""}`, { method: "POST", body: form, headers: authHeaders(opts) });
}

const get = (path: string, auth: Auth = {}) => new Request(`${BASE}${path}`, { headers: authHeaders(auth) });

beforeEach(() => setup());

describe("POST /api/v1/parse", () => {
  it("returns a ParseResponse with the completed DocumentRecord and meters one document", async () => {
    const res = await handleParse(multipart(PDF_BYTES), services);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("completed");
    expect(body.id).toMatch(/^doc_[A-Za-z0-9]{24}$/);
    const doc = body.document;
    expect(doc).toMatchObject({
      id: body.id,
      filename: "invoice.pdf",
      mime_type: "application/pdf",
      size_bytes: PDF_BYTES.length,
      status: "completed",
      error: null,
      page_count: 2,
      billable_units: 1,
      warnings: [],
      model: "claude-haiku-5-5",
    });
    expect(doc.completed_at).toBeTruthy();
    expect(doc.result).toMatchObject({ document_type: "invoice", invoice_number: "INV-1001", tax: 12.55, total: 138.05 });
    expect(doc.result.field_confidence["vendor.name"]).toBe(0.98);
    expect(res.headers.get("location")).toBe(`/api/v1/documents/${body.id}`);
    expect(res.headers.get("x-request-id")).toMatch(/^req_/);
    expect(res.headers.get("x-quota-remaining")).toBe("499");
    expect(usage.events).toEqual([{ userId: "user_a", documentId: body.id, pages: 2, units: 1 }]);
  });

  it("works for a signed-in dashboard user on the Free plan (no API key)", async () => {
    const res = await handleParse(multipart(PNG_BYTES, { session: "f", name: "r.png" }), services);
    expect(res.status).toBe(201);
    expect(usage.used.get("user_f")).toBe(1);
  });

  it("bills ceil(pages / 5) documents for long PDFs", async () => {
    const res = await handleParse(multipart(pdfWithPages(12)), services);
    expect((await res.json()).document.billable_units).toBe(3);
    expect(usage.used.get("user_a")).toBe(3);
  });

  it("returns CSV with ?format=csv", async () => {
    const res = await handleParse(multipart(PDF_BYTES, { query: "?format=csv" }), services);
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="invoice.csv"');
    const lines = (await res.text()).trimEnd().split("\r\n");
    expect(lines[0]).toMatch(/^document_type,vendor_name/);
    expect(lines).toHaveLength(3);
  });

  it("accepts a raw body with x-api-key", async () => {
    const req = new Request(`${BASE}/parse`, {
      method: "POST",
      body: PNG_BYTES as BlobPart,
      headers: { "x-api-key": KEY_A, "content-type": "image/png", "x-file-name": "r.png" },
    });
    const res = await handleParse(req, services);
    expect(res.status).toBe(201);
    expect((await res.json()).document.filename).toBe("r.png");
  });

  it.each([
    [{ key: null }, "unauthenticated"],
    [{ key: "sk_nope" }, "invalid_api_key"],
    [{ key: "dp_test_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" }, "invalid_api_key"],
    [{ session: "nobody" }, "unauthenticated"],
  ])("rejects %j with 401", async (auth, code) => {
    const res = await handleParse(multipart(PDF_BYTES, auth), services);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatchObject({ type: "authentication_error", code });
    expect(calls).toHaveLength(0);
  });

  it("returns 403 for API keys on plans without API access", async () => {
    const res = await handleParse(multipart(PDF_BYTES, { key: KEY_FREE }), services);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("plan_without_api_access");
    expect(calls).toHaveLength(0);
  });

  it("rejects an invalid format with 400", async () => {
    const res = await handleParse(multipart(PDF_BYTES, { query: "?format=xml" }), services);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_format");
  });

  it("rejects a missing file field with 400", async () => {
    const form = new FormData();
    form.append("other", "x");
    const req = new Request(`${BASE}/parse`, { method: "POST", body: form, headers: authHeaders() });
    const res = await handleParse(req, services);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("missing_file");
  });

  it("rejects an oversized Content-Length with 413 before reading", async () => {
    const req = new Request(`${BASE}/parse`, {
      method: "POST",
      body: PDF_BYTES as BlobPart,
      headers: { ...authHeaders(), "content-length": String(50 * 1024 * 1024) },
    });
    expect((await handleParse(req, services)).status).toBe(413);
  });

  it("returns 415 for unsupported files and does not use quota", async () => {
    const res = await handleParse(multipart(TEXT_BYTES), services);
    expect(res.status).toBe(415);
    expect((await res.json()).error).toMatchObject({ type: "extraction_error", code: "unsupported_file_type" });
    expect(usage.used.get("user_a") ?? 0).toBe(0);
  });

  it("returns 429 when a hard-capped quota is used up", async () => {
    setup(undefined, { pro: { included: 1, hardCap: true } });
    expect((await handleParse(multipart(PDF_BYTES), services)).status).toBe(201);
    const res = await handleParse(multipart(PDF_BYTES), services);
    expect(res.status).toBe(429);
    expect((await res.json()).error.type).toBe("quota_exceeded_error");
    expect(res.headers.get("x-quota-remaining")).toBe("0");
    expect(calls).toHaveLength(1);
  });

  it("lets overage plans go past the included documents", async () => {
    setup(undefined, { pro: { included: 1, hardCap: false } });
    await handleParse(multipart(PDF_BYTES), services);
    const res = await handleParse(multipart(PDF_BYTES), services);
    expect(res.status).toBe(201);
    expect(res.headers.get("x-quota-used")).toBe("2");
  });

  it("releases quota when extraction fails on every model", async () => {
    setup({ stop_reason: "refusal", parsed_output: null });
    const res = await handleParse(multipart(PDF_BYTES), services);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("refused");
    expect(usage.used.get("user_a")).toBe(0);
    expect(usage.events).toHaveLength(0);
  });

  it("returns 503 with retry-after when Claude is rate limited", async () => {
    setup(async () => {
      throw Anthropic.APIError.generate(429, { type: "error" }, "rate limited", new Headers());
    });
    const res = await handleParse(multipart(PDF_BYTES), services);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("10");
    expect((await res.json()).error.type).toBe("upstream_error");
  });

  it("does not charge when saving fails, and hides internals", async () => {
    services.documents.save = async () => {
      throw new Error("db password=hunter2");
    };
    const res = await handleParse(multipart(PDF_BYTES), services);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("hunter2");
    expect(usage.used.get("user_a")).toBe(0);
  });

  it("returns warnings when every model gives inconsistent totals", async () => {
    setup({ parsed_output: sampleInvoice({ total: 1 }) });
    const body = await (await handleParse(multipart(PDF_BYTES), services)).json();
    expect(body.document.warnings.length).toBeGreaterThan(0);
  });
});

describe("GET /api/v1/documents/:id", () => {
  async function createDoc(auth: Auth = {}) {
    return (await (await handleParse(multipart(PDF_BYTES, auth), services)).json()).id as string;
  }

  it("returns the stored DocumentRecord as JSON or CSV", async () => {
    const id = await createDoc();
    const res = await handleGetDocument(get(`/documents/${id}`), id, services);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, status: "completed", result: { total: 138.05 } });
    const csv = await handleGetDocument(get(`/documents/${id}?format=csv`), id, services);
    expect(csv.headers.get("content-type")).toContain("text/csv");
  });

  it("lets the dashboard session read documents created with an API key", async () => {
    const id = await createDoc();
    expect((await handleGetDocument(get(`/documents/${id}`, { session: "a" }), id, services)).status).toBe(200);
  });

  it("returns 404 for another user's document and for malformed ids", async () => {
    const id = await createDoc();
    const res = await handleGetDocument(get(`/documents/${id}`, { key: KEY_B }), id, services);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("document_not_found");
    expect((await handleGetDocument(get("/documents/x"), "../../etc/passwd", services)).status).toBe(404);
  });

  it("requires auth", async () => {
    expect((await handleGetDocument(get("/documents/doc_x", { key: null }), "doc_x", services)).status).toBe(401);
  });
});

describe("GET /api/v1/documents", () => {
  it("lists the caller's documents newest first with cursor pagination", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await (await handleParse(multipart(PDF_BYTES), services)).json()).id);
    await handleParse(multipart(PDF_BYTES, { key: KEY_B }), services);

    const page1 = await (await handleListDocuments(get("/documents?limit=2"), services)).json();
    expect(page1.data.map((d: any) => d.id)).toEqual([ids[2], ids[1]]);
    expect(page1.next_cursor).toBe(ids[1]);
    const page2 = await (await handleListDocuments(get(`/documents?limit=2&cursor=${page1.next_cursor}`), services)).json();
    expect(page2.data.map((d: any) => d.id)).toEqual([ids[0]]);
    expect(page2.next_cursor).toBeNull();
  });

  it.each(["0", "101", "abc"])("rejects limit=%s", async (limit) => {
    const res = await handleListDocuments(get(`/documents?limit=${limit}`), services);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/usage", () => {
  it("returns the period summary", async () => {
    await handleParse(multipart(pdfWithPages(7)), services);
    const body = await (await handleGetUsage(get("/usage", { session: "a" }), services)).json();
    expect(body).toMatchObject({ plan: "pro", docs_used: 2, docs_limit: 500 });
    expect(Date.parse(body.period_end)).toBeGreaterThan(Date.parse(body.period_start));
  });
});

describe("POST /api/v1/parse with a storage_path", () => {
  const PATH = "user_a/1111.pdf";
  let removed: string[];
  let store: Map<string, Uint8Array>;

  function withUploads() {
    removed = [];
    store = new Map([[PATH, PDF_BYTES], ["user_a/2222.pdf", TEXT_BYTES]]);
    const uploads: UploadStore = {
      createSignedUpload: async () => { throw new Error("unused"); },
      fetch: async (userId, path) => {
        const bytes = store.get(path);
        if (!path.startsWith(`${userId}/`) || !bytes) {
          throw new HttpError(404, "not_found_error", "upload_not_found", "No upload at that storage_path.");
        }
        return { bytes, fileName: path.split("/").pop()! };
      },
      remove: async (_userId, path) => { removed.push(path); },
    };
    services.uploads = uploads;
  }

  const jsonParse = (body: unknown, auth: Auth = {}) =>
    new Request(`${BASE}/parse`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { ...authHeaders(auth), "content-type": "application/json" },
    });

  beforeEach(() => withUploads());

  it("extracts the stored file, keeps the given filename and deletes the upload", async () => {
    const res = await handleParse(jsonParse({ storage_path: PATH, filename: "March invoice.pdf" }), services);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.document).toMatchObject({ filename: "March invoice.pdf", size_bytes: PDF_BYTES.length, page_count: 2 });
    expect(removed).toEqual([PATH]);
    expect(usage.events).toHaveLength(1);
  });

  it("falls back to the stored file name", async () => {
    const body = await (await handleParse(jsonParse({ storage_path: PATH }), services)).json();
    expect(body.document.filename).toBe("1111.pdf");
  });

  it("returns 404 for another user's path and does not delete it", async () => {
    const res = await handleParse(jsonParse({ storage_path: PATH }, { key: KEY_B }), services);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("upload_not_found");
    expect(removed).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it.each([[{}, "missing_storage_path"], [{ storage_path: 5 }, "missing_storage_path"], ["{nope", "invalid_json"]])(
    "rejects body %j with 400",
    async (body, code) => {
      const res = await handleParse(jsonParse(body), services);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe(code);
    },
  );

  it("deletes an unsupported stored file without charging", async () => {
    const res = await handleParse(jsonParse({ storage_path: "user_a/2222.pdf" }), services);
    expect(res.status).toBe(415);
    expect(removed).toEqual(["user_a/2222.pdf"]);
    expect(usage.used.get("user_a") ?? 0).toBe(0);
  });

  it("keeps the upload after a retryable upstream failure so the client can retry", async () => {
    setup(async () => {
      throw Anthropic.APIError.generate(529, { type: "error" }, "overloaded", new Headers());
    });
    withUploads();
    const res = await handleParse(jsonParse({ storage_path: PATH }), services);
    expect(res.status).toBe(503);
    expect(removed).toEqual([]);
  });

  it("deletes the upload after a final extraction failure", async () => {
    setup({ stop_reason: "refusal", parsed_output: null });
    withUploads();
    expect((await handleParse(jsonParse({ storage_path: PATH }), services)).status).toBe(422);
    expect(removed).toEqual([PATH]);
  });

  it("returns 501 when uploads are not configured", async () => {
    services.uploads = undefined;
    const res = await handleParse(jsonParse({ storage_path: PATH }), services);
    expect(res.status).toBe(501);
  });
});
