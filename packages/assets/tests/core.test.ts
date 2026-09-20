import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  MAX_ASSET_BYTES,
  createContentAssetId,
  detectUploadedImageMediaType,
  hashAssetBytes,
  isContentAssetId,
  prepareAssetBlob,
  storedAssetInfoFromBytes,
  verifyAssetBytes,
} from "../src/core";
import type { ContentAssetId } from "../src/core";

// --- Real-PNG fixture (hand-built, decodable, deterministic) ---------------

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  const typed = out.slice(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(typed));
  return out;
}

/** Builds a real, decodable RGBA PNG of width×height pixels. */
export function makePngBytes(width = 1, height = 1, fill = 200): Uint8Array {
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let row = 0; row < height; row += 1) {
    raw[row * (1 + width * 4)] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const offset = row * (1 + width * 4) + 1 + x * 4;
      raw[offset] = fill;
      raw[offset + 1] = fill;
      raw[offset + 2] = fill;
      raw[offset + 3] = 255;
    }
  }
  const idat = deflateSync(raw);
  const parts = [
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", new Uint8Array(idat)),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function makeJpegBytes(): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
}

function makeWebpBytes(): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x52, 0x49, 0x46, 0x46]); // RIFF
  new DataView(bytes.buffer).setUint32(4, 16, true);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  bytes.set([0x56, 0x50, 0x38, 0x20], 12); // VP8 chunk
  return bytes;
}

function makeAvifBytes(brand: "avif" | "avis"): Uint8Array {
  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setUint32(0, 16);
  bytes.set([0x66, 0x74, 0x79, 0x70], 4); // ftyp
  bytes.set([brand.charCodeAt(0), brand.charCodeAt(1), brand.charCodeAt(2), brand.charCodeAt(3)], 8);
  return bytes;
}

describe("isContentAssetId", () => {
  it("accepts exactly asset-sha256- plus 64 lowercase hex digits", () => {
    const valid = `asset-sha256-${"a".repeat(64)}`;
    expect(isContentAssetId(valid)).toBe(true);
    expect(isContentAssetId("asset-sha256-a3c1")).toBe(false);
    expect(isContentAssetId(`asset-sha256-${"A".repeat(64)}`)).toBe(false);
    expect(isContentAssetId(`asset-sha256-${"g".repeat(64)}`)).toBe(false);
    expect(isContentAssetId("asset-md5-abc")).toBe(false);
    expect(isContentAssetId(42)).toBe(false);
    expect(isContentAssetId(undefined)).toBe(false);
  });

  it("rejects path-shaped strings outright", () => {
    expect(isContentAssetId("../etc/passwd")).toBe(false);
    expect(isContentAssetId("asset-sha256-../etc/passwd")).toBe(false);
    expect(isContentAssetId("asset-sha256-a\\b")).toBe(false);
    expect(isContentAssetId("asset-sha256-a b")).toBe(false);
    expect(isContentAssetId("asset-sha256-a%2Fb")).toBe(false);
  });
});

describe("detectUploadedImageMediaType", () => {
  it("detects PNG by the standard 8-byte magic", () => {
    expect(detectUploadedImageMediaType(makePngBytes())).toBe("image/png");
  });

  it("detects JPEG by FF D8 FF", () => {
    expect(detectUploadedImageMediaType(makeJpegBytes())).toBe("image/jpeg");
  });

  it("detects WebP by RIFF … WEBP", () => {
    expect(detectUploadedImageMediaType(makeWebpBytes())).toBe("image/webp");
  });

  it("detects AVIF through ftyp brands avif and avis", () => {
    expect(detectUploadedImageMediaType(makeAvifBytes("avif"))).toBe("image/avif");
    expect(detectUploadedImageMediaType(makeAvifBytes("avis"))).toBe("image/avif");
  });

  it("rejects unsupported and lookalike containers", () => {
    const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(detectUploadedImageMediaType(gif)).toBeUndefined();
    expect(detectUploadedImageMediaType(new TextEncoder().encode("<svg xmlns='x'/>"))).toBeUndefined();
    expect(detectUploadedImageMediaType(new TextEncoder().encode("GIF89a"))).toBeUndefined();
    // RIFF without WEBP at offset 8 (e.g. WAV) is not WebP.
    const wav = new Uint8Array(16);
    wav.set([0x52, 0x49, 0x46, 0x46]);
    wav.set([0x57, 0x41, 0x56, 0x45], 8);
    expect(detectUploadedImageMediaType(wav)).toBeUndefined();
    // ftyp with a non-AVIF brand (mp4) is not AVIF.
    const mp4 = new Uint8Array(16);
    mp4.set([0x66, 0x74, 0x79, 0x70], 4);
    mp4.set([0x69, 0x73, 0x6f, 0x6d], 8);
    expect(detectUploadedImageMediaType(mp4)).toBeUndefined();
    expect(detectUploadedImageMediaType(new Uint8Array(0))).toBeUndefined();
  });

  it("never throws on truncated headers", () => {
    expect(detectUploadedImageMediaType(makePngBytes().slice(0, 4))).toBeUndefined();
    expect(detectUploadedImageMediaType(Uint8Array.from([0xff, 0xd8]))).toBeUndefined();
  });
});

describe("hashAssetBytes / createContentAssetId", () => {
  it("produces the known SHA-256 of empty input… and a canonical asset id format", async () => {
    const hello = new TextEncoder().encode("hello");
    expect(await hashAssetBytes(hello)).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
    const id = await createContentAssetId(hello);
    expect(id).toBe(
      "asset-sha256-2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
    expect(isContentAssetId(id)).toBe(true);
  });

  it("is deterministic and content-sensitive", async () => {
    const a = makePngBytes(2, 2, 10);
    const b = makePngBytes(2, 2, 10);
    const c = makePngBytes(2, 2, 11);
    expect(await createContentAssetId(a)).toBe(await createContentAssetId(b));
    expect(await createContentAssetId(a)).not.toBe(await createContentAssetId(c));
  });
});

describe("prepareAssetBlob", () => {
  it("prepares a valid PNG and canonicalizes the blob media type", async () => {
    const bytes = makePngBytes();
    const result = await prepareAssetBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/svg+xml" }));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.asset.id).toBe(await createContentAssetId(bytes));
    expect(result.asset.mediaType).toBe("image/png");
    expect(result.asset.byteLength).toBe(bytes.byteLength);
    expect(result.asset.blob.type).toBe("image/png");
    expect(new Uint8Array(await result.asset.blob.arrayBuffer())).toEqual(bytes);
  });

  it("rejects empty, oversized and unsupported uploads", async () => {
    expect(await prepareAssetBlob(new Blob([]))).toEqual({ ok: false, reason: "asset-empty" });
    expect(await prepareAssetBlob(new Blob([new Uint8Array(10)]))).toEqual({
      ok: false,
      reason: "unsupported-image-type",
    });
    const oversized = new Uint8Array(MAX_ASSET_BYTES + 1);
    oversized.set(makePngBytes());
    expect(await prepareAssetBlob(new Blob([oversized as Uint8Array<ArrayBuffer>]))).toEqual({
      ok: false,
      reason: "asset-too-large",
    });
  });

  it("accepts exactly 4 MiB", async () => {
    const exact = new Uint8Array(MAX_ASSET_BYTES);
    exact.set(makePngBytes());
    const result = await prepareAssetBlob(new Blob([exact as Uint8Array<ArrayBuffer>]));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.asset.byteLength).toBe(MAX_ASSET_BYTES);
    }
  });

  it("accepts all four supported media types", async () => {
    const expected: readonly string[] = [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/avif",
    ];
    const fixtures = [
      makePngBytes(),
      makeJpegBytes(),
      makeWebpBytes(),
      makeAvifBytes("avif"),
    ];
    for (const [index, bytes] of fixtures.entries()) {
      const result = await prepareAssetBlob(new Blob([bytes as Uint8Array<ArrayBuffer>]));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.asset.mediaType).toBe(expected[index]);
      }
    }
  });
});

describe("verifyAssetBytes", () => {
  it("accepts bytes whose hash equals the expected id", async () => {
    const bytes = makePngBytes(3, 2);
    const id = await createContentAssetId(bytes);
    const verified = await verifyAssetBytes(id as ContentAssetId, bytes);

    expect(verified).toEqual({
      ok: true,
      mediaType: "image/png",
      byteLength: bytes.byteLength,
    });
  });

  it("reports mismatch, bad ids, size and media failures distinctly", async () => {
    const bytes = makePngBytes(3, 2);
    const otherId = await createContentAssetId(makePngBytes(3, 3));
    expect(await verifyAssetBytes(otherId, bytes)).toEqual({ ok: false, reason: "asset-id-mismatch" });
    expect(await verifyAssetBytes("not-an-id", bytes)).toEqual({ ok: false, reason: "invalid-asset-id" });
    expect(await verifyAssetBytes(otherId, new Uint8Array(0))).toEqual({
      ok: false,
      reason: "asset-empty",
    });
    const oversized = new Uint8Array(MAX_ASSET_BYTES + 1);
    oversized.set(bytes);
    expect(await verifyAssetBytes(otherId, oversized)).toEqual({
      ok: false,
      reason: "asset-too-large",
    });
    expect(await verifyAssetBytes(otherId, new TextEncoder().encode("<svg/>"))).toEqual({
      ok: false,
      reason: "unsupported-image-type",
    });
  });
});

describe("storedAssetInfoFromBytes", () => {
  it("projects valid bytes and yields undefined on mismatch", async () => {
    const bytes = makePngBytes();
    const id = await createContentAssetId(bytes);
    expect(await storedAssetInfoFromBytes(id, bytes)).toEqual({
      id,
      mediaType: "image/png",
      byteLength: bytes.byteLength,
    });
    expect(await storedAssetInfoFromBytes(id, makePngBytes(9, 9))).toBeUndefined();
  });
});
