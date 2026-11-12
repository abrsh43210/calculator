// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CLAUDE_MAX_IMAGE_BYTES, detectMime, estimatePageCount, MAX_FILE_BYTES, prepareForClaude, toContentBlock, validateFile,
} from "@/lib/extract/file";
import { ExtractionError } from "@/lib/extract/errors";
import { GIF_BYTES_UNSUPPORTED, JPEG_BYTES, PDF_BYTES, PNG_BYTES, TEXT_BYTES, WEBP_BYTES } from "./fixtures";

describe("detectMime", () => {
  it.each([
    [PDF_BYTES, "application/pdf"],
    [PNG_BYTES, "image/png"],
    [JPEG_BYTES, "image/jpeg"],
    [WEBP_BYTES, "image/webp"],
    [GIF_BYTES_UNSUPPORTED, null],
    [TEXT_BYTES, null],
  ])("detects %#", (bytes, expected) => {
    expect(detectMime(bytes)).toBe(expected);
  });
});

describe("validateFile", () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as ExtractionError).code;
    }
    return "no error";
  };
  it("rejects empty, unknown and oversized files", () => {
    expect(code(() => validateFile(new Uint8Array()))).toBe("empty_file");
    expect(code(() => validateFile(TEXT_BYTES))).toBe("unsupported_file_type");
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    big.set(PDF_BYTES);
    expect(code(() => validateFile(big))).toBe("file_too_large");
  });
  it("accepts a 20 MB image (it is downscaled later)", () => {
    const img = new Uint8Array(MAX_FILE_BYTES);
    img.set(PNG_BYTES);
    expect(validateFile(img)).toBe("image/png");
  });
});

describe("estimatePageCount / toContentBlock", () => {
  it("counts /Type /Page but not /Pages", () => {
    expect(estimatePageCount(PDF_BYTES, "application/pdf")).toBe(2);
    expect(estimatePageCount(PNG_BYTES, "image/png")).toBe(1);
  });
  it("builds document and image blocks", () => {
    expect(toContentBlock(PDF_BYTES, "application/pdf")).toMatchObject({
      type: "document",
      source: { type: "base64", media_type: "application/pdf" },
    });
    expect(toContentBlock(PNG_BYTES, "image/png")).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: Buffer.from(PNG_BYTES).toString("base64") },
    });
  });
});

describe("prepareForClaude", () => {
  it("passes small files through untouched", async () => {
    expect((await prepareForClaude(PNG_BYTES, "image/png")).bytes).toBe(PNG_BYTES);
    expect((await prepareForClaude(PDF_BYTES, "application/pdf")).bytes).toBe(PDF_BYTES);
  });

  it("downscales an image over Claude's 5 MB limit to JPEG", async () => {
    // Random noise compresses badly, so a 2400x2400 PNG is ~17 MB.
    const w = 2400, h = 2400;
    const raw = Buffer.alloc(w * h * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
    const png = new Uint8Array(await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer());
    expect(png.length).toBeGreaterThan(CLAUDE_MAX_IMAGE_BYTES);

    const out = await prepareForClaude(png, "image/png");
    expect(out.mime).toBe("image/jpeg");
    expect(out.bytes.length).toBeLessThanOrEqual(CLAUDE_MAX_IMAGE_BYTES);
  }, 20_000);

  it("rejects an undecodable oversized image", async () => {
    const junk = new Uint8Array(CLAUDE_MAX_IMAGE_BYTES + 10);
    junk.set(PNG_BYTES);
    await expect(prepareForClaude(junk, "image/png")).rejects.toMatchObject({ code: "unsupported_file_type" });
  });
});
