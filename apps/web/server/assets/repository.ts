import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { createContentAssetId, detectUploadedImageMediaType, isContentAssetId } from "@veladesk/assets/core";
import type { UploadedAssetMediaType } from "@veladesk/assets/core";

/**
 * Filesystem persistence for uploaded assets.
 *
 * One immutable, content-addressed file per asset:
 * `${assetsDir}/<assetId>.bin`. There is no database table and no metadata
 * sidecar — the media type is re-detected from the bytes' magic on every
 * read, because the bytes ARE the metadata (SHA-256 content addressing
 * guarantees they never change under a fixed id).
 *
 * Path safety: a filename is only ever built from an id that passed
 * `isContentAssetId`, so no `/`, `\`, `..`, `%` or whitespace can ever
 * reach the filesystem layer.
 */

export type AssetPutResult =
  | {
      readonly stored: true;
      readonly alreadyExisted: boolean;
      readonly mediaType: UploadedAssetMediaType;
      readonly byteLength: number;
    }
  | {
      readonly stored: false;
      /** The existing file's bytes do not hash to its own id. */
      readonly reason: "corrupt-existing";
    };

export type AssetReadResult =
  | {
      readonly found: true;
      readonly bytes: Uint8Array;
      readonly mediaType: UploadedAssetMediaType;
      readonly byteLength: number;
    }
  | {
      readonly found: false;
    };

export interface AssetRepository {
  /**
   * Idempotent write: an existing file with correct content is left
   * untouched (200-already-existed semantics), a new one is written
   * atomically (201 semantics).
   */
  put(assetId: string, bytes: Uint8Array): Promise<AssetPutResult>;

  /** Reads and returns the bytes with their detected media type. */
  get(assetId: string): Promise<AssetReadResult>;

  /** Metadata-only existence probe (HEAD semantics). */
  head(assetId: string): Promise<{ exists: true; byteLength: number } | { exists: false }>;
}

export interface FilesystemAssetRepositoryOptions {
  readonly assetsDir: string;
}

export function createFilesystemAssetRepository(
  options: FilesystemAssetRepositoryOptions
): AssetRepository {
  const assetsDir = options.assetsDir;

  /** Only a validated content id may ever become a filename. */
  function safePath(assetId: string): string | undefined {
    if (!isContentAssetId(assetId)) {
      return undefined;
    }
    return path.join(assetsDir, `${assetId}.bin`);
  }

  function detect(bytes: Uint8Array): UploadedAssetMediaType | undefined {
    return detectUploadedImageMediaType(bytes);
  }

  async function put(assetId: string, bytes: Uint8Array): Promise<AssetPutResult> {
    const target = safePath(assetId);
    if (target === undefined) {
      throw new RangeError(`assetId must pass isContentAssetId, received: "${assetId}"`);
    }
    if (existsSync(target)) {
      // Content-addressed idempotence: same id ⇒ same bytes. The existing
      // file is never rewritten — but only its own hash proves the stored
      // data is really this asset; anything else is corrupt and must not
      // be reported as success.
      const existing = new Uint8Array(readFileSync(target));
      if ((await createContentAssetId(existing)) !== assetId) {
        return { stored: false, reason: "corrupt-existing" };
      }
      return {
        stored: true,
        alreadyExisted: true,
        mediaType: detect(existing)!,
        byteLength: existing.byteLength,
      };
    }

    mkdirSync(assetsDir, { recursive: true });
    const tempPath = path.join(assetsDir, `.${assetId}.tmp-${process.pid}-${randomUUID()}`);
    try {
      writeFileSync(tempPath, bytes);
      // Atomic publication: the final name appears only after a complete
      // write, so a crashed process can never leave a partial asset.
      renameSync(tempPath, target);
    } catch (error) {
      try {
        unlinkSync(tempPath);
      } catch {
        // The temp file already vanished — nothing to clean.
      }
      throw error;
    }
    return {
      stored: true,
      alreadyExisted: false,
      mediaType: detect(bytes)!,
      byteLength: bytes.byteLength,
    };
  }

  async function get(assetId: string): Promise<AssetReadResult> {
    const target = safePath(assetId);
    if (target === undefined || !existsSync(target)) {
      return { found: false };
    }
    const bytes = new Uint8Array(readFileSync(target));
    const mediaType = detect(bytes);
    if (mediaType === undefined) {
      // A stored file that no longer matches its content address is not an
      // asset — served as missing rather than as corrupt bytes.
      return { found: false };
    }
    return { found: true, bytes, mediaType, byteLength: bytes.byteLength };
  }

  async function head(assetId: string): Promise<{ exists: true; byteLength: number } | { exists: false }> {
    const target = safePath(assetId);
    if (target === undefined || !existsSync(target)) {
      return { exists: false };
    }
    return { exists: true, byteLength: statSync(target).size };
  }

  return { put, get, head };
}

function existsSync(target: string): boolean {
  try {
    statSync(target);
    return true;
  } catch {
    return false;
  }
}
