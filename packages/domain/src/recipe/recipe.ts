import { CANVAS_UNITS } from "@veladesk/canvas-engine";

import { inferInterfaceStyle, resolveWorkspaceAppearance } from "../appearance";
import { gridPlacementOf, pageItemIds, resolvePagePlacement } from "../canvas";
import type { AppIcon, WorkspaceSnapshot, WorkspaceWallpaperPreset } from "../types";
import type { WallpaperConfig } from "../wallpaper";
import type {
  RecipeGridV1,
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
  RECIPE_ASSET_MEDIA_TYPES,
  RECIPE_CONTENT_ASSET_ID_PATTERN,
  RECIPE_FORMAT_IDENTITY,
  RECIPE_MAX_ASSET_BASE64_LENGTH,
  RECIPE_MAX_ASSETS,
  RECIPE_MAX_GRID_COLUMNS,
  RECIPE_MAX_GRID_ROWS,
  RECIPE_VERSION,
} from "./types";

// --- reference rules (shared by export and migrate) ---------------------------

/**
 * The wallpaper preset whitelist. Keyed by the domain's preset union so a
 * new preset fails to compile here until the recipe accepts it too.
 */
const PRESET_WHITELIST: Readonly<Record<WorkspaceWallpaperPreset, true>> = {
  chart: true,
  aurora: true,
  midnight: true,
  dawn: true,
  mist: true,
};

/** Whether `value` is a content-addressed asset id (same rule as packages/assets). */
export function isRecipeAssetId(value: unknown): value is string {
  return typeof value === "string" && RECIPE_CONTENT_ASSET_ID_PATTERN.test(value);
}

/** Whether `ref` is a legal wallpaper reference: `preset:<whitelisted>` or `asset:<content id>`. */
export function isRecipeWallpaperRef(ref: unknown): ref is string {
  if (typeof ref !== "string") {
    return false;
  }
  if (ref.startsWith("preset:")) {
    return Object.prototype.hasOwnProperty.call(PRESET_WHITELIST, ref.slice("preset:".length));
  }
  if (ref.startsWith("asset:")) {
    return isRecipeAssetId(ref.slice("asset:".length));
  }
  return false;
}

/** The asset id a ref points at, or undefined for presets / non-refs. */
function assetIdOfRef(ref: unknown): string | undefined {
  return typeof ref === "string" && ref.startsWith("asset:") ? ref.slice("asset:".length) : undefined;
}

function isGridDimension(value: unknown, max: number): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= max;
}

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

/**
 * `preset:<id>` / `asset:<assetId>` — a reference, never a payload. A ref
 * the importer would reject (an asset id outside the content-addressed
 * format, an unknown preset) is OMITTED, so an export always re-imports.
 */
function wallpaperRefOf(wallpaper: WallpaperConfig | undefined): string | undefined {
  if (wallpaper === undefined) {
    return undefined;
  }
  const ref = wallpaper.kind === "preset"
    ? `preset:${wallpaper.presetId}`
    : `asset:${wallpaper.assetId}`;
  return isRecipeWallpaperRef(ref) ? ref : undefined;
}

/** Both modes of a mode-agnostic config, or undefined when not exportable. */
function bothModesOf(wallpaper: WallpaperConfig | undefined): RecipeWallpaperV1 | undefined {
  const ref = wallpaperRefOf(wallpaper);
  return ref === undefined ? undefined : { light: ref, dark: ref };
}

/**
 * A page's snap grid: the live grid canvas's columns (when the page is in
 * Grid) over the layout lattice, rows from the lattice. Omitted when out
 * of the recipe's bounds — the importer then uses its default grid.
 */
function gridOf(page: PageOfSnapshot): RecipeGridV1 | undefined {
  const columns = gridPlacementOf(page)?.columns ?? page.layout.grid.columns;
  const rows = page.layout.grid.rows;
  return isGridDimension(columns, RECIPE_MAX_GRID_COLUMNS) && isGridDimension(rows, RECIPE_MAX_GRID_ROWS)
    ? { columns, rows }
    : undefined;
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
  // A present mode override that is not exportable omits THAT mode: it
  // never silently falls back to the general upload (the renderer would
  // not have shown the general one for this mode either).
  const resolvedLight = byMode?.light !== undefined ? wallpaperRefOf(byMode.light) : general;
  const resolvedDark = byMode?.dark !== undefined ? wallpaperRefOf(byMode.dark) : general;
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
  // Only an EXPLICIT workspace default wallpaper exports (the legacy
  // preset field stays the importer's own default).
  const themeWallpaper = bothModesOf(workspace.preferences.appearance?.wallpaper);
  const theme: RecipeThemeV1 = {
    mode: appearance.colorMode,
    accent: appearance.accentHue,
    material: appearance.interfaceStyle ?? inferInterfaceStyle(appearance),
    ...(themeWallpaper !== undefined ? { wallpaper: themeWallpaper } : {}),
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
    const grid = gridOf(page);
    return {
      id: page.id,
      name: page.name,
      layout: layoutMode === "free" ? "canvas" : "grid",
      layoutMode,
      ...(grid !== undefined ? { grid } : {}),
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
    assets: recipe.assets,
    spaces: recipe.spaces.map((space) => ({
      name: space.name,
      layoutMode: space.layoutMode ?? "snap",
      grid: space.grid,
      wallpaper: space.wallpaper,
      tiles: space.tiles.map((tile) => ({
        name: tile.name,
        url: tile.url,
        ...(tile.icon !== undefined ? { icon: tile.icon } : {}),
        ...(tile.openMode !== undefined ? { openMode: tile.openMode } : {}),
        ...(tile.placement !== undefined ? { placement: tile.placement } : {}),
        ...(tile.x !== undefined ? { x: tile.x } : {}),
        ...(tile.y !== undefined ? { y: tile.y } : {}),
        ...(tile.w !== undefined ? { w: tile.w } : {}),
        ...(tile.h !== undefined ? { h: tile.h } : {}),
      })),
    })),
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

/** A `wallpaper` object's per-mode refs: optional, each a legal ref (see isRecipeWallpaperRef). */
function wallpaperIssue(wallpaper: unknown): string | null {
  if (wallpaper === undefined) {
    return null;
  }
  if (!isRecord(wallpaper)) {
    return "wallpaper";
  }
  for (const mode of ["light", "dark"] as const) {
    const ref = wallpaper[mode];
    if (ref !== undefined && !isRecipeWallpaperRef(ref)) {
      return `wallpaper.${mode}`;
    }
  }
  return null;
}

/** A space's optional snap grid: positive safe integers within the caps. */
function gridIssue(grid: unknown): string | null {
  if (grid === undefined) {
    return null;
  }
  if (!isRecord(grid)) {
    return "grid";
  }
  if (!isGridDimension(grid.columns, RECIPE_MAX_GRID_COLUMNS)) {
    return "grid.columns";
  }
  if (!isGridDimension(grid.rows, RECIPE_MAX_GRID_ROWS)) {
    return "grid.rows";
  }
  return null;
}

const BASE64_SYNTAX = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * The optional `assets` map — SYNTAX only (decoding, hashing and magic
 * bytes are the importer's job): a record of ≤ RECIPE_MAX_ASSETS entries,
 * each keyed by a content asset id that some `asset:` ref in the document
 * points at, carrying an allowed `mediaType` and non-empty padded base64
 * within the per-asset budget.
 */
function assetsIssue(assets: unknown, referenced: ReadonlySet<string>): string | null {
  if (assets === undefined) {
    return null;
  }
  if (!isRecord(assets)) {
    return "assets";
  }
  const keys = Object.keys(assets);
  if (keys.length > RECIPE_MAX_ASSETS) {
    return "assets";
  }
  for (const key of keys) {
    const path = `assets.${key}`;
    if (!isRecipeAssetId(key) || !referenced.has(key)) {
      return path;
    }
    const asset = assets[key];
    if (!isRecord(asset)) {
      return path;
    }
    if (!(RECIPE_ASSET_MEDIA_TYPES as readonly unknown[]).includes(asset.mediaType)) {
      return `${path}.mediaType`;
    }
    const data = asset.data;
    if (
      typeof data !== "string" ||
      data.length === 0 ||
      data.length % 4 !== 0 ||
      data.length > RECIPE_MAX_ASSET_BASE64_LENGTH ||
      !BASE64_SYNTAX.test(data)
    ) {
      return `${path}.data`;
    }
  }
  return null;
}

/** Every asset id an `asset:` ref in the (validated) document points at. */
function referencedAssetIds(spaces: readonly unknown[], theme: unknown): Set<string> {
  const ids = new Set<string>();
  const addWallpaper = (wallpaper: unknown) => {
    if (!isRecord(wallpaper)) return;
    for (const mode of ["light", "dark"] as const) {
      const id = assetIdOfRef(wallpaper[mode]);
      if (id !== undefined) ids.add(id);
    }
  };
  for (const space of spaces) {
    if (!isRecord(space)) continue;
    addWallpaper(space.wallpaper);
    const legacy = assetIdOfRef(space.wallpaperRef);
    if (legacy !== undefined) ids.add(legacy);
  }
  if (isRecord(theme)) {
    addWallpaper(theme.wallpaper);
  }
  return ids;
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
    // was (same strict ref rule), then migrates into `wallpaper` below.
    if (space.wallpaperRef !== undefined && !isRecipeWallpaperRef(space.wallpaperRef)) {
      return `${spacePath}.wallpaperRef`;
    }
    const gridDefect = gridIssue(space.grid);
    if (gridDefect !== null) {
      return `${spacePath}.${gridDefect}`;
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
    if (isRecord(input.theme)) {
      const themeWallpaperDefect = wallpaperIssue(input.theme.wallpaper);
      if (themeWallpaperDefect !== null) {
        return { ok: false, issue: { type: "invalid-recipe", path: `theme.${themeWallpaperDefect}` } };
      }
    }
    const assetsDefect = assetsIssue(
      input.assets,
      referencedAssetIds(input.spaces as readonly unknown[], input.theme),
    );
    if (assetsDefect !== null) {
      return { ok: false, issue: { type: "invalid-recipe", path: assetsDefect } };
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
