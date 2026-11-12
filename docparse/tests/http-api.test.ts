import { afterEach, describe, expect, it, vi } from "vitest";
import { httpApi } from "@/lib/api/http";
import { ApiError } from "@/lib/api/errors";

afterEach(() => vi.unstubAllGlobals());

describe("http API client", () => {
  it("posts multipart to /api/v1/parse", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "d1", status: "queued" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await httpApi.parse(new File(["x"], "a.pdf", { type: "application/pdf" }));
    expect(res).toEqual({ id: "d1", status: "queued" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/parse");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("sends files over 4 MB through a signed upload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ storage_path: "u1/abc.pdf", upload_url: "https://storage.test/put" }), { status: 201 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "d2", status: "completed" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const big = new File(["x"], "big scan.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 6 * 1024 * 1024 });

    expect(await httpApi.parse(big)).toEqual({ id: "d2", status: "completed" });

    const [u1, i1] = fetchMock.mock.calls[0];
    expect(u1).toBe("/api/v1/uploads");
    expect(JSON.parse(i1.body)).toEqual({ filename: "big scan.pdf", size_bytes: 6 * 1024 * 1024, mime_type: "application/pdf" });
    const [u2, i2] = fetchMock.mock.calls[1];
    expect(u2).toBe("https://storage.test/put");
    expect(i2).toMatchObject({ method: "PUT", headers: { "Content-Type": "application/pdf" } });
    expect(i2.body).toBe(big);
    const [u3, i3] = fetchMock.mock.calls[2];
    expect(u3).toBe("/api/v1/parse");
    expect(JSON.parse(i3.body)).toEqual({ storage_path: "u1/abc.pdf", filename: "big scan.pdf" });
  });

  it("reports a failed storage upload", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ storage_path: "p", upload_url: "https://s/put" }), { status: 201 }))
        .mockResolvedValueOnce(new Response("denied", { status: 403 })),
    );
    const big = new File(["x"], "b.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 5 * 1024 * 1024 });
    await expect(httpApi.parse(big)).rejects.toMatchObject({ code: "upload_failed", status: 403 });
  });

  it("gets /api/v1/documents/:id with encoding", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await httpApi.getDocument("a/b");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/documents/a%2Fb");
  });

  it("turns error bodies into ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "quota_exceeded", message: "Upgrade" } }), { status: 402 }),
      ),
    );
    const err = await httpApi.getUsage().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 402, code: "quota_exceeded", message: "Upgrade" });
  });

  it("keeps the server request id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { type: "x", code: "document_not_found", message: "Nope", request_id: "req_1" } }), { status: 404 }),
      ),
    );
    await expect(httpApi.getDocument("d")).rejects.toMatchObject({ code: "document_not_found", requestId: "req_1" });
  });

  it("reports network failures clearly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(httpApi.listApiKeys()).rejects.toMatchObject({ code: "network_error" });
  });
});
