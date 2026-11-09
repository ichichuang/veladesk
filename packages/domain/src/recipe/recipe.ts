import { CANVAS_UNITS } from "@veladesk/canvas-engine";

import { inferInterfaceStyle, resolveWorkspaceAppearance } from "../appearance";
import { pageItemIds, resolvePagePlacement } from "../canvas";
import type { AppIcon, WorkspaceSnapshot } from "../types";
import type {
  RecipeImportPayload,
  RecipeLayoutMode,
  RecipeSpaceLayout,
  RecipeSpaceV1,
  RecipeTileV1,
  RecipeThemeV1,
  RecipeV1,
  RecipeWallpaperV1,
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

type PageOfSnapshot = WorkspaceSnapshot["pages"][number];

/**
 * A page's public wallpaper refs (P1): the mode-specific override first,
 * the mode-agnostic single upload as each mode's fallback — an early-v1
 * `wallpaperRef` (mode-agnostic) exports as both modes. All-absent = the
 * deck default; nothing rides along but references.
 */
function wallpaperOf(page: PageOfSnapshot): RecipeWallpaperV1 | undefined {
  const byMode = page.wallpaperByMode;
  const general = wallpaperRefOf(page.wallpaper);
  const light = byMode?.light !== undefined ? wallpaperRefOf(byMode.light) : undefined;
  const dark = byMode?.dark !== undefined ? wallpaperRefOf(byMode.dark) : undefined;
  const resolvedLight = light ?? general;
  const resolvedDark = dark ?? general;
  if (resolvedLight === undefined && resolvedDark === undefined) {
    return undefined;
  }
  return {
    ...(resolvedLight !== undefined ? { light: resolvedLight } : {}),
    ...(resolvedDark !== undefined ? { dark: resolvedDark } : {}),
  };
}

/** Relative 0–1 canvas fraction at the engine's 1-unit resolution. */
function canvasFraction(units: number): number {
  return Math.round((units / CANVAS_UNITS) * 10_000) / 10_000;
}

type PagePlacementOfPage = ReturnType<typeof resolvePagePlacement>;

/**
 * A tile's public geometry from the resolved page placement: snap tiles
 * carry integer cells, free tiles relative 0–1 fractions. Both omit the
 * fields entirely when they carry nothing beyond the placement default.
 */
function tileGeometryOf(
  placement: PagePlacementOfPage,
  itemId: string,
): Pick<RecipeTileV1, "placement" | "x" | "y" | "w" | "h"> {
  if (placement.mode === "grid") {
    const item = placement.items.find((candidate) => candidate.id === itemId);
    if (item === undefined) {
      return {};
    }
    return {
      placement: "snap",
      x: item.column,
      y: item.row,
      w: item.columnSpan,
      h: item.rowSpan,
    };
  }
  const item = placement.items.find((candidate) => candidate.id === itemId);
  if (item === undefined) {
    return {};
  }
  return {
    placement: "free",
    x: canvasFraction(item.rect.x),
    y: canvasFraction(item.rect.y),
    w: canvasFraction(item.rect.width),
    h: canvasFraction(item.rect.height),
  };
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
    const placement = resolvePagePlacement(page);
    const layoutMode: RecipeLayoutMode = placement.mode === "freeform" ? "free" : "snap";
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
        ...tileGeometryOf(placement, entity.id),
      });
    }
    const wallpaper = wallpaperOf(page);
    return {
      id: page.id,
      name: page.name,
      layout: layoutMode === "free" ? "canvas" : "grid",
      layoutMode,
      ...(wallpaper !== undefined ? { wallpaper } : {}),
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
const LAYOUT_MODES: readonly string[] = ["snap", "free"];
const TILE_PLACEMENTS: readonly string[] = ["snap", "free"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

/**
 * A tile's geometry fields against its declared placement: `snap` carries
 * safe-integer grid cells (origin ≥ 0, spans ≥ 1); `free` carries relative
 * 0–1 canvas fractions. Without a placement the fields (if any) only need
 * to be finite numbers — the importer owns the default geometry.
 */
function tileGeometryIssue(tile: Record<string, unknown>): string | null {
  const placement = tile.placement;
  if (placement !== undefined && !TILE_PLACEMENTS.includes(placement as string)) {
    return "placement";
  }
  for (const field of ["x", "y", "w", "h"] as const) {
    if (!optionalFiniteNumber(tile[field])) {
      return field;
    }
  }
  if (placement === undefined) {
    return null;
  }
  for (const field of ["x", "y", "w", "h"] as const) {
    const value: unknown = tile[field];
    if (value === undefined) {
      continue;
    }
    if (placement === "snap") {
      if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        (field === "x" || field === "y" ? value < 0 : value < 1)
      ) {
        return field;
      }
    } else if (typeof value !== "number" || value < 0 || value > 1) {
      return field;
    }
  }
  return null;
}

/** A `wallpaper` object's per-mode refs: optional non-empty strings. */
function wallpaperIssue(wallpaper: unknown): string | null {
  if (wallpaper === undefined) {
    return null;
  }
  if (!isRecord(wallpaper)) {
    return "wallpaper";
  }
  for (const mode of ["light", "dark"] as const) {
    const ref = wallpaper[mode];
    if (ref !== undefined && (typeof ref !== "string" || ref.length === 0)) {
      return `wallpaper.${mode}`;
    }
  }
  return null;
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
    if (
      space.layoutMode !== undefined &&
      !LAYOUT_MODES.includes(space.layoutMode as string)
    ) {
      return `${spacePath}.layoutMode`;
    }
    // Early-v1 singular field still validates as the mode-agnostic ref it
    // was, then migrates into `wallpaper` below.
    if (!optionalString(space.wallpaperRef)) {
      return `${spacePath}.wallpaperRef`;
    }
    const wallpaperDefect = wallpaperIssue(space.wallpaper);
    if (wallpaperDefect !== null) {
      return `${spacePath}.${wallpaperDefect}`;
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
      const geometryDefect = tileGeometryIssue(tile);
      if (geometryDefect !== null) {
        return `${tilePath}.${geometryDefect}`;
      }
    }
  }
  return null;
}

/**
 * In-place v1 upgrade of the early singular `wallpaperRef` (a
 * mode-agnostic ref) into the per-mode `wallpaper` object — the new
 * per-mode refs win over the migrated ones, matching the resolution
 * precedence. Unknown fields are preserved; the legacy field is dropped.
 */
function migrateSpaceWallpaperRef(space: Record<string, unknown>): Record<string, unknown> {
  const legacyRef = space.wallpaperRef;
  if (legacyRef === undefined || typeof legacyRef !== "string") {
    return space;
  }
  const wallpaper = isRecord(space.wallpaper) ? space.wallpaper : {};
  const next: Record<string, unknown> = { ...space, wallpaper: { dark: legacyRef, light: legacyRef, ...wallpaper } };
  delete next.wallpaperRef;
  return next;
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
    // Shallow copy keeps every unknown field; the known early-v1 fields
    // are normalized in place (the singular wallpaperRef becomes the
    // per-mode wallpaper object — same version, migrated in place).
    const migratedSpaces = Array.isArray(input.spaces)
      ? input.spaces.map((space) =>
          isRecord(space) ? migrateSpaceWallpaperRef(space) : space,
        )
      : input.spaces;
    return {
      ok: true,
      recipe: { ...input, spaces: migratedSpaces } as unknown as RecipeV1,
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
