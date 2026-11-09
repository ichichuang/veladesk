import type {
  AppOpenMode,
  JsonObject,
  WorkspaceColorMode,
  WorkspaceInterfaceStyle,
  WorkspaceReducedMotionPreference,
} from "../types";

/**
 * RecipeV1 — the public, shareable "deck" document (P1: structure only).
 *
 * A recipe is the workspace's PUBLIC configuration: theme, motion switches,
 * spaces and their tiles. It deliberately carries NO private data (no
 * tokens/credentials), no asset binaries (assets appear as references
 * only) and nothing the importer cannot safely generate. It is NOT a
 * backup: server state, revisions and asset payloads never ride along.
 *
 * Unknown fields are PRESERVED through migration/round-trips for forward
 * compatibility — the runtime keeps the whole source record and only
 * normalizes the known fields, so a future reader (or a newer VelaDesk)
 * still sees what it knows. Documents declaring a version NEWER than
 * `RECIPE_VERSION` are rejected, never best-effort parsed.
 */

/** The recipe format identity (`format` field). */
export const RECIPE_FORMAT_IDENTITY = "vela.recipe";

/** The recipe format version this build reads and writes. */
export const RECIPE_VERSION = 1;

/** The recipe file extension — a `.deck.json` file IS a recipe. */
export const RECIPE_FILE_EXTENSION = ".deck.json";

/** How a space arranges its tiles. `orbit` is reserved for Orbits (P2). */
export type RecipeSpaceLayout = "grid" | "canvas" | "orbit";

/**
 * How a space's tiles are placed (P1): `snap` = the integer size-step grid
 * (1×1 / 2×1 / 2×2 / 4×2), `free` = continuous rects where overlap is
 * legal. Absent resolves to `snap` — the deck's default arrangement.
 */
export type RecipeLayoutMode = "snap" | "free";

/**
 * How one tile is placed inside its space. Mirrors the resolved page
 * placement: `snap` tiles carry integer grid cells, `free` tiles carry
 * relative 0–1 fractions of the space's continuous canvas.
 */
export type RecipeTilePlacement = "snap" | "free";

/**
 * One tile of a space — the public projection of an app shortcut.
 *
 * `icon` is an Iconify `collection:name` key; absent means favicon/auto
 * (generated initials are re-derivable from the name at import time).
 * Asset-backed icons are private and never exported.
 *
 * `placement` + `x`/`y`/`w`/`h` carry the tile's geometry in the space:
 * `snap` → `x`/`y` are the 0-based grid column/row and `w`/`h` the cell
 * spans (safe integers; w/h ≥ 1); `free` → all four are relative 0–1
 * fractions of the space's canvas (resolution-independent, matching the
 * engine's 10 000-unit model). Absent geometry lets the importer place
 * the tile by its own default — a recipe never forces a layout.
 */
export interface RecipeTileV1 {
  readonly id?: string;
  readonly name: string;
  readonly url: string;
  readonly icon?: string;
  readonly openMode?: AppOpenMode;
  readonly placement?: RecipeTilePlacement;
  readonly x?: number;
  readonly y?: number;
  readonly w?: number;
  readonly h?: number;
}

/**
 * A space's wallpaper references, per color mode (P1). Each value is
 * `preset:<id>` or `asset:<assetId>` — a reference, never a payload; the
 * binary never rides along in a recipe. An absent mode falls back to the
 * other mode, then to the space's mode-agnostic upload, then to the deck
 * default — exactly the renderer's fallback chain. (Replaces the singular
 * `wallpaperRef` of early v1 documents, which migrated in place.)
 */
export interface RecipeWallpaperV1 {
  readonly light?: string;
  readonly dark?: string;
}

/**
 * One space of a deck. `wallpaper` carries the per-mode wallpaper
 * references (a reference — the binary never rides along); absent =
 * follow the deck.
 */
export interface RecipeSpaceV1 {
  readonly id?: string;
  readonly name: string;
  readonly layout: RecipeSpaceLayout;
  readonly layoutMode?: RecipeLayoutMode;
  readonly wallpaper?: RecipeWallpaperV1;
  readonly tiles: readonly RecipeTileV1[];
}

/** The deck's theme — the persisted appearance, public fields only. */
export interface RecipeThemeV1 {
  readonly mode: WorkspaceColorMode;
  /** The accent hue in OKLCH degrees (0–359). */
  readonly accent: number;
  /** The material tier — mirrors the workspace interface style. */
  readonly material: WorkspaceInterfaceStyle;
  /** Semantic token overrides (`--vd-color-accent` → value). Future slot. */
  readonly tokenOverrides?: Readonly<Record<string, string>>;
}

/** The deck's motion switches. */
export interface RecipeMotionV1 {
  readonly reducedMotion?: WorkspaceReducedMotionPreference;
  readonly experiments?: { readonly helmMotion?: boolean };
}

/** A plugin the deck expects, with its public settings. */
export interface RecipePluginV1 {
  readonly id: string;
  readonly version: string;
  readonly settings?: JsonObject;
}

/**
 * The recipe document. The known fields are typed; every OTHER field on
 * the source record survives a migration/round-trip verbatim (see the
 * module header) — treat recipes as immutable values.
 */
export interface RecipeV1 {
  readonly format: typeof RECIPE_FORMAT_IDENTITY;
  readonly version: typeof RECIPE_VERSION;
  /** ISO timestamp; absent on documents migrated up from legacy imports. */
  readonly createdAt?: string;
  /** The app surface the deck expects, for future compatibility gating. */
  readonly app?: { readonly minVersion?: string };
  readonly theme?: RecipeThemeV1;
  readonly motion?: RecipeMotionV1;
  readonly spaces: readonly RecipeSpaceV1[];
  readonly plugins: readonly RecipePluginV1[];
}

/**
 * The public import payload `importRecipe` distills from a recipe: the
 * sections/apps the existing import pipeline consumes, plus theme/motion
 * for callers that apply them (P1 import wiring consumes sections only).
 */
export interface RecipeImportPayload {
  readonly theme: RecipeThemeV1 | undefined;
  readonly motion: RecipeMotionV1 | undefined;
  readonly sections: readonly {
    readonly name: string;
    readonly apps: readonly { readonly name: string; readonly url: string }[];
  }[];
}
