/**
 * Recipe (.deck.json) adoption at the import boundary (P1).
 *
 * A `vela.recipe` document handed to the Import JSON flow is migrated up
 * through the domain's pure `migrateRecipe`, distilled via `importRecipe`,
 * and re-entered as an ordinary Import JSON v1 document — so the whole
 * existing parse → plan → preview → confirm pipeline (limits, URL rules,
 * duplicate detection, one-revision write) applies unchanged. The recipe's
 * STRUCTURE (per-space layout mode, grid, tile geometry, wallpapers) plus
 * theme, motion and the optional embedded-asset map ride alongside as
 * `extras` — positionally aligned with the adopted document (space i ↔
 * section i, tile j ↔ app j) — for `applyImportPlan`'s recipe option.
 *
 * The theme is sanitized PER FIELD (D1): a color mode/accent/material the
 * Settings write path would refuse is dropped individually with a warning
 * — the legal fields (including a legal wallpaper) still apply; the deck
 * is never rejected over them, and applying stays opt-in.
 *
 * Legacy `veladesk-import` documents keep their own direct path — the
 * domain function migrates them too, but the parser only routes documents
 * that declare the recipe format.
 */

import { importRecipe, migrateRecipe, RECIPE_FORMAT_IDENTITY } from "@veladesk/domain";
import type {
  RecipeAssetV1,
  RecipeGridV1,
  RecipeImportSpace,
  RecipeLayoutMode,
  RecipeMotionV1,
  RecipeThemeV1,
  RecipeV1,
  RecipeWallpaperV1,
  WorkspaceColorMode,
  WorkspaceInterfaceStyle,
  WorkspaceWallpaperPreset,
} from "@veladesk/domain";
import { INTERFACE_STYLES } from "@veladesk/domain";

import type { ImportIssue, VelaDeskImportDocumentV1 } from "./contract";
import { IMPORT_FORMAT_IDENTITY, IMPORT_FORMAT_VERSION } from "./contract";
import { normalizeImportNameKey } from "./normalization";

/**
 * The recipe structure beyond sections/apps. `spaces[i]` describes the
 * adopted document's `sections[i]` and `spaces[i].tiles[j]` its
 * `apps[j]` — the parser keeps both 1:1 on success. `assets` rides along
 * verbatim (base64 payloads; binary verification is recipe-assets' job).
 */
export interface RecipeImportExtras {
  readonly spaces: readonly RecipeImportSpace[];
  readonly theme: RecipeAppliedTheme | undefined;
  readonly motion: RecipeMotionV1 | undefined;
  readonly assets: Readonly<Record<string, RecipeAssetV1>> | undefined;
}

export type AdoptRecipeResult =
  | { readonly kind: "not-a-recipe" }
  | {
      readonly kind: "adopted";
      readonly document: VelaDeskImportDocumentV1;
      readonly notices: readonly ImportIssue[];
      readonly extras: RecipeImportExtras;
    }
  | { readonly kind: "rejected"; readonly issues: readonly ImportIssue[] };

/** True when a parsed JSON root declares the recipe format. */
export function isRecipeDocument(root: unknown): root is Record<string, unknown> {
  return (
    typeof root === "object" &&
    root !== null &&
    !Array.isArray(root) &&
    (root as Record<string, unknown>).format === RECIPE_FORMAT_IDENTITY
  );
}

/**
 * Migrates + distills a recipe-shaped root into the Import JSON v1 shape.
 * Pure; returns `not-a-recipe` for anything the parser should handle
 * itself and structured issues for everything it must surface instead.
 */
export function adoptRecipeDocument(root: Record<string, unknown>): AdoptRecipeResult {
  const migrated = migrateRecipe(root);
  if (!migrated.ok) {
    const issues: ImportIssue[] =
      migrated.issue.type === "unsupported-version"
        ? [{ severity: "error", code: "UNSUPPORTED_VERSION", path: "version", value: migrated.issue.version }]
        : migrated.issue.type === "invalid-recipe"
          ? [{ severity: "error", code: "INVALID_FORMAT", path: migrated.issue.path }]
          : [{ severity: "error", code: "INVALID_FORMAT", path: "format" }];
    return { kind: "rejected", issues };
  }

  const payload = importRecipe(migrated.recipe satisfies RecipeV1);
  // Theme sanitize is per field (D1): illegal values drop individually with
  // a warning each — the legal remainder stays importable and applying a
  // theme is opt-in anyway (recipe B review: never fail the import over it).
  const { theme, ignoredFields } = sanitizeRecipeTheme(payload.theme);
  const notices: ImportIssue[] = [{ severity: "warning", code: "RECIPE_MIGRATED", path: "format" }];
  for (const field of ignoredFields) {
    notices.push({ severity: "warning", code: "RECIPE_THEME_FIELD_IGNORED", path: `theme.${field}` });
  }
  const document: VelaDeskImportDocumentV1 = {
    format: IMPORT_FORMAT_IDENTITY,
    version: IMPORT_FORMAT_VERSION,
    sections: payload.sections.map((section) => ({
      name: section.name,
      apps: section.apps.map((app) => ({ name: app.name, url: app.url })),
    })),
  };
  return {
    kind: "adopted",
    document,
    notices,
    extras: {
      spaces: payload.spaces,
      theme,
      motion: payload.motion,
      assets: payload.assets,
    },
  };
}

// --- theme sanitize (per field) --------------------------------------------------

const COLOR_MODES: readonly WorkspaceColorMode[] = ["system", "dark", "light"];

/**
 * A theme reduced to the fields that would survive the Settings write
 * path: color mode, an integer OKLCH accent hue in 0–359, a material tier
 * (the same rules `validateWorkspaceAppearance` enforces; the wallpaper
 * refs are already strictly validated by `migrateRecipe`).
 */
export interface RecipeAppliedTheme {
  readonly mode?: WorkspaceColorMode;
  readonly accent?: number;
  readonly material?: WorkspaceInterfaceStyle;
  readonly wallpaper?: RecipeWallpaperV1;
}

export function isRecipeColorMode(value: unknown): value is WorkspaceColorMode {
  return COLOR_MODES.includes(value as WorkspaceColorMode);
}

export function isRecipeAccentHue(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 359;
}

export function isRecipeMaterial(value: unknown): value is WorkspaceInterfaceStyle {
  return INTERFACE_STYLES.includes(value as WorkspaceInterfaceStyle);
}

/**
 * Drops every theme field the write path would refuse, keeping the rest
 * (a legal wallpaper survives an illegal accent). Returns the applied
 * theme — undefined when nothing legal remains — and the dropped fields'
 * names, each carrying a `theme.<field>` warning at the call site.
 */
export function sanitizeRecipeTheme(
  theme: RecipeThemeV1 | undefined
): { readonly theme: RecipeAppliedTheme | undefined; readonly ignoredFields: readonly string[] } {
  if (theme === undefined) {
    return { theme: undefined, ignoredFields: [] };
  }
  if (theme === null || typeof theme !== "object" || Array.isArray(theme)) {
    return { theme: undefined, ignoredFields: ["mode", "accent", "material"] };
  }
  const applied: RecipeAppliedTheme = {
    ...(isRecipeColorMode(theme.mode) ? { mode: theme.mode } : {}),
    ...(isRecipeAccentHue(theme.accent) ? { accent: theme.accent } : {}),
    ...(isRecipeMaterial(theme.material) ? { material: theme.material } : {}),
    ...(theme.wallpaper !== undefined ? { wallpaper: theme.wallpaper } : {}),
  };
  const ignoredFields = [
    ...(applied.mode === undefined ? ["mode"] : []),
    ...(applied.accent === undefined ? ["accent"] : []),
    ...(applied.material === undefined ? ["material"] : []),
  ];
  return {
    theme: Object.keys(applied).length > 0 ? applied : undefined,
    ignoredFields,
  };
}

// --- preview summary -----------------------------------------------------------

/** Where an asset-backed wallpaper's bytes come from, for the preview rows. */
export type RecipeAssetPreviewSource = "embedded" | "device" | "cloud";

/**
 * How a wallpaper reference renders in the preview: a preset, or a custom
 * image with its binary's availability (`embedded` in the file, already on
 * this `device`, or `cloud`-only — imported via a fetch at confirm time).
 */
export type RecipeWallpaperPreview =
  | { readonly kind: "preset"; readonly presetId: WorkspaceWallpaperPreset }
  | { readonly kind: "asset"; readonly id: string; readonly source: RecipeAssetPreviewSource };

/** Embedded/device availability sets the dialog resolves before previewing. */
export interface RecipeAssetPreviewStatus {
  readonly embedded?: ReadonlySet<string>;
  readonly device?: ReadonlySet<string>;
}

/** One folded plan section's recipe structure, for the preview rows. */
export interface RecipeSpacePreview {
  readonly layoutMode: RecipeLayoutMode;
  readonly grid: RecipeGridV1 | undefined;
  /** Every tile of the space(s) with this name key, document order. */
  readonly tileCount: number;
  readonly light: RecipeWallpaperPreview | undefined;
  readonly dark: RecipeWallpaperPreview | undefined;
}

function wallpaperPreviewOf(
  ref: string | undefined,
  status: RecipeAssetPreviewStatus
): RecipeWallpaperPreview | undefined {
  if (ref === undefined) {
    return undefined;
  }
  if (ref.startsWith("preset:")) {
    return { kind: "preset", presetId: ref.slice("preset:".length) as WorkspaceWallpaperPreset };
  }
  const id = ref.slice("asset:".length);
  return {
    kind: "asset",
    id,
    source: status.embedded?.has(id) ? "embedded" : status.device?.has(id) ? "device" : "cloud",
  };
}

/**
 * Folds the recipe spaces exactly the way the planner folds the document
 * sections (name key; the FIRST space supplies the space-level fields, the
 * tiles concatenate in document order) — so each preview row shows the
 * structure its plan section would restore. Sections without a recipe
 * space (never expected) simply have no entry.
 */
export function recipeSpacePreviews(
  document: VelaDeskImportDocumentV1,
  recipe: RecipeImportExtras,
  status: RecipeAssetPreviewStatus = {}
): ReadonlyMap<string, RecipeSpacePreview> {
  const previews = new Map<string, RecipeSpacePreview>();
  document.sections.forEach((section, index) => {
    const space = recipe.spaces[index];
    if (space === undefined) {
      return;
    }
    const key = normalizeImportNameKey(section.name);
    const existing = previews.get(key);
    if (existing === undefined) {
      previews.set(key, {
        layoutMode: space.layoutMode,
        grid: space.grid,
        tileCount: space.tiles.length,
        light: wallpaperPreviewOf(space.wallpaper?.light, status),
        dark: wallpaperPreviewOf(space.wallpaper?.dark, status),
      });
      return;
    }
    previews.set(key, { ...existing, tileCount: existing.tileCount + space.tiles.length });
  });
  return previews;
}
