import { inferInterfaceStyle, resolveWorkspaceAppearance } from "../appearance";
import { pageItemIds } from "../canvas";
import type { AppIcon, WorkspaceSnapshot } from "../types";
import type {
  RecipeImportPayload,
  RecipeSpaceLayout,
  RecipeSpaceV1,
  RecipeTileV1,
  RecipeThemeV1,
  RecipeV1,
} from "./types";
import {
  RECIPE_FORMAT_IDENTITY,
  RECIPE_VERSION,
} from "./types";

/**
 * RecipeV1 pure operations (P1: structure only — no share links, no
 * derivation). Everything here is total and side-effect free: the caller
 * owns clocks (`createdAt` is passed in) and persistence.
 */

// --- exportRecipe -----------------------------------------------------------

/** Everything `exportRecipe` needs from the caller (kept explicit + pure). */
export interface ExportRecipeOptions {
  /** ISO timestamp of the export; the caller owns the clock. */
  readonly createdAt: string;
  /** The exporting app version, recorded as `app.minVersion`. */
  readonly appMinVersion?: string;
}

/** The public Iconify key of an icon, or undefined when not exportable. */
function publicIconOf(icon: AppIcon): string | undefined {
  return icon.kind === "iconify" ? icon.icon : undefined;
}

/** `preset:<id>` / `asset:<assetId>` — a reference, never a payload. */
function wallpaperRefOf(wallpaper: WorkspaceSnapshot["pages"][number]["wallpaper"]): string | undefined {
  if (wallpaper === undefined) {
    return undefined;
  }
  return wallpaper.kind === "preset"
    ? `preset:${wallpaper.presetId}`
    : `asset:${wallpaper.assetId}`;
}

/**
 * Projects a workspace snapshot into a public RecipeV1. Only page-placed
 * APP shortcuts become tiles: folder contents and widgets have no recipe
 * shape in v1 (a documented gap, not silent loss — see the recipe report).
 * Pure: same input, equal fresh output, no mutation.
 */
export function exportRecipe(
  workspace: WorkspaceSnapshot,
  options: ExportRecipeOptions
): RecipeV1 {
  const appearance = resolveWorkspaceAppearance(workspace.preferences);
  const theme: RecipeThemeV1 = {
    mode: appearance.colorMode,
    accent: appearance.accentHue,
    material: appearance.interfaceStyle ?? inferInterfaceStyle(appearance),
  };

  const entityById = new Map(workspace.entities.map((entity) => [entity.id, entity]));
  const spaces: RecipeSpaceV1[] = workspace.pages.map((page) => {
    const tiles: RecipeTileV1[] = [];
    for (const id of pageItemIds(page)) {
      const entity = entityById.get(id);
      if (entity?.kind !== "app") {
        continue;
      }
      const icon = publicIconOf(entity.icon);
      tiles.push({
        id: entity.id,
        name: entity.name,
        url: entity.url,
        ...(icon !== undefined ? { icon } : {}),
        openMode: entity.openMode,
      });
    }
    const wallpaperRef = wallpaperRefOf(page.wallpaper);
    return {
      id: page.id,
      name: page.name,
      layout: page.canvas?.mode === "freeform" ? "canvas" : "grid",
      ...(wallpaperRef !== undefined ? { wallpaperRef } : {}),
      tiles,
    };
  });

  return {
    format: RECIPE_FORMAT_IDENTITY,
    version: RECIPE_VERSION,
    createdAt: options.createdAt,
    ...(options.appMinVersion !== undefined
      ? { app: { minVersion: options.appMinVersion } }
      : {}),
    theme,
    ...(workspace.preferences.motion !== undefined
      ? { motion: workspace.preferences.motion }
      : {}),
    spaces,
    plugins: [],
  };
}

// --- importRecipe -----------------------------------------------------------

/**
 * Distills an (already migrated + validated) recipe into the public import
 * payload: sections/apps for the import pipeline, plus theme/motion for
 * callers that apply them. Pure projection — validation is `migrateRecipe`'s
 * job, applying is the caller's.
 */
export function importRecipe(recipe: RecipeV1): RecipeImportPayload {
  return {
    theme: recipe.theme,
    motion: recipe.motion,
    sections: recipe.spaces.map((space) => ({
      name: space.name,
      apps: space.tiles.map((tile) => ({ name: tile.name, url: tile.url })),
    })),
  };
}

// --- migrateRecipe ----------------------------------------------------------

/** Why a document could not be migrated up to the current recipe version. */
export type RecipeMigrationFailure =
  | { readonly type: "not-a-recipe" }
  | { readonly type: "unsupported-version"; readonly version: number }
  | { readonly type: "invalid-recipe"; readonly path: string };

export type MigrateRecipeResult =
  | {
      readonly ok: true;
      readonly recipe: RecipeV1;
      /** True when the input was a legacy import document upgraded in place. */
      readonly migratedFromLegacy: boolean;
    }
  | { readonly ok: false; readonly issue: RecipeMigrationFailure };

const SPACE_LAYOUTS: readonly string[] = ["grid", "canvas", "orbit"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

/** Structural walk of a `spaces` array; returns the first defect's path. */
function spacesIssue(spaces: unknown): string | null {
  if (!Array.isArray(spaces)) {
    return "spaces";
  }
  for (let i = 0; i < spaces.length; i += 1) {
    const space = spaces[i];
    const spacePath = `spaces[${i}]`;
    if (!isRecord(space)) {
      return spacePath;
    }
    if (typeof space.name !== "string") {
      return `${spacePath}.name`;
    }
    if (
      space.layout !== undefined &&
      !SPACE_LAYOUTS.includes(space.layout as string)
    ) {
      return `${spacePath}.layout`;
    }
    if (!optionalString(space.wallpaperRef)) {
      return `${spacePath}.wallpaperRef`;
    }
    if (!Array.isArray(space.tiles)) {
      return `${spacePath}.tiles`;
    }
    for (let j = 0; j < space.tiles.length; j += 1) {
      const tile = space.tiles[j];
      const tilePath = `${spacePath}.tiles[${j}]`;
      if (
        !isRecord(tile) ||
        typeof tile.name !== "string" ||
        typeof tile.url !== "string" ||
        !optionalString(tile.id) ||
        !optionalString(tile.icon) ||
        !optionalString(tile.openMode)
      ) {
        return tilePath;
      }
    }
  }
  return null;
}

/**
 * Migrates any recipe-shaped document up to the current RecipeV1.
 *
 *  - `vela.recipe` v1 passes through with unknown fields PRESERVED (a
 *    shallow copy; nested values keep their source references);
 *  - legacy `veladesk-import` v1 documents are upgraded in place
 *    (sections → spaces, apps → tiles; no theme/motion — they did not
 *    exist);
 *  - versions NEWER than `RECIPE_VERSION` are rejected outright — never
 *    best-effort parsed;
 *  - anything else is `not-a-recipe` (the caller keeps its own format
 *    error path).
 *
 * Pure: never throws, never mutates the input.
 */
export function migrateRecipe(input: unknown): MigrateRecipeResult {
  if (!isRecord(input)) {
    return { ok: false, issue: { type: "not-a-recipe" } };
  }

  if (input.format === RECIPE_FORMAT_IDENTITY) {
    if (typeof input.version !== "number" || !Number.isInteger(input.version)) {
      return { ok: false, issue: { type: "invalid-recipe", path: "version" } };
    }
    // Newer than known → hard reject, never best-effort. (v1 is the first
    // version, so any other integer is equally unsupported.)
    if (input.version !== RECIPE_VERSION) {
      return { ok: false, issue: { type: "unsupported-version", version: input.version } };
    }
    const spacesDefect = spacesIssue(input.spaces);
    if (spacesDefect !== null) {
      return { ok: false, issue: { type: "invalid-recipe", path: spacesDefect } };
    }
    // Shallow copy keeps every unknown field; known fields are already
    // valid, so the copy is a RecipeV1 without further normalization.
    return {
      ok: true,
      recipe: { ...input } as unknown as RecipeV1,
      migratedFromLegacy: false,
    };
  }

  if (input.format === "veladesk-import") {
    // Legacy Import JSON v1 (docs/architecture/import-json-v1.md): upgrade
    // in place. Version rules match the legacy parser exactly — anything
    // other than v1 is hard-rejected, never best-effort.
    if (typeof input.version !== "number" || !Number.isInteger(input.version)) {
      return { ok: false, issue: { type: "invalid-recipe", path: "version" } };
    }
    if (input.version !== 1) {
      return { ok: false, issue: { type: "unsupported-version", version: input.version } };
    }
    if (!Array.isArray(input.sections)) {
      return { ok: false, issue: { type: "invalid-recipe", path: "sections" } };
    }
    const spaces: RecipeSpaceV1[] = [];
    for (let i = 0; i < input.sections.length; i += 1) {
      const section = input.sections[i];
      const sectionPath = `sections[${i}]`;
      if (!isRecord(section) || typeof section.name !== "string" || !Array.isArray(section.apps)) {
        return { ok: false, issue: { type: "invalid-recipe", path: sectionPath } };
      }
      const tiles: RecipeTileV1[] = [];
      for (let j = 0; j < section.apps.length; j += 1) {
        const app = section.apps[j];
        if (
          !isRecord(app) ||
          typeof app.name !== "string" ||
          typeof app.url !== "string"
        ) {
          return { ok: false, issue: { type: "invalid-recipe", path: `${sectionPath}.apps[${j}]` } };
        }
        tiles.push({ name: app.name, url: app.url });
      }
      spaces.push({
        name: section.name,
        layout: "grid" satisfies RecipeSpaceLayout,
        tiles,
      });
    }
    return {
      ok: true,
      recipe: {
        format: RECIPE_FORMAT_IDENTITY,
        version: RECIPE_VERSION,
        spaces,
        plugins: [],
      },
      migratedFromLegacy: true,
    };
  }

  return { ok: false, issue: { type: "not-a-recipe" } };
}
