import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMock, mockApi, mockConfig } from "@/lib/api/mock";
import { ApiError } from "@/lib/api/errors";
import { validateUpload } from "@/lib/api/client";

beforeEach(() => {
  __resetMock();
  mockConfig.latency = 0;
  mockConfig.processingMs = 10;
});

describe("mock API", () => {
  it("parses a file and completes it", async () => {
    vi.useFakeTimers();
    const p = mockApi.parse(new File(["x"], "inv.pdf", { type: "application/pdf" }));
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.status).toBe("processing");
    await vi.advanceTimersByTimeAsync(20);
    const g = mockApi.getDocument(res.id);
    await vi.runAllTimersAsync();
    const doc = await g;
    expect(doc.status).toBe("completed");
    expect(doc.result?.document_type).toBe("invoice");
    vi.useRealTimers();
  });

  it("counts uploads toward usage", async () => {
    const before = (await mockApi.getUsage()).docs_used;
    await mockApi.parse(new File(["x"], "a.pdf", { type: "application/pdf" }));
    expect((await mockApi.getUsage()).docs_used).toBe(before + 1);
  });

  it("404s on unknown documents", async () => {
    await expect(mockApi.getDocument("nope")).rejects.toBeInstanceOf(ApiError);
  });

  it("creates keys with a one-time secret and revokes them", async () => {
    const k = await mockApi.createApiKey("CI");
    expect(k.secret).toMatch(/^dp_live_[0-9a-f]{32}$/);
    expect(k.prefix).toBe(k.secret.slice(0, 12));
    const listed = await mockApi.listApiKeys();
    expect(listed.find((x) => x.id === k.id)).not.toHaveProperty("secret");
    await mockApi.revokeApiKey(k.id);
    expect((await mockApi.listApiKeys()).some((x) => x.id === k.id)).toBe(false);
  });

  it("reports a plan change for existing subscribers", async () => {
    const res = await mockApi.startCheckout("business");
    expect(res.kind).toBe("updated");
    expect(res.url).toContain("checkout=updated");
  });

  it("refuses API keys on the Free plan", async () => {
    await mockApi.startCheckout("free");
    await expect(mockApi.createApiKey("x")).rejects.toMatchObject({ status: 403, code: "plan_without_api_access" });
  });

  it("rejects blank key names", async () => {
    await expect(mockApi.createApiKey("  ")).rejects.toThrow(/name/);
  });
});

describe("validateUpload", () => {
  it("accepts PDFs and images", () => {
    expect(validateUpload(new File(["x"], "a.pdf", { type: "application/pdf" }))).toBeNull();
    expect(validateUpload(new File(["x"], "a.png", { type: "image/png" }))).toBeNull();
  });
  it("rejects other types and big files", () => {
    expect(validateUpload(new File(["x"], "a.txt", { type: "text/plain" }))).toMatch(/only PDF/);
    const big = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 });
    expect(validateUpload(big)).toMatch(/20 MB/);
  });
});
