/**
 * The pure/in-memory apply layer (task 024 §38–§39, §60–§62).
 *
 * Builds the ENTIRE prospective workspace in memory by chaining the same
 * domain ops the dialogs use — `addPage` with the New Section construction
 * and `addAppToPage` with the Add App defaults — then hands the final
 * snapshot back for ONE stage/save. Each planned app is applied
 * sequentially to the accumulating snapshot so placement sees previous
 * imported apps; ids come only from the injected factory (deterministic in
 * tests, `createBrowserId` in production). The input snapshot is never
 * mutated.
 *
 * Recipe structure (option `recipe`, from `ParsedImportDocument.recipe`):
 * CREATED sections restore the space's layout mode, grid, tile geometry
 * and light/dark wallpapers; MERGED sections only gain apps. Tiles map to
 * planned apps POSITIONALLY: a plan section is the concatenation (in
 * document order) of every document section sharing its name key — the
 * planner's own fold — and document section i / app j IS recipe space i /
 * tile j. Theme + motion apply only with `applyTheme: true`. Everything is
 * computed in memory; the caller still stages ONE revision.
 */

import { CANVAS_UNITS, MIN_CANVAS_SIZE } from "@veladesk/canvas-engine";
import type { CanvasRect, FreeformCanvasLayoutV2, GridCanvasItem } from "@veladesk/canvas-engine";
import type {
  AppIcon,
  AppShortcut,
  DesktopPageId,
  RecipeImportTile,
  RecipeMotionV1,
  RecipeThemeV1,
  RecipeWallpaperV1,
  WallpaperConfig,
  WorkspaceMotionPreferences,
  WorkspaceReducedMotionPreference,
  WorkspaceSnapshot,
} from "@veladesk/domain";
import {
  addAppToPage,
  addPage,
  findDesktopPage,
  gridPlacementOf,
  isRecipeWallpaperRef,
  replacePageCanvas,
  replacePageModeWallpaper,
  replaceWorkspacePreferences,
  resolveInterfaceStyle,
  resolveWorkspaceAppearance,
} from "@veladesk/domain";
import type { WorkspaceEditResult } from "@veladesk/domain";

import { resolveBrandFromHostname } from "../app-recognition/brand-aliases";
import { generatedIconText } from "../home/generated-icon";
import { normalizeImportNameKey } from "./normalization";
import type { ImportPlan, ImportSectionPlan } from "./planner";
import { isLegalRecipeTheme } from "./recipe-adapter";
import type { RecipeImportExtras } from "./recipe-adapter";

/** Creates fresh entity/page ids at apply-time only. */
export type ImportIdFactory = (kind: "page" | "app") => string;

export type ApplyImportResult = WorkspaceEditResult;

export interface ApplyImportOptions {
  /** The recipe structure (`ParsedImportDocument.recipe`); absent = plain import. */
  readonly recipe?: RecipeImportExtras | undefined;
  /** Apply the recipe theme (+ its wallpaper) and motion. Default false. */
  readonly applyTheme?: boolean;
}

/**
 * The onboarding grid (10×6) — the fallback snap lattice only used if the
 * workspace somehow has no pages; in practice `cannot-delete-last-page`
 * keeps at least one page around, and new sections copy an existing page's
 * grid the way SectionDialog does.
 */
const FALLBACK_GRID = { columns: 10, rows: 6 } as const;

export function applyImportPlan(
  workspace: WorkspaceSnapshot,
  plan: ImportPlan,
  idFactory: ImportIdFactory,
  options: ApplyImportOptions = {}
): ApplyImportResult {
  if (plan.errors.length > 0) {
    // Programmer error, not a user-facing condition: the UI disables Import
    // for blocked plans. Fail loudly instead of inventing a fake edit reason.
    throw new Error("applyImportPlan received a blocked plan");
  }

  const recipe = options.recipe;
  let current = workspace;
  const gridSource = current.pages[0]?.layout.grid ?? { ...FALLBACK_GRID };

  // 1. Create the required sections first, with the New Section defaults —
  //    or, for a recipe space, its own grid and placement mode.
  const createdPageIds = new Map<string, DesktopPageId>();
  for (const section of plan.sections) {
    if (section.action !== "create") {
      continue;
    }
    const space = recipe === undefined ? undefined : recipeSectionOf(plan, recipe, section)?.space;
    const grid = space?.grid ?? gridSource;
    const pageId = idFactory("page");
    const result = addPage(current, {
      id: pageId,
      name: section.displayName,
      layout: { id: pageId, grid: { columns: grid.columns, rows: grid.rows }, items: [] },
      canvas:
        space?.layoutMode === "free"
          ? { version: 2, mode: "freeform", items: [] }
          : { version: 2, mode: "grid", columns: grid.columns, items: [] },
    });
    if (!result.ok) {
      return result;
    }
    current = result.workspace;
    createdPageIds.set(section.nameKey, pageId);
  }

  // 2. Create the apps sequentially so each placement sees the previous
  //    imported apps (task 024 §30) — no hardcodes, the shared placement
  //    engine owns geometry. Recipe geometry then overrides it for created
  //    sections where it is legal.
  for (const section of plan.sections) {
    const targetPageId =
      section.action === "merge" ? section.targetPageId : createdPageIds.get(section.nameKey) ?? null;
    if (targetPageId === null) {
      continue;
    }
    // Ids are drawn in plan order whatever the placement order below.
    const entries: { readonly app: AppShortcut; readonly tile: RecipeImportTile | undefined }[] = [];
    const aligned =
      section.action === "create" && recipe !== undefined ? recipeSectionOf(plan, recipe, section) : undefined;
    section.apps.forEach((app, index) => {
      if (app.action !== "create") {
        return;
      }
      entries.push({
        app: {
          kind: "app",
          id: idFactory("app"),
          name: app.name,
          url: app.url,
          icon: resolveImportAppIcon(app.name, app.url),
          openMode: "new-tab",
          tags: [],
        },
        tile: aligned?.tiles[index],
      });
    });
    const placed =
      aligned === undefined
        ? addAppsInOrder(current, targetPageId, entries.map((entry) => entry.app))
        : aligned.space.layoutMode === "free"
          ? placeFreeformSection(current, targetPageId, entries)
          : placeSnapSection(current, targetPageId, entries);
    if (!placed.ok) {
      return placed;
    }
    current = placed.workspace;

    // 3. A created recipe space's light/dark wallpapers.
    if (aligned !== undefined) {
      for (const mode of ["light", "dark"] as const) {
        const config = wallpaperConfigOf(aligned.space.wallpaper?.[mode]);
        if (config === undefined) {
          continue;
        }
        const result = replacePageModeWallpaper(current, targetPageId, mode, config);
        if (!result.ok) {
          return result;
        }
        current = result.workspace;
      }
    }
  }

  // 4. Theme + motion: opt-in only.
  if (recipe !== undefined && options.applyTheme === true) {
    const themed = applyRecipeTheme(current, recipe.theme, recipe.motion);
    if (!themed.ok) {
      return themed;
    }
    current = themed.workspace;
  }

  return { ok: true, workspace: current };
}

// --- recipe alignment ---------------------------------------------------------

type RecipeSpace = RecipeImportExtras["spaces"][number];

/**
 * The recipe side of one plan section: the FIRST document section with the
 * section's name key supplies the space-level fields (the planner's "first
 * display name wins"), and the tiles of every same-key section concatenate
 * in document order — exactly how the planner folds the apps. A length
 * mismatch (never expected) drops the geometry rather than misalign it.
 */
function recipeSectionOf(
  plan: ImportPlan,
  recipe: RecipeImportExtras,
  section: ImportSectionPlan
): { readonly space: RecipeSpace; readonly tiles: readonly (RecipeImportTile | undefined)[] } | undefined {
  let first: RecipeSpace | undefined;
  const tiles: RecipeImportTile[] = [];
  plan.document.sections.forEach((documentSection, index) => {
    if (normalizeImportNameKey(documentSection.name) !== section.nameKey) {
      return;
    }
    const space = recipe.spaces[index];
    if (space === undefined) {
      return;
    }
    first ??= space;
    tiles.push(...space.tiles);
  });
  if (first === undefined) {
    return undefined;
  }
  return { space: first, tiles: tiles.length === section.apps.length ? tiles : [] };
}

function addAppsInOrder(
  workspace: WorkspaceSnapshot,
  pageId: DesktopPageId,
  apps: readonly AppShortcut[]
): WorkspaceEditResult {
  let current = workspace;
  for (const app of apps) {
    const result = addAppToPage(current, pageId, app);
    if (!result.ok) {
      return result;
    }
    current = result.workspace;
  }
  return { ok: true, workspace: current };
}

type PlacementEntry = { readonly app: AppShortcut; readonly tile: RecipeImportTile | undefined };

/** A snap tile's declared cell rect, or undefined when it carries none. */
function snapCellOf(tile: RecipeImportTile | undefined): Omit<GridCanvasItem, "id"> | undefined {
  if (tile?.placement !== "snap") {
    return undefined;
  }
  const { x, y, w, h } = tile;
  if (![x, y, w, h].every((value) => typeof value === "number" && Number.isSafeInteger(value))) {
    return undefined;
  }
  if (x! < 0 || y! < 0 || w! < 1 || h! < 1) {
    return undefined;
  }
  return { column: x!, row: y!, columnSpan: w!, rowSpan: h! };
}

function cellsOverlap(a: Omit<GridCanvasItem, "id">, b: Omit<GridCanvasItem, "id">): boolean {
  return (
    a.column < b.column + b.columnSpan &&
    b.column < a.column + a.columnSpan &&
    a.row < b.row + b.rowSpan &&
    b.row < a.row + a.rowSpan
  );
}

/**
 * Snap space: every tile with a legal cell (inside the page's columns, not
 * overlapping an EARLIER accepted tile) keeps it exactly; every other tile
 * falls back — PER TILE — to the engine's first-free placement around the
 * accepted ones. Rows are unbounded in Grid, so only columns bound a cell.
 * The page's item order is the plan order in the end.
 */
function placeSnapSection(
  workspace: WorkspaceSnapshot,
  pageId: DesktopPageId,
  entries: readonly PlacementEntry[]
): WorkspaceEditResult {
  const page = findDesktopPage(workspace, pageId);
  const grid = page === undefined ? undefined : gridPlacementOf(page);
  if (page === undefined || grid === undefined) {
    return addAppsInOrder(workspace, pageId, entries.map((entry) => entry.app));
  }
  const accepted: GridCanvasItem[] = [];
  const fallback: AppShortcut[] = [];
  for (const entry of entries) {
    const cell = snapCellOf(entry.tile);
    if (
      cell === undefined ||
      cell.column + cell.columnSpan > grid.columns ||
      accepted.some((other) => cellsOverlap(other, cell))
    ) {
      fallback.push(entry.app);
      continue;
    }
    accepted.push({ id: entry.app.id, ...cell });
  }
  if (accepted.length === 0) {
    return addAppsInOrder(workspace, pageId, entries.map((entry) => entry.app));
  }

  // Accepted tiles first, pinned to their cells; then the engine places
  // the fallback ones around them; then restore the plan order.
  let result = addAppsInOrder(workspace, pageId, accepted.map((item) => entryById(entries, item.id)));
  if (!result.ok) return result;
  result = replacePageCanvas(result.workspace, pageId, { ...grid, items: accepted });
  if (!result.ok) return result;
  result = addAppsInOrder(result.workspace, pageId, fallback);
  if (!result.ok) return result;
  const placedPage = findDesktopPage(result.workspace, pageId);
  const placedGrid = placedPage === undefined ? undefined : gridPlacementOf(placedPage);
  if (placedGrid === undefined) {
    return result;
  }
  const order = new Map(entries.map((entry, index) => [entry.app.id, index]));
  const items = [...placedGrid.items].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return replacePageCanvas(result.workspace, pageId, { ...placedGrid, items });
}

function entryById(entries: readonly PlacementEntry[], id: string): AppShortcut {
  return entries.find((entry) => entry.app.id === id)!.app;
}

/** 0–1 fraction → canvas units, clamped so the rect stays legal. */
function unitRectOf(tile: RecipeImportTile | undefined): CanvasRect | undefined {
  if (tile?.placement !== "free") {
    return undefined;
  }
  const { x, y, w, h } = tile;
  if (![x, y, w, h].every((value) => typeof value === "number" && Number.isFinite(value))) {
    return undefined;
  }
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
  const axis = (origin: number, size: number) => {
    let start = Math.round(clamp01(origin) * CANVAS_UNITS);
    let length = Math.max(MIN_CANVAS_SIZE, Math.round(clamp01(size) * CANVAS_UNITS));
    if (start + length > CANVAS_UNITS) {
      length = Math.max(MIN_CANVAS_SIZE, CANVAS_UNITS - start);
      start = CANVAS_UNITS - length;
    }
    return { start, length };
  };
  const horizontal = axis(x!, w!);
  const vertical = axis(y!, h!);
  return { x: horizontal.start, y: vertical.start, width: horizontal.length, height: vertical.length };
}

/**
 * Freeform space: the engine cascades every tile first (the default),
 * then each tile with free geometry takes its declared rect, clamped into
 * the 0–1 canvas (overlap is legal in Freeform). Others keep the cascade.
 */
function placeFreeformSection(
  workspace: WorkspaceSnapshot,
  pageId: DesktopPageId,
  entries: readonly PlacementEntry[]
): WorkspaceEditResult {
  const added = addAppsInOrder(workspace, pageId, entries.map((entry) => entry.app));
  if (!added.ok) return added;
  const page = findDesktopPage(added.workspace, pageId);
  const canvas = page?.canvas;
  if (canvas === undefined || canvas.version !== 2 || canvas.mode !== "freeform") {
    return added;
  }
  const rectById = new Map(entries.map((entry) => [entry.app.id, unitRectOf(entry.tile)]));
  const next: FreeformCanvasLayoutV2 = {
    ...canvas,
    items: canvas.items.map((item) => {
      const rect = rectById.get(item.id);
      return rect === undefined ? item : { ...item, rect };
    }),
  };
  return replacePageCanvas(added.workspace, pageId, next);
}

// --- wallpapers + theme ---------------------------------------------------------

/** A recipe wallpaper ref as a domain config (asset fit defaults to cover). */
function wallpaperConfigOf(ref: string | undefined): WallpaperConfig | undefined {
  if (ref === undefined || !isRecipeWallpaperRef(ref)) {
    return undefined;
  }
  if (ref.startsWith("preset:")) {
    return { kind: "preset", presetId: ref.slice("preset:".length) as Extract<WallpaperConfig, { kind: "preset" }>["presetId"] };
  }
  return { kind: "asset", assetId: ref.slice("asset:".length), fit: "cover", position: "center" };
}

const REDUCED_MOTION: readonly WorkspaceReducedMotionPreference[] = ["system", "on", "off"];

/**
 * The workspace default is ONE mode-agnostic wallpaper: a `dark` theme
 * takes the dark ref, `light`/`system` the light one, each falling back to
 * the other mode.
 */
function themeWallpaperOf(theme: RecipeThemeV1): WallpaperConfig | undefined {
  const refs: RecipeWallpaperV1 | undefined = theme.wallpaper;
  if (refs === undefined) return undefined;
  const ref = theme.mode === "dark" ? refs.dark ?? refs.light : refs.light ?? refs.dark;
  return wallpaperConfigOf(ref);
}

/** Known motion fields only, each structurally checked. */
function motionOf(motion: RecipeMotionV1 | undefined): WorkspaceMotionPreferences | undefined {
  if (motion === undefined || typeof motion !== "object" || motion === null) return undefined;
  const reducedMotion = REDUCED_MOTION.includes(motion.reducedMotion as WorkspaceReducedMotionPreference)
    ? motion.reducedMotion
    : undefined;
  const helmMotion = typeof motion.experiments?.helmMotion === "boolean" ? motion.experiments.helmMotion : undefined;
  if (reducedMotion === undefined && helmMotion === undefined) return undefined;
  return {
    ...(reducedMotion !== undefined ? { reducedMotion } : {}),
    ...(helmMotion !== undefined ? { experiments: { helmMotion } } : {}),
  };
}

/**
 * Theme + motion through the Settings write path: color mode, accent and
 * the material's canonical surface parameters (`resolveInterfaceStyle`,
 * like a Settings save), the theme wallpaper as the workspace default.
 * An illegal theme is SKIPPED (the adapter already stripped it with a
 * warning; this is the defense for hand-built extras) — an import never
 * fails over theme values.
 */
function applyRecipeTheme(
  workspace: WorkspaceSnapshot,
  theme: RecipeThemeV1 | undefined,
  motion: RecipeMotionV1 | undefined
): WorkspaceEditResult {
  let preferences = workspace.preferences;
  if (theme !== undefined && isLegalRecipeTheme(theme)) {
    const style = resolveInterfaceStyle(theme.material);
    const wallpaper = themeWallpaperOf(theme);
    preferences = {
      ...preferences,
      appearance: {
        ...resolveWorkspaceAppearance(preferences),
        colorMode: theme.mode,
        accentHue: theme.accent,
        surfaceOpacity: style.surfaceOpacity,
        blurPx: style.blurPx,
        radiusPx: style.radiusPx,
        interfaceStyle: style.style,
        ...(wallpaper !== undefined ? { wallpaper } : {}),
      },
    };
  }
  const nextMotion = motionOf(motion);
  if (nextMotion !== undefined) {
    preferences = { ...preferences, motion: nextMotion };
  }
  return preferences === workspace.preferences
    ? { ok: true, workspace }
    : replaceWorkspacePreferences(workspace, preferences);
}

/**
 * Auto icon policy (task 024 §25–§26): the LOCAL brand catalog first —
 * zero network, works offline — then the shared generated-text helper.
 * Never a remote URL, never a second initials algorithm.
 */
export function resolveImportAppIcon(name: string, url: string): AppIcon {
  const brand = resolveBrandFromHostname(hostnameOf(url) ?? "");
  if (brand !== null) {
    return { kind: "iconify", icon: brand.iconKey };
  }
  return { kind: "generated", text: generatedIconText(name), source: "auto" };
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
