import { prepareAssetBlob } from "@veladesk/assets/core";
import type { PreparedAsset } from "@veladesk/assets/core";
import { WallpaperFit } from "@veladesk/domain";
import type { WallpaperConfig } from "@veladesk/domain";

/**
 * Wallpaper upload preparation policy (task 023-C.3) — a SEPARATE policy
 * from app icons; icon limits are untouched.
 *
 * Wallpaper policy targets: PNG/JPEG/WebP/AVIF still images (AVIF rides
 * the same core magic-byte detection AND the real createImageBitmap decode
 * gate here — anything the browser cannot genuinely decode is refused), at most 15 MiB
 * selected, at most 8192 px per side, at most 40 MP decoded area. THE
 * SHARED CORE PIPELINE'S STRICTER LIMITS TAKE PRECEDENCE AND ARE THE
 * EFFECTIVE CAP: `prepareAssetBlob` enforces MAX_ASSET_BYTES (4 MiB) and
 * real magic-byte content detection before any decode — a wallpaper larger
 * than that is refused with asset-too-large, exactly like every other
 * upload. SVG and GIF are not accepted (no vector/animated media), and a
 * real decode must succeed (corrupted or unsupported containers fail).
 *
 * Selection creates ONLY a candidate + object URL for preview; nothing is
 * staged and no workspace is modified until Save.
 */

/** Policy targets (the core 4 MiB byte budget still wins first). */
export const WALLPAPER_MAX_BYTES = 15 * 1024 * 1024;
export const WALLPAPER_MAX_DIMENSION = 8192;
export const WALLPAPER_MAX_AREA = 40_000_000;

export type WallpaperPrepIssue =
  | "asset-empty"
  | "asset-too-large"
  | "unsupported-image-type"
  | "decode-failed"
  | "dimensions-too-large";

export interface PreparedWallpaperImage {
  /** The validated candidate blob (unstaged until Save). */
  readonly asset: PreparedAsset;
  /** Object URL for previews; the caller owns revoking it. */
  readonly previewUrl: string;
  readonly width: number;
  readonly height: number;
}

export type PrepareWallpaperResult =
  | { readonly ok: true; readonly image: PreparedWallpaperImage }
  | { readonly ok: false; readonly issue: WallpaperPrepIssue };

/**
 * Validates a chosen wallpaper file end-to-end: core prepare (size +
 * magic bytes + SHA-256) → real browser decode → wallpaper dimension and
 * area budgets. Aspect ratio is preserved (fit is a rendering concern);
 * orientation is honored by the decoder.
 */
export async function prepareWallpaperImage(blob: Blob): Promise<PrepareWallpaperResult> {
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
  if (width < 1 || height < 1) {
    return { ok: false, issue: "decode-failed" };
  }
  if (width > WALLPAPER_MAX_DIMENSION || height > WALLPAPER_MAX_DIMENSION) {
    return { ok: false, issue: "dimensions-too-large" };
  }
  if (width * height > WALLPAPER_MAX_AREA) {
    return { ok: false, issue: "dimensions-too-large" };
  }

  return {
    ok: true,
    image: {
      asset: prepared.asset,
      previewUrl: URL.createObjectURL(prepared.asset.blob),
      width,
      height,
    },
  };
}

/** The wallpaper config a prepared image becomes once staged. */
export function wallpaperConfigForImage(
  assetId: string,
  fit: WallpaperFit = "cover",
): WallpaperConfig {
  return { kind: "asset", assetId, fit, position: "center" };
}
