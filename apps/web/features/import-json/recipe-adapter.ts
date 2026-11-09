/**
 * Recipe (.deck.json) adoption at the import boundary (P1).
 *
 * A `vela.recipe` document handed to the Import JSON flow is migrated up
 * through the domain's pure `migrateRecipe`, distilled via `importRecipe`,
 * and re-entered as an ordinary Import JSON v1 document — so the whole
 * existing parse → plan → preview → confirm pipeline (limits, URL rules,
 * duplicate detection, one-revision write) applies unchanged. The recipe's
 * STRUCTURE (per-space layout mode, grid, tile geometry, wallpapers) plus
 * theme and motion ride alongside as `extras` — positionally aligned with
 * the adopted document (space i ↔ section i, tile j ↔ app j) — for
 * `applyImportPlan`'s recipe option.
 *
 * Legacy `veladesk-import` documents keep their own direct path — the
 * domain function migrates them too, but the parser only routes documents
 * that declare the recipe format.
 */

import { importRecipe, migrateRecipe, RECIPE_FORMAT_IDENTITY } from "@veladesk/domain";
import type {
  RecipeGridV1,
  RecipeImportSpace,
  RecipeLayoutMode,
  RecipeMotionV1,
  RecipeThemeV1,
  RecipeV1,
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
 * `apps[j]` — the parser keeps both 1:1 on success.
 */
export interface RecipeImportExtras {
  readonly spaces: readonly RecipeImportSpace[];
  readonly theme: RecipeThemeV1 | undefined;
  readonly motion: RecipeMotionV1 | undefined;
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
  // A theme with illegal values is IGNORED with a warning, not an error:
  // the structure (spaces/tiles) stays importable and applying a theme is
  // opt-in anyway (recipe B review: never fail the import over it).
  const theme = payload.theme;
  const legalTheme = theme !== undefined && isLegalRecipeTheme(theme);
  const notices: ImportIssue[] = [{ severity: "warning", code: "RECIPE_MIGRATED", path: "format" }];
  if (theme !== undefined && !legalTheme) {
    notices.push({ severity: "warning", code: "RECIPE_THEME_IGNORED", path: "theme" });
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
      theme: legalTheme ? theme : undefined,
      motion: payload.motion,
    },
  };
}

const COLOR_MODES: readonly WorkspaceColorMode[] = ["system", "dark", "light"];

/**
 * Whether a recipe theme's values would survive the Settings write path:
 * color mode, material tier and an integer OKLCH accent hue in 0–359
 * (the same rule `validateWorkspaceAppearance` enforces). The theme's
 * wallpaper refs are already strictly validated by `migrateRecipe`.
 */
export function isLegalRecipeTheme(theme: RecipeThemeV1): boolean {
  return (
    COLOR_MODES.includes(theme.mode) &&
    INTERFACE_STYLES.includes(theme.material as WorkspaceInterfaceStyle) &&
    typeof theme.accent === "number" &&
    Number.isInteger(theme.accent) &&
    theme.accent >= 0 &&
    theme.accent <= 359
  );
}

// --- preview summary -----------------------------------------------------------

/** How a wallpaper reference renders in the preview: preset or custom image. */
export type RecipeWallpaperPreview =
  | { readonly kind: "preset"; readonly presetId: WorkspaceWallpaperPreset }
  | { readonly kind: "asset" };

/** One folded plan section's recipe structure, for the preview rows. */
export interface RecipeSpacePreview {
  readonly layoutMode: RecipeLayoutMode;
  readonly grid: RecipeGridV1 | undefined;
  /** Every tile of the space(s) with this name key, document order. */
  readonly tileCount: number;
  readonly light: RecipeWallpaperPreview | undefined;
  readonly dark: RecipeWallpaperPreview | undefined;
}

function wallpaperPreviewOf(ref: string | undefined): RecipeWallpaperPreview | undefined {
  if (ref === undefined) {
    return undefined;
  }
  return ref.startsWith("preset:")
    ? { kind: "preset", presetId: ref.slice("preset:".length) as WorkspaceWallpaperPreset }
    : { kind: "asset" };
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
  recipe: RecipeImportExtras
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
        light: wallpaperPreviewOf(space.wallpaper?.light),
        dark: wallpaperPreviewOf(space.wallpaper?.dark),
      });
      return;
    }
    previews.set(key, { ...existing, tileCount: existing.tileCount + space.tiles.length });
  });
  return previews;
}
