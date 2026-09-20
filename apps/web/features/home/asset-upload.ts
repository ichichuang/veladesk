import { prepareAssetBlob } from "@veladesk/assets/core";
import type { PreparedAsset } from "@veladesk/assets/core";

/**
 * Browser-side upload preparation for the Visual Editor (task 016-B).
 *
 * Beyond the shared core validation (size budget, magic bytes, hash), a
 * chosen file must actually DECODE in this browser before it may enter a
 * draft — and its dimensions stay within a sane bitmap budget so a tiny
 * compressed file cannot decompress into an enormous surface. These
 * decode/dimension rules are web-UI policy; the server contract never
 * decodes.
 */

/** Hard bitmap dimension budget per side (web upload UI policy). */
export const MAX_IMAGE_DIMENSION = 4096;

export type UploadValidationIssue =
  | "asset-empty"
  | "asset-too-large"
  | "unsupported-image-type"
  | "decode-failed"
  | "dimensions-too-large";

export interface PreparedUpload {
  readonly asset: PreparedAsset;
  /** Object URL for the draft preview — the caller owns revoking it. */
  readonly previewUrl: string;
}

export type PrepareUploadResult =
  | {
      readonly ok: true;
      readonly upload: PreparedUpload;
    }
  | {
      readonly ok: false;
      readonly issue: UploadValidationIssue;
    };

/**
 * Validates a chosen image blob end-to-end: core prepare (size + magic +
 * SHA-256) → real browser decode → dimension budget. On success the blob
 * is canonicalized to its detected media type and a fresh object URL is
 * created for the preview.
 */
export async function prepareUploadedImage(blob: Blob): Promise<PrepareUploadResult> {
  const prepared = await prepareAssetBlob(blob);
  if (!prepared.ok) {
    return { ok: false, issue: prepared.reason };
  }

  let width = 0;
  let height = 0;
  try {
    const bitmap = await createImageBitmap(prepared.asset.blob);
    width = bitmap.width;
    height = bitmap.height;
    bitmap.close();
  } catch {
    return { ok: false, issue: "decode-failed" };
  }
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION
  ) {
    return { ok: false, issue: "dimensions-too-large" };
  }

  return {
    ok: true,
    upload: {
      asset: prepared.asset,
      previewUrl: URL.createObjectURL(prepared.asset.blob),
    },
  };
}

/**
 * Picks the first IMAGE file from a FileList / DataTransfer listing.
 * Non-image entries are skipped, never auto-downloaded, never read.
 */
export function firstImageFile(files: Iterable<File>): File | undefined {
  for (const file of files) {
    if (file.type.startsWith("image/")) {
      return file;
    }
  }
  return undefined;
}

/**
 * The first image file/blob from a clipboard DataTransfer, or undefined.
 * Text URLs are deliberately ignored — no automatic downloads.
 */
export function firstClipboardImage(dataTransfer: DataTransfer): File | Blob | undefined {
  for (const item of dataTransfer.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file !== null) {
        return file;
      }
    }
  }
  return undefined;
}
