import {
  canvasItemIds,
  validateCanvasLayout,
} from "@veladesk/canvas-engine";
import type { CanvasLayout } from "@veladesk/canvas-engine";
import { validatePageLayout } from "@veladesk/desktop-engine";
import { isWallpaperConfig } from "../wallpaper";
import type { WallpaperConfig } from "../wallpaper";

import { findDesktopPage } from "../lookup";
import { validateWorkspaceAppearance } from "../appearance";
import { isValidGridGapPx } from "../preferences";
import {
  materializePagePlacement,
  pageItemIds,
  switchPagePlacement,
  withPageCanvas,
} from "../canvas";
import type {
  DesktopPage,
  DesktopPageId,
  WorkspacePreferences,
  WorkspaceSnapshot,
} from "../types";
import {
  hasPageItems,
  hasSameItemIds,
  isBlank,
  withPage,
} from "./shared";
import type { WorkspaceEditResult } from "./shared";

/**
 * PAGE/PREFERENCES operations (P1 split of the former editing.ts
 * monolith): section CRUD, the wallpaper overrides, the single Settings
 * write path for preferences, and the canvas/placement commits. Every
 * operation is immutable — failures are values, never throws — and stages
 * nothing: persistence is the caller's concern.
 */

/**
 * Replaces the whole preferences object of a workspace, immutably.
 *
 * This is the single domain write-path for Settings: the default page must
 * exist, and an appearance — when present — must pass semantic validation
 * (legacy-style preferences without an appearance stay legal). On success
 * ONLY `workspace.preferences` is replaced; pages, entities, categories and
 * the dock keep their references, and no active-page/session state is
 * consulted or touched.
 */
export function replaceWorkspacePreferences(
  workspace: WorkspaceSnapshot,
  nextPreferences: WorkspacePreferences
): WorkspaceEditResult {
  if (findDesktopPage(workspace, nextPreferences.defaultPageId) === undefined) {
    return { ok: false, reason: "default-page-not-found" };
  }
  if (nextPreferences.appearance !== undefined) {
    const issues = validateWorkspaceAppearance(nextPreferences.appearance);
    if (issues.length > 0) {
      return { ok: false, reason: "invalid-appearance" };
    }
  }
  if (
    nextPreferences.gridGapPx !== undefined &&
    !isValidGridGapPx(nextPreferences.gridGapPx)
  ) {
    return { ok: false, reason: "invalid-grid-gap" };
  }
  return { ok: true, workspace: { ...workspace, preferences: nextPreferences } };
}

/**
 * Appends an empty page (a user-facing Section) to the workspace, immutably.
 *
 * The id must be unique, the name non-blank after trimming, the layout id
 * must equal the page id, the canvas (when present) must hold no items,
 * the layout must hold no items, and the grid must pass the desktop engine's
 * semantic validation while the canvas — when present — passes the canvas
 * engine's. On success ONLY `workspace.pages` grows — entities, categories,
 * dock and preferences keep their exact references.
 */
export function addPage(
  workspace: WorkspaceSnapshot,
  page: DesktopPage
): WorkspaceEditResult {
  if (workspace.pages.some((existing) => existing.id === page.id)) {
    return { ok: false, reason: "duplicate-page-id" };
  }
  if (isBlank(page.name)) {
    return { ok: false, reason: "invalid-page-name" };
  }
  if (page.layout.id !== page.id) {
    return { ok: false, reason: "page-layout-id-mismatch" };
  }
  if (hasPageItems(page)) {
    return { ok: false, reason: "page-must-be-empty" };
  }
  if (validatePageLayout(page.layout).length > 0) {
    return { ok: false, reason: "invalid-page-layout" };
  }
  if (page.canvas !== undefined && validateCanvasLayout(page.canvas).length > 0) {
    return { ok: false, reason: "invalid-page-layout" };
  }
  return { ok: true, workspace: { ...workspace, pages: [...workspace.pages, page] } };
}

/**
 * Renames a page, storing the next name verbatim, immutably.
 * Layout, array position and every other field stay untouched.
 */
export function renamePage(
  workspace: WorkspaceSnapshot,
  pageId: DesktopPageId,
  nextName: string
): WorkspaceEditResult {
  const page = findDesktopPage(workspace, pageId);
  if (page === undefined) {
    return { ok: false, reason: "page-not-found" };
  }
  if (isBlank(nextName)) {
    return { ok: false, reason: "invalid-page-name" };
  }
  return {
    ok: true,
    workspace: {
      ...workspace,
      pages: workspace.pages.map((candidate) =>
        candidate === page ? { ...page, name: nextName } : candidate
      ),
    },
  };
}

/**
 * Sets or clears one page's background override (023-C.1), immutably.
 * `null` REMOVES the override — the section immediately follows the
 * workspace background again. Never touches membership, geometry, order or
 * any other page; the config is validated by the same structural guard the
 * decoder uses.
 */
export function replacePageWallpaper(
  workspace: WorkspaceSnapshot,
  pageId: DesktopPageId,
  wallpaper: WallpaperConfig | null
): WorkspaceEditResult {
  const page = findDesktopPage(workspace, pageId);
  if (page === undefined) {
    return { ok: false, reason: "page-not-found" };
  }
  if (wallpaper !== null && !isWallpaperConfig(wallpaper)) {
    return { ok: false, reason: "invalid-wallpaper" };
  }
  return {
    ok: true,
    workspace: {
      ...workspace,
      pages: workspace.pages.map((candidate) => {
        if (candidate !== page) {
          return candidate;
        }
        if (wallpaper === null) {
          const { wallpaper: removed, ...cleared } = page;
          void removed;
          return cleared;
        }
        return { ...page, wallpaper };
      }),
    },
  };
}

/**
 * Sets or clears ONE color mode's page background override (P1),
 * immutably. `null` REMOVES that mode's override — the mode falls back to
 * the page's mode-agnostic `wallpaper`, then the ordinary chain. Removing
 * the last override of the map drops the whole map. Never touches the
 * general override, membership, geometry or any other page.
 */
export function replacePageModeWallpaper(
  workspace: WorkspaceSnapshot,
  pageId: DesktopPageId,
  mode: "light" | "dark",
  wallpaper: WallpaperConfig | null
): WorkspaceEditResult {
  const page = findDesktopPage(workspace, pageId);
  if (page === undefined) {
    return { ok: false, reason: "page-not-found" };
  }
  if (wallpaper !== null && !isWallpaperConfig(wallpaper)) {
    return { ok: false, reason: "invalid-wallpaper" };
  }
  return {
    ok: true,
    workspace: {
      ...workspace,
      pages: workspace.pages.map((candidate) => {
        if (candidate !== page) {
          return candidate;
        }
        const current: { light?: WallpaperConfig; dark?: WallpaperConfig } =
          page.wallpaperByMode ?? {};
        const next: { light?: WallpaperConfig; dark?: WallpaperConfig } =
          wallpaper === null
            ? (() => {
                const { [mode]: removed, ...rest } = current;
                void removed;
                return rest;
              })()
            : { ...current, [mode]: wallpaper };
        const hasOverrides = next.light !== undefined || next.dark !== undefined;
        if (!hasOverrides) {
          const { wallpaperByMode: dropped, ...kept } = page;
          void dropped;
          return kept;
        }
        return { ...page, wallpaperByMode: next };
      }),
    },
  };
}

/**
 * Moves a page one slot up or down in the `pages` array, immutably.
 * Only array order changes — contents and the default page are untouched.
 * Moving past either end is a `page-order-boundary` failure.
 */
export function movePage(
  workspace: WorkspaceSnapshot,
  pageId: DesktopPageId,
  direction: "up" | "down"
): WorkspaceEditResult {
  const index = workspace.pages.findIndex((page) => page.id === pageId);
  if (index < 0) {
    return { ok: false, reason: "page-not-found" };
  }
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= workspace.pages.length) {
    return { ok: false, reason: "page-order-boundary" };
  }
  const pages = workspace.pages.slice();
  const [moved] = pages.splice(index, 1);
  pages.splice(targetIndex, 0, moved!);
  return { ok: true, workspace: { ...workspace, pages } };
}

/**
 * Points `preferences.defaultPageId` at an existing page, immutably.
 * Appearance, layoutLocked and every other preference field survive —
 * only the default changes.
 */
export function setDefaultPage(
  workspace: WorkspaceSnapshot,
  pageId: DesktopPageId
): WorkspaceEditResult {
  if (findDesktopPage(workspace, pageId) === undefined) {
    return { ok: false, reason: "page-not-found" };
  }
  return {
    ok: true,
    workspace: {
      ...workspace,
      preferences: { ...workspace.preferences, defaultPageId: pageId },
    },
  };
}

/**
 * Deletes an EMPTY page, immutably.
 *
 * Only a page that holds no item — in its canvas when it has one, in its
 * legacy layout otherwise — can be deleted, and at least one page must
 * survive (`page-not-empty` / `cannot-delete-last-page`). When the deleted
 * page was the default, the default moves to the NEXT page — the one at the
 * deleted position — or, at the end of the array, to the previous page; that
 * matches where the user is looking better than always falling back to
 * `pages[0]`.
 */
export function deleteEmptyPage(
  workspace: WorkspaceSnapshot,
  pageId: DesktopPageId
): WorkspaceEditResult {
  const page = findDesktopPage(workspace, pageId);
  if (page === undefined) {
    return { ok: false, reason: "page-not-found" };
  }
  if (hasPageItems(page)) {
    return { ok: false, reason: "page-not-empty" };
  }
  if (workspace.pages.length <= 1) {
    return { ok: false, reason: "cannot-delete-last-page" };
  }
  const index = workspace.pages.findIndex((candidate) => candidate.id === pageId);
  const pages = workspace.pages.filter((candidate) => candidate.id !== pageId);
  let preferences = workspace.preferences;
  if (preferences.defaultPageId === pageId) {
    const neighbor = workspace.pages[index + 1] ?? workspace.pages[index - 1];
    preferences = { ...preferences, defaultPageId: neighbor!.id };
  }
  return { ok: true, workspace: { ...workspace, pages, preferences } };
}

/**
 * Replaces the canvas geometry of a page, immutably — the single write path
 * for move/resize/mode-switch commits.
 *
 * A legacy grid page is materialized first, so committing a canvas also
 * upgrades that page to canvas geometry. The incoming canvas must be valid
 * AND describe exactly the items the page already holds: a canvas is
 * geometry, not membership, so one that adds or drops an id is refused as
 * `invalid-page-layout` instead of silently changing what the page
 * contains (adding/removing lives in the dedicated ops).
 */
export function replacePageCanvas(
  workspace: WorkspaceSnapshot,
  pageId: DesktopPageId,
  canvas: CanvasLayout
): WorkspaceEditResult {
  const page = findDesktopPage(workspace, pageId);
  if (page === undefined) {
    return { ok: false, reason: "page-not-found" };
  }
  if (validateCanvasLayout(canvas).length > 0) {
    return { ok: false, reason: "invalid-page-layout" };
  }
  if (!hasSameItemIds(pageItemIds(page), canvasItemIds(canvas))) {
    return { ok: false, reason: "invalid-page-layout" };
  }
  return {
    ok: true,
    workspace: withPage(workspace, pageId, withPageCanvas(materializePagePlacement(page), canvas)),
  };
}

/**
 * Switches a page between Grid and Freeform placement, KEEPING both layout
 * datasets (P1): the leaving mode's geometry is retained on the page and
 * reconciled back on the next switch, so a round trip never destroys
 * either arrangement. Delegates the geometry to `switchPagePlacement`
 * (retained-set reconciliation, first-switch conversion with the same
 * lossy refusal the direct conversion always had) and validates the result
 * like every canvas write. Structural — history restarts at the new
 * placement; undo never walks back into a mode the user left.
 */
export function switchPagePlacementMode(
  workspace: WorkspaceSnapshot,
  pageId: DesktopPageId,
  next: "grid" | "freeform"
): WorkspaceEditResult {
  const page = findDesktopPage(workspace, pageId);
  if (page === undefined) {
    return { ok: false, reason: "page-not-found" };
  }
  const switched = switchPagePlacement(page, next);
  if (!switched.ok) {
    return { ok: false, reason: "invalid-page-layout" };
  }
  const { retainedCanvas, canvas } = switched.page;
  if (validateCanvasLayout(canvas).length > 0) {
    return { ok: false, reason: "invalid-page-layout" };
  }
  if (retainedCanvas !== undefined && validateCanvasLayout(retainedCanvas).length > 0) {
    return { ok: false, reason: "invalid-page-layout" };
  }
  if (!hasSameItemIds(pageItemIds(page), canvasItemIds(canvas))) {
    return { ok: false, reason: "invalid-page-layout" };
  }
  return { ok: true, workspace: withPage(workspace, pageId, switched.page) };
}
