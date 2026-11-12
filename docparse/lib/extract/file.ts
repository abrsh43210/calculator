import type Anthropic from "@anthropic-ai/sdk";
import { ExtractionError } from "./errors";

export type SupportedMime = "application/pdf" | "image/png" | "image/jpeg" | "image/webp";
type ImageMime = Exclude<SupportedMime, "application/pdf">;

/** Upload limit promised on the pricing page, for every file type. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Claude's per-image limit. Larger images are downscaled before sending. */
export const CLAUDE_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Long edge used when downscaling; well above what Claude needs to read receipts. */
const DOWNSCALE_LONG_EDGE = 2400;

/**
 * Detect the real file type from magic bytes. The client-supplied Content-Type is
 * not trusted.
 */
export function detectMime(bytes: Uint8Array): SupportedMime | null {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) {
    return "application/pdf"; // %PDF-
  }
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp"; // RIFF....WEBP
  }
  return null;
}

/** Validate size/type and return the detected mime. Throws ExtractionError. */
export function validateFile(bytes: Uint8Array): SupportedMime {
  if (bytes.length === 0) throw new ExtractionError("empty_file", "The uploaded file is empty.");
  if (bytes.length > MAX_FILE_BYTES) {
    throw new ExtractionError(
      "file_too_large",
      `File is ${(bytes.length / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
    );
  }
  const mime = detectMime(bytes);
  if (!mime) {
    throw new ExtractionError("unsupported_file_type", "Unsupported file type. Upload a PDF, PNG, JPG or WEBP.");
  }
  return mime;
}

/** Page count for billing. Images count as one page. */
export function estimatePageCount(bytes: Uint8Array, mime: SupportedMime): number {
  if (mime !== "application/pdf") return 1;
  const text = Buffer.from(bytes).toString("latin1");
  const matches = text.match(/\/Type\s*\/Page(?!s)/g);
  return Math.max(1, matches?.length ?? 1);
}

/**
 * Images over Claude's 5 MB limit (phone photos) are re-encoded as JPEG with a
 * bounded long edge. Small images and PDFs pass through untouched.
 */
export async function prepareForClaude(
  bytes: Uint8Array,
  mime: SupportedMime,
): Promise<{ bytes: Uint8Array; mime: SupportedMime }> {
  if (mime === "application/pdf" || bytes.length <= CLAUDE_MAX_IMAGE_BYTES) return { bytes, mime };
  const { default: sharp } = await import("sharp");
  for (const [edge, quality] of [[DOWNSCALE_LONG_EDGE, 85], [1800, 75], [1400, 70]] as const) {
    try {
      const out = await sharp(bytes)
        .rotate() // honour EXIF orientation from phone cameras
        .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
      if (out.length <= CLAUDE_MAX_IMAGE_BYTES) return { bytes: new Uint8Array(out), mime: "image/jpeg" };
    } catch (err) {
      throw new ExtractionError("unsupported_file_type", "The image could not be decoded.", { cause: err });
    }
  }
  throw new ExtractionError("file_too_large", "The image is too large to process even after downscaling.");
}

/** Build the Claude content block for the file. */
export function toContentBlock(bytes: Uint8Array, mime: SupportedMime): Anthropic.Beta.BetaContentBlockParam {
  const data = Buffer.from(bytes).toString("base64");
  if (mime === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  }
  return { type: "image", source: { type: "base64", media_type: mime as ImageMime, data } };
}
