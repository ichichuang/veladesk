import { detectUploadedImageMediaType } from "./media";
import type {
  ContentAssetId,
  PrepareAssetResult,
  PreparedAsset,
  StoredAssetInfo,
  UploadedAssetMediaType,
  VerifyAssetResult,
} from "./types";
import { MAX_ASSET_BYTES } from "./types";

/**
 * SHA-256 content addressing over the standard Web Crypto API.
 *
 * `crypto.subtle` is available in Node 24 (globalThis.crypto) and every
 * browser — one hashing path for both sides, no third-party package. The
 * hex digest is lowercase, so the derived asset ids are canonical.
 */

const CONTENT_ASSET_ID_PATTERN = /^asset-sha256-[0-9a-f]{64}$/;

/** Whether `value` is a well-formed content-addressed asset id. */
export function isContentAssetId(value: unknown): value is ContentAssetId {
  return typeof value === "string" && CONTENT_ASSET_ID_PATTERN.test(value);
}

function toHex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The lowercase hex SHA-256 of the exact bytes. */
export async function hashAssetBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return toHex(digest);
}

/** `asset-sha256-<hex>` of the exact bytes. */
export async function createContentAssetId(bytes: Uint8Array): Promise<ContentAssetId> {
  return `asset-sha256-${await hashAssetBytes(bytes)}`;
}

/**
 * The shared validate → detect → hash → canonical-blob pipeline behind the
 * public prepare/verify helpers. Returns a discriminated failure instead
 * of throwing: every refusal is an expected outcome of user input.
 */
async function prepareBytes(
  bytes: Uint8Array
): Promise<
  | { ok: true; id: ContentAssetId; mediaType: UploadedAssetMediaType; byteLength: number }
  | { ok: false; reason: "asset-empty" | "asset-too-large" | "unsupported-image-type" }
> {
  if (bytes.byteLength === 0) {
    return { ok: false, reason: "asset-empty" };
  }
  if (bytes.byteLength > MAX_ASSET_BYTES) {
    return { ok: false, reason: "asset-too-large" };
  }
  const mediaType = detectUploadedImageMediaType(bytes);
  if (mediaType === undefined) {
    return { ok: false, reason: "unsupported-image-type" };
  }
  const id = await createContentAssetId(bytes);
  return { ok: true, id, mediaType, byteLength: bytes.byteLength };
}

/**
 * Validates and hashes an uploaded blob: size budget, magic-byte media
 * detection, SHA-256 identity. The returned `PreparedAsset.blob` is a NEW
 * canonical blob carrying the detected media type — the original File/Blob
 * (and whatever type label the browser guessed from the filename) is
 * discarded.
 */
export async function prepareAssetBlob(blob: Blob): Promise<PrepareAssetResult> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const prepared = await prepareBytes(bytes);
  if (!prepared.ok) {
    return prepared;
  }
  const asset: PreparedAsset = {
    id: prepared.id,
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: prepared.mediaType }),
    mediaType: prepared.mediaType,
    byteLength: prepared.byteLength,
  };
  return { ok: true, asset };
}

/**
 * Verifies raw bytes against an expected content asset id: the id must be
 * well-formed, the bytes within budget and of a supported type, and the
 * recomputed hash MUST equal the id. Used by the server PUT boundary and
 * by the browser transport before any remote bytes are trusted.
 */
export async function verifyAssetBytes(
  assetId: ContentAssetId,
  bytes: Uint8Array
): Promise<VerifyAssetResult> {
  if (!isContentAssetId(assetId)) {
    return { ok: false, reason: "invalid-asset-id" };
  }
  const prepared = await prepareBytes(bytes);
  if (!prepared.ok) {
    return prepared;
  }
  if (prepared.id !== assetId) {
    return { ok: false, reason: "asset-id-mismatch" };
  }
  return {
    ok: true,
    mediaType: prepared.mediaType,
    byteLength: prepared.byteLength,
  };
}

/** The stored-asset projection of raw bytes (server side convenience). */
export async function storedAssetInfoFromBytes(
  assetId: ContentAssetId,
  bytes: Uint8Array
): Promise<StoredAssetInfo | undefined> {
  const verified = await verifyAssetBytes(assetId, bytes);
  if (!verified.ok) {
    return undefined;
  }
  return { id: assetId, mediaType: verified.mediaType, byteLength: verified.byteLength };
}
