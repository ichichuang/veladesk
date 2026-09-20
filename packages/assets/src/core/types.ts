/**
 * Public contracts of @veladesk/assets/core.
 *
 * The core is pure and dependency-free: SHA-256 content addressing,
 * magic-byte media detection and the shared size budget. It runs
 * identically in Node 24 (server) and the browser via the standard
 * Web Crypto API — no third-party hashing, no filename trust, no
 * Content-Type trust.
 */

/**
 * The one supported upload size budget: 4 MiB, shared verbatim by the
 * browser stage path and the server PUT boundary so the two can never
 * drift.
 */
export const MAX_ASSET_BYTES = 4 * 1024 * 1024;

/** Image media types V1 accepts for upload. SVG/GIF/BMP/ICO are excluded. */
export type UploadedAssetMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/avif";

/**
 * A content-addressed asset id: `asset-sha256-` plus the lowercase hex
 * SHA-256 of the exact uploaded bytes. Equal bytes always produce the
 * equal id — dedupe and idempotent PUTs fall out of the identity.
 */
export type ContentAssetId = string;

/** A validated, hashed upload ready to be staged or stored. */
export interface PreparedAsset {
  readonly id: ContentAssetId;
  readonly blob: Blob;
  readonly mediaType: UploadedAssetMediaType;
  readonly byteLength: number;
}

/** Why {@link prepareAssetBlob} refused an upload. */
export type PrepareAssetFailureReason =
  | "asset-empty"
  | "asset-too-large"
  | "unsupported-image-type";

export type PrepareAssetResult =
  | {
      readonly ok: true;
      readonly asset: PreparedAsset;
    }
  | {
      readonly ok: false;
      readonly reason: PrepareAssetFailureReason;
    };

/** Why {@link verifyAssetBytes} refused bytes for an expected asset id. */
export type VerifyAssetFailureReason =
  | "invalid-asset-id"
  | "asset-empty"
  | "asset-too-large"
  | "unsupported-image-type"
  | "asset-id-mismatch";

export type VerifyAssetResult =
  | {
      readonly ok: true;
      readonly mediaType: UploadedAssetMediaType;
      readonly byteLength: number;
    }
  | {
      readonly ok: false;
      readonly reason: VerifyAssetFailureReason;
    };

/** Server-side projection of a stored asset (no blob involved). */
export interface StoredAssetInfo {
  readonly id: ContentAssetId;
  readonly mediaType: UploadedAssetMediaType;
  readonly byteLength: number;
}
