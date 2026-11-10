/**
 * Recipe (.deck.json) embedded wallpaper binaries — the D1 import side.
 *
 * The domain's `migrateRecipe` checks the `assets` map's SYNTAX only (slice
 * A); this module owns everything that needs the actual bytes: chunked
 * base64 decoding, the 4 MiB decoded budget, magic bytes agreeing with the
 * declared media type, the SHA-256 identity against the content id, and a
 * real image decode with the wallpaper dimension budgets. Every rule is a
 * REJECTION — one bad asset refuses the whole file, exactly like the
 * syntax rules upstream.
 *
 * The heavy steps stay off the critical rendering path as much as the
 * platform allows: base64 is decoded in chunks that yield to the event
 * loop between slices, hashing rides the async Web Crypto API
 * (`crypto.subtle`), and the dimension probe uses `createImageBitmap` (a
 * real, off-main-thread browser decode — the same gate wallpaper uploads
 * pass). The staging/probing/fetching helpers in recipe-asset-runtime land verified
 * bytes in the EXISTING asset runtime (IndexedDB store + upload outbox) —
 * never a parallel storage path.
 *
 * Nothing here runs at module import time; every entry point is async and
 * defensive: an unavailable asset runtime reports as "not available"
 * instead of throwing into the import flow.
 */

import { createContentAssetId, detectUploadedImageMediaType, MAX_ASSET_BYTES } from "@veladesk/assets/core";
import type { RecipeAssetMediaType, RecipeAssetV1 } from "@veladesk/domain";

import { WALLPAPER_MAX_AREA, WALLPAPER_MAX_DIMENSION } from "../home/wallpaper-prep";

import { recipeSectionOf } from "./apply-import";
import type { ImportIssue } from "./contract";
import type { ImportPlan, ImportSectionPlan } from "./planner";
import type { RecipeImportExtras, RecipeSpacePreview } from "./recipe-adapter";

// --- decode + verify (no persistence) ------------------------------------------

/** Why one embedded asset was refused. The first rejection refuses the file. */
export type RecipeAssetRejectionReason =
  | "invalid-base64"
  | "asset-too-large"
  | "unsupported-image-type"
  | "media-type-mismatch"
  | "asset-id-mismatch"
  | "decode-failed"
  | "dimensions-too-large";

/** A verified embedded asset, ready to stage through the asset runtime. */
export interface DecodedRecipeAsset {
  readonly id: string;
  /** Canonical blob carrying the DETECTED (magic-byte) media type. */
  readonly blob: Blob;
  readonly mediaType: RecipeAssetMediaType;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
}

export interface DecodeRecipeAssetsOptions {
  /**
   * Decodes a blob to its pixel dimensions. Defaults to the real browser
   * gate (`createImageBitmap`); tests inject a deterministic fake.
   */
  readonly decodeDimensions?: (blob: Blob) => Promise<{ readonly width: number; readonly height: number }>;
  /** Base64 slice size in characters (a multiple of 4); default 64 KiB. */
  readonly base64ChunkChars?: number;
  /** Called between slices; default yields to the event loop. */
  readonly yieldControl?: () => Promise<void>;
}

export type DecodeRecipeAssetsResult =
  | { readonly ok: true; readonly assets: readonly DecodedRecipeAsset[] }
  | { readonly ok: false; readonly issue: { readonly path: string; readonly reason: RecipeAssetRejectionReason } };

const DEFAULT_BASE64_CHUNK_CHARS = 1 << 16;

async function yieldToEventLoop(): Promise<void> {
  // `scheduler.yield()` (Chromium) returns to the caller promptly without
  // the ~1 ms setTimeout floor; everywhere else the timer macrotask is the
  // portable yield.
  const scheduler = (globalThis as { readonly scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === "function") {
    await scheduler.yield();
    return;
  }
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** The decoded byte count implied by a padded base64 string's length. */
function decodedByteLengthOf(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor(data.length / 4) * 3 - padding;
}

/**
 * Chunked base64 → bytes. Slices are quad-aligned so no boundary splits a
 * group and padding stays inside the final slice; `atob` remains the
 * per-slice decoder (it throws on anything the domain syntax check
 * already rejects — the catch maps that to `invalid-base64`).
 */
async function decodeBase64(
  data: string,
  chunkChars: number,
  yieldControl: () => Promise<void>
): Promise<Uint8Array> {
  const bytes = new Uint8Array(decodedByteLengthOf(data));
  let offset = 0;
  for (let start = 0; start < data.length; start += chunkChars) {
    const slice = data.slice(start, Math.min(start + chunkChars, data.length));
    const binary = atob(slice);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[offset + index] = binary.charCodeAt(index);
    }
    offset += binary.length;
    await yieldControl();
  }
  if (offset !== bytes.byteLength) {
    throw new Error("base64 length mismatch");
  }
  return bytes;
}

/** The real browser dimension gate; a decode the browser cannot do refuses the asset. */
async function browserBitmapDimensions(blob: Blob): Promise<{ readonly width: number; readonly height: number }> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("createImageBitmap unavailable");
  }
  const bitmap = await createImageBitmap(blob);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/**
 * Verifies and decodes the recipe's optional `assets` map (already
 * syntax-checked by the domain): budget → decode → magic bytes vs the
 * declared media type → SHA-256 vs the id → real decode with the
 * wallpaper dimension budgets. First rejection wins; entries are walked
 * in document order so a rejection is deterministic.
 */
export async function decodeRecipeAssets(
  assets: Readonly<Record<string, RecipeAssetV1>>,
  options: DecodeRecipeAssetsOptions = {}
): Promise<DecodeRecipeAssetsResult> {
  const decodeDimensions = options.decodeDimensions ?? browserBitmapDimensions;
  const chunkChars = options.base64ChunkChars ?? DEFAULT_BASE64_CHUNK_CHARS;
  const yieldControl = options.yieldControl ?? yieldToEventLoop;
  const reject = (id: string, suffix: string, reason: RecipeAssetRejectionReason): DecodeRecipeAssetsResult => ({
    ok: false,
    issue: { path: `assets.${id}${suffix}`, reason },
  });

  const decoded: DecodedRecipeAsset[] = [];
  for (const id of Object.keys(assets)) {
    const entry: RecipeAssetV1 | undefined = assets[id];
    if (entry === undefined) {
      // Unreachable after the domain's record check; kept total for direct calls.
      return reject(id, ".data", "invalid-base64");
    }
    // The decoded budget is implied by the base64 length, so oversize is
    // refused BEFORE any decoding work.
    const byteLength = decodedByteLengthOf(entry.data);
    if (byteLength <= 0 || byteLength > MAX_ASSET_BYTES) {
      return reject(id, ".data", "asset-too-large");
    }
    let bytes: Uint8Array;
    try {
      bytes = await decodeBase64(entry.data, chunkChars, yieldControl);
    } catch {
      return reject(id, ".data", "invalid-base64");
    }
    const detected = detectUploadedImageMediaType(bytes);
    if (detected === undefined) {
      return reject(id, ".data", "unsupported-image-type");
    }
    if (detected !== entry.mediaType) {
      return reject(id, ".mediaType", "media-type-mismatch");
    }
    if ((await createContentAssetId(bytes)) !== id) {
      return reject(id, "", "asset-id-mismatch");
    }
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: detected });
    let dimensions: { readonly width: number; readonly height: number };
    try {
      dimensions = await decodeDimensions(blob);
    } catch {
      return reject(id, ".data", "decode-failed");
    }
    const { width, height } = dimensions;
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > WALLPAPER_MAX_DIMENSION ||
      height > WALLPAPER_MAX_DIMENSION ||
      width * height > WALLPAPER_MAX_AREA
    ) {
      return reject(id, ".data", "dimensions-too-large");
    }
    decoded.push({ id, blob, mediaType: detected, byteLength, width, height });
  }
  return { ok: true, assets: decoded };
}

/** The decode rejection as a parser-shaped error issue (the dialog renders it). */
export function recipeAssetDecodeIssue(issue: {
  readonly path: string;
  readonly reason: RecipeAssetRejectionReason;
}): ImportIssue {
  return { severity: "error", code: "RECIPE_ASSET_INVALID", path: issue.path, value: issue.reason };
}

// --- asset references (pure) ----------------------------------------------------

/** Every asset id the recipe's wallpaper refs point at, deduplicated, document order. */
export function collectRecipeAssetRefs(
  extras: { readonly spaces: readonly { readonly wallpaper?: RecipeImportExtras["spaces"][number]["wallpaper"] }[]; readonly theme?: RecipeImportExtras["theme"] }
): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const add = (ref: string | undefined): void => {
    if (ref === undefined || !ref.startsWith("asset:")) {
      return;
    }
    const id = ref.slice("asset:".length);
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  };
  for (const space of extras.spaces) {
    for (const mode of ["light", "dark"] as const) {
      add(space.wallpaper?.[mode]);
    }
  }
  for (const mode of ["light", "dark"] as const) {
    add(extras.theme?.wallpaper?.[mode]);
  }
  return ordered;
}

/** The referenced ids the file did NOT embed (cloud fetch candidates). */
export function missingRecipeAssetIds(
  extras: Pick<RecipeImportExtras, "spaces" | "theme">,
  embeddedIds: ReadonlySet<string>
): readonly string[] {
  return collectRecipeAssetRefs(extras).filter((id) => !embeddedIds.has(id));
}

/**
 * The asset id the theme's ONE workspace-default wallpaper resolves to —
 * the exact pick `applyImportPlan` persists (`dark` takes the dark ref,
 * anything else the light one, each falling back to the other mode).
 */
export function recipeThemeWallpaperAssetId(
  theme: RecipeImportExtras["theme"]
): string | undefined {
  if (theme === undefined) {
    return undefined;
  }
  const refs = theme.wallpaper;
  if (refs === undefined) {
    return undefined;
  }
  const ref = theme.mode === "dark" ? refs.dark ?? refs.light : refs.light ?? refs.dark;
  return ref !== undefined && ref.startsWith("asset:") ? ref.slice("asset:".length) : undefined;
}

/** One "this wallpaper needs attention" row: a created space's mode, or the theme default. */
export type RecipeAssetNotice =
  | { readonly spaceName: string; readonly mode: "light" | "dark" }
  | { readonly theme: true };

function createdSectionsOf(plan: ImportPlan): readonly ImportSectionPlan[] {
  return plan.sections.filter((section) => section.action === "create");
}

/**
 * The wallpaper list the PREVIEW marks as "needs cloud fetch": every
 * created space's mode whose asset ref is neither embedded in the file nor
 * present on this device, plus the theme default when it applies
 * (merged spaces never touch wallpapers, so they never list).
 */
export function recipeAssetCloudNotices(
  plan: ImportPlan,
  extras: RecipeImportExtras,
  previews: ReadonlyMap<string, RecipeSpacePreview>,
  status: { readonly embedded?: ReadonlySet<string>; readonly device?: ReadonlySet<string> },
  includeTheme: boolean
): readonly RecipeAssetNotice[] {
  const notices: RecipeAssetNotice[] = [];
  for (const section of createdSectionsOf(plan)) {
    const preview = previews.get(section.nameKey);
    for (const mode of ["light", "dark"] as const) {
      const wallpaper = preview?.[mode];
      if (wallpaper?.kind === "asset" && wallpaper.source === "cloud") {
        notices.push({ spaceName: section.displayName, mode });
      }
    }
  }
  if (includeTheme) {
    const themeId = recipeThemeWallpaperAssetId(extras.theme);
    const source =
      themeId === undefined
        ? undefined
        : status.embedded?.has(themeId)
          ? "embedded"
          : status.device?.has(themeId)
            ? "device"
            : "cloud";
    if (source === "cloud") {
      notices.push({ theme: true });
    }
  }
  return notices;
}

/**
 * The wallpaper list the DONE surface reports as fallen back: every created
 * space's mode (and the theme default, when applied) whose asset ref was
 * neither embedded nor resolvable at confirm time — `applyImportPlan`
 * persisted the default preset for exactly these.
 */
export function recipeAssetFallbackNotices(
  plan: ImportPlan,
  extras: RecipeImportExtras,
  unavailable: ReadonlySet<string>,
  includeTheme: boolean
): readonly RecipeAssetNotice[] {
  const notices: RecipeAssetNotice[] = [];
  for (const section of createdSectionsOf(plan)) {
    const space = alignedSpaceOf(plan, extras, section);
    for (const mode of ["light", "dark"] as const) {
      const ref = space?.wallpaper?.[mode];
      if (ref !== undefined && ref.startsWith("asset:") && unavailable.has(ref.slice("asset:".length))) {
        notices.push({ spaceName: section.displayName, mode });
      }
    }
  }
  if (includeTheme) {
    const themeId = recipeThemeWallpaperAssetId(extras.theme);
    if (themeId !== undefined && unavailable.has(themeId)) {
      notices.push({ theme: true });
    }
  }
  return notices;
}

/**
 * A created plan section's recipe space — `applyImportPlan`'s own alignment
 * fold (first document section with the plan section's name key), so the
 * notice lists name exactly the wallpapers that landed.
 */
function alignedSpaceOf(
  plan: ImportPlan,
  extras: RecipeImportExtras,
  section: ImportSectionPlan
): RecipeImportExtras["spaces"][number] | undefined {
  return recipeSectionOf(plan, extras, section)?.space;
}
