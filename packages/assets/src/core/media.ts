import type { UploadedAssetMediaType } from "./types";

/**
 * Magic-byte media detection for uploaded images.
 *
 * The bytes decide — never the filename, never the extension, never a
 * `Content-Type` header. All four detectors only read fixed header
 * offsets, so a truncated file is simply "unsupported" instead of a
 * crash.
 */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function bytesStartWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) {
    return false;
  }
  return prefix.every((byte, index) => bytes[offset + index] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

/**
 * Detects the uploaded image media type from the raw leading bytes, or
 * undefined when the bytes are not one of the four supported formats.
 * AVIF is recognized by its ISO-BMFF `ftyp` box carrying the `avif` or
 * `avis` brand.
 */
export function detectUploadedImageMediaType(
  bytes: Uint8Array
): UploadedAssetMediaType | undefined {
  if (bytesStartWith(bytes, PNG_MAGIC)) {
    return "image/png";
  }
  if (bytesStartWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (bytesStartWith(bytes, [0x52, 0x49, 0x46, 0x46]) && asciiAt(bytes, 8, "WEBP")) {
    return "image/webp";
  }
  if (asciiAt(bytes, 4, "ftyp")) {
    if (asciiAt(bytes, 8, "avif") || asciiAt(bytes, 8, "avis")) {
      return "image/avif";
    }
  }
  return undefined;
}
