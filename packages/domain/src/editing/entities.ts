import { findCanvasItem } from "@veladesk/canvas-engine";
import type { CanvasLayoutItem, CanvasRect, GridCanvasItem } from "@veladesk/canvas-engine";

import { findDesktopPage } from "../lookup";
import {
  placePageItem,
  pageItemIds,
  placementSizeOf,
  resolvePagePlacement,
  spanFromFreeformRect,
} from "../canvas";
import type { LayoutItem } from "@veladesk/desktop-engine";
import type {
  AppShortcut,
  DesktopPage,
  DesktopPageId,
  EntityId,
  Folder,
  WorkspaceSnapshot,
} from "../types";
import {
  findApp,
  findEntity,
  findFolder,
  isBlank,
  isOnAnyPage,
  withDock,
  withEntities,
  withFolder,
  withPage,
  withoutFolderChild,
  withoutPageItem,
} from "./shared";
import type { WorkspaceEditResult } from "./shared";

/**
 * ENTITY operations (P1 split of the former editing.ts monolith): create,
 * edit, move and delete apps/folders, the dock pin bookkeeping and the
 * folder dissolve/relocate flows. Every operation is immutable — failures
 * are values, never throws — and stages nothing: persistence is the
 * caller's concern.
 */

/**
 * Appends an app to a page as a canvas item, immutably.
 *
 * The entity id must not exist yet anywhere in the workspace (entity ids
 * are unique across kinds and pages) and the target page must exist. The
 * app's name and url must be non-blank after trimming (custom protocols
 * stay valid — urls are stored verbatim, never rewritten).
 *
 * A legacy grid page is materialized into canvas geometry first, so the
 * first production Add App upgrades that page. Placement never searches for
 * a free cell and never fails for space: canvas pages accept overlap, and
 * the default rect is one lattice cell at the next cascade position.
 */
export function addAppToPage(
  workspace: WorkspaceSnapshot,
  pageId: DesktopPageId,
  app: AppShortcut
): WorkspaceEditResult {
  if (workspace.entities.some((entity) => entity.id === app.id)) {
    return { ok: false, reason: "duplicate-entity-id" };
  }
  const page = findDesktopPage(workspace, pageId);
  if (page === undefined) {
    return { ok: false, reason: "page-not-found" };
  }
  if (isBlank(app.name)) {
    return { ok: false, reason: "invalid-name" };
  }
  if (isBlank(app.url)) {
    return { ok: false, reason: "invalid-url" };
  }
  const placed = placePageItem(page, app.id, { index: pageItemIds(page).length });
  return {
    ok: true,
    workspace: withPage(
      withEntities(workspace, [...workspace.entities, app]),
      pageId,
      placed
    ),
  };
}

/**
 * Appends an app directly into a folder, immutably.
 *
 * The app entity is appended to `entities` and its id to the folder's
 * `children` — no PageLayout item is created and the dock is not touched.
 * The app must have a non-blank trimmed name and url.
 */
export function addAppToFolder(
  workspace: WorkspaceSnapshot,
  folderId: EntityId,
  app: AppShortcut
): WorkspaceEditResult {
  if (workspace.entities.some((entity) => entity.id === app.id)) {
    return { ok: false, reason: "duplicate-entity-id" };
  }
  const folder = findFolder(workspace, folderId);
  if (folder === undefined) {
    return { ok: false, reason: "folder-not-found" };
  }
  if (isBlank(app.name)) {
    return { ok: false, reason: "invalid-name" };
  }
  if (isBlank(app.url)) {
    return { ok: false, reason: "invalid-url" };
  }
  return {
    ok: true,
    workspace: withFolder(
      withEntities(workspace, [...workspace.entities, app]),
      folder,
      { ...folder, children: [...folder.children, app.id] }
    ),
  };
}

/**
 * Creates a folder on a page, immutably.
 *
 * V1 folders are created empty (`children.length === 0`) — anything else is
 * a `folder-must-be-empty` failure. The folder takes the next canvas
 * cascade rect, exactly like an app.
 */
export function addFolderToPage(
  workspace: WorkspaceSnapshot,
  pageId: DesktopPageId,
  folder: Folder
): WorkspaceEditResult {
  if (workspace.entities.some((entity) => entity.id === folder.id)) {
    return { ok: false, reason: "duplicate-entity-id" };
  }
  if (folder.children.length > 0) {
    return { ok: false, reason: "folder-must-be-empty" };
  }
  if (isBlank(folder.name)) {
    return { ok: false, reason: "invalid-name" };
  }
  const page = findDesktopPage(workspace, pageId);
  if (page === undefined) {
    return { ok: false, reason: "page-not-found" };
  }
  const placed = placePageItem(page, folder.id, { index: pageItemIds(page).length });
  return {
    ok: true,
    workspace: withPage(
      withEntities(workspace, [...workspace.entities, folder]),
      pageId,
      placed
    ),
  };
}

/**
 * Replaces an existing app entity in place, immutably.
 *
 * Identity (`id`), position, folder containment, dock pin and entity
 * ordering are preserved; everything else comes from `nextApp` verbatim.
 * The name and url must be non-blank after trimming.
 */
export function replaceApp(
  workspace: WorkspaceSnapshot,
  nextApp: AppShortcut
): WorkspaceEditResult {
  const existing = findEntity(workspace, nextApp.id);
  if (existing === undefined || existing.kind !== "app") {
    return { ok: false, reason: "app-not-found" };
  }
  if (isBlank(nextApp.name)) {
    return { ok: false, reason: "invalid-name" };
  }
  if (isBlank(nextApp.url)) {
    return { ok: false, reason: "invalid-url" };
  }
  return {
    ok: true,
    workspace: withEntities(
      workspace,
      workspace.entities.map((entity) => (entity === existing ? nextApp : entity))
    ),
  };
}

/**
 * Renames a folder, storing the next name verbatim, immutably.
 * Children, placement, dock pin and entity ordering are untouched.
 */
export function renameFolder(
  workspace: WorkspaceSnapshot,
  folderId: EntityId,
  nextName: string
): WorkspaceEditResult {
  const folder = findFolder(workspace, folderId);
  if (folder === undefined) {
    return { ok: false, reason: "folder-not-found" };
  }
  if (isBlank(nextName)) {
    return { ok: false, reason: "invalid-name" };
  }
  return { ok: true, workspace: withFolder(workspace, folder, { ...folder, name: nextName }) };
}

/**
 * Moves an app into a folder: the true container move.
 *
 * The app id is removed from every page geometry source and every folder's
 * children, then appended to the target folder's children. The app entity
 * keeps its `entities` index and the dock is completely untouched — so a
 * pinned app stays pinned across page→folder and folder→folder moves.
 * Moving an app that is already in the target folder is an
 * `already-in-folder` failure.
 */
export function moveAppToFolder(
  workspace: WorkspaceSnapshot,
  appId: EntityId,
  folderId: EntityId
): WorkspaceEditResult {
  const app = findApp(workspace, appId);
  if (app === undefined) {
    return { ok: false, reason: "app-not-found" };
  }
  const folder = findFolder(workspace, folderId);
  if (folder === undefined) {
    return { ok: false, reason: "folder-not-found" };
  }
  if (folder.children.includes(appId)) {
    return { ok: false, reason: "already-in-folder" };
  }
  const removedFromLayouts = withoutPageItem(workspace, appId);
  const removedFromFolders = withoutFolderChild(removedFromLayouts, appId);
  const target = findFolder(removedFromFolders, folderId);
  if (target === undefined) {
    return { ok: false, reason: "folder-not-found" };
  }
  return {
    ok: true,
    workspace: withFolder(removedFromFolders, target, {
      ...target,
      children: [...target.children, appId],
    }),
  };
}

/**
 * Moves an app onto a page, immutably — the folder→desktop direction (and
 * unplaced→desktop). Apps already on ANY page are `already-on-page`. The
 * app takes the target page's next canvas cascade rect (a folder child has
 * no rect of its own to preserve); on success its id is removed from every
 * folder's children and the dock is untouched.
 */
export function moveAppToPage(
  workspace: WorkspaceSnapshot,
  appId: EntityId,
  pageId: DesktopPageId
): WorkspaceEditResult {
  const app = findApp(workspace, appId);
  if (app === undefined) {
    return { ok: false, reason: "app-not-found" };
  }
  const page = findDesktopPage(workspace, pageId);
  if (page === undefined) {
    return { ok: false, reason: "page-not-found" };
  }
  if (isOnAnyPage(workspace, appId)) {
    return { ok: false, reason: "already-on-page" };
  }
  const placed = placePageItem(page, appId, { index: pageItemIds(page).length });
  const removedFromFolders = withoutFolderChild(workspace, appId);
  return { ok: true, workspace: withPage(removedFromFolders, pageId, placed) };
}

/**
 * Deletes an app and every reference to it, immutably: the entity itself,
 * all canvas items, all legacy layout items, all folder children and the
 * dock pin — every container is cleared defensively, whichever geometry the
 * page uses. Categories are untouched (an app's categoryId dying with the
 * app never invalidates the category list).
 */
export function deleteApp(
  workspace: WorkspaceSnapshot,
  appId: EntityId
): WorkspaceEditResult {
  const app = findApp(workspace, appId);
  if (app === undefined) {
    return { ok: false, reason: "app-not-found" };
  }
  const withoutEntity = withEntities(
    workspace,
    workspace.entities.filter((entity) => entity.id !== appId)
  );
  const withoutLayouts = withoutPageItem(withoutEntity, appId);
  const withoutFolders = withoutFolderChild(withoutLayouts, appId);
  return {
    ok: true,
    workspace: withDock(withoutFolders, {
      items: withoutFolders.dock.items.filter((itemId) => itemId !== appId),
    }),
  };
}

/**
 * Pins an app or folder to the dock, immutably.
 *
 * The dock is an orthogonal reference list: pinning never touches the main
 * container (page item or folder membership). Widgets are not dockable in
 * V1. Pins always append — order is dock order, not editable here.
 */
export function pinEntityToDock(
  workspace: WorkspaceSnapshot,
  entityId: EntityId
): WorkspaceEditResult {
  const entity = findEntity(workspace, entityId);
  if (entity === undefined) {
    return { ok: false, reason: "entity-not-found" };
  }
  if (entity.kind === "widget") {
    return { ok: false, reason: "dock-kind-not-allowed" };
  }
  if (workspace.dock.items.includes(entityId)) {
    return { ok: false, reason: "already-pinned" };
  }
  return {
    ok: true,
    workspace: withDock(workspace, { items: [...workspace.dock.items, entityId] }),
  };
}

/**
 * Removes a dock pin, immutably. Only the reference is removed — the
 * entity and its main container are untouched.
 */
export function unpinEntityFromDock(
  workspace: WorkspaceSnapshot,
  entityId: EntityId
): WorkspaceEditResult {
  if (!workspace.dock.items.includes(entityId)) {
    return { ok: false, reason: "not-pinned" };
  }
  return {
    ok: true,
    workspace: withDock(workspace, {
      items: workspace.dock.items.filter((itemId) => itemId !== entityId),
    }),
  };
}

/**
 * Deletes a folder by dissolving it: the folder shell (entity, canvas item,
 * legacy layout item, dock pin) disappears and its child apps return to the
 * target page as visible canvas items — never as invisible unplaced data.
 *
 * The whole operation is atomic. Children keep their `children` order. When
 * the folder lived on the target page, its shell rect seeds the cascade, so
 * the first child lands where the folder was and the rest follow; otherwise
 * the children cascade after the items already on the page. Placement is
 * canvas-based and overlap is legal, so a dissolve can never fail for lack
 * of room. Child dock pins are preserved.
 */
export function dissolveFolderToPage(
  workspace: WorkspaceSnapshot,
  folderId: EntityId,
  targetPageId: DesktopPageId
): WorkspaceEditResult {
  const folder = findFolder(workspace, folderId);
  if (folder === undefined) {
    return { ok: false, reason: "folder-not-found" };
  }
  if (findDesktopPage(workspace, targetPageId) === undefined) {
    return { ok: false, reason: "page-not-found" };
  }

  const currentPage = workspace.pages.find((page) =>
    pageItemIds(page).includes(folderId)
  );
  // Dissolve anchor on the TARGET page only: the folder shell's rect
  // (freeform) or its column/row cell (Grid), from the resolved placement.
  let anchor: CanvasRect | undefined;
  let anchorCell: { column: number; row: number } | undefined;
  if (currentPage !== undefined && currentPage.id === targetPageId) {
    const placement = resolvePagePlacement(currentPage);
    const shell = findCanvasItem(placement, folderId);
    if (placement.mode === "grid") {
      if (shell !== undefined && !("rect" in shell)) {
        anchorCell = { column: shell.column, row: shell.row };
      }
    } else if (shell !== undefined && "rect" in shell) {
      anchor = shell.rect;
    }
  }

  // Working copy: strip the folder shell first, then place children one by
  // one against the accumulating page canvas.
  let working: WorkspaceSnapshot = withoutPageItem(workspace, folderId);
  working = withDock(working, {
    items: working.dock.items.filter((itemId) => itemId !== folderId),
  });
  working = withEntities(
    working,
    working.entities.filter((entity) => entity.id !== folderId)
  );

  const page = findDesktopPage(working, targetPageId);
  if (page === undefined) {
    return { ok: false, reason: "page-not-found" };
  }
  const baseIndex = anchor === undefined ? pageItemIds(page).length : 0;

  for (const [childIndex, childId] of folder.children.entries()) {
    if (findApp(working, childId) === undefined) {
      // A dangling or non-app child reference (invalid input) disappears
      // together with the folder that referenced it.
      continue;
    }
    const target = findDesktopPage(working, targetPageId);
    if (target === undefined) {
      return { ok: false, reason: "page-not-found" };
    }
    const placed = placePageItem(target, childId, {
      index: baseIndex + childIndex,
      ...(anchor === undefined ? {} : { anchor }),
      ...(anchorCell === undefined ? {} : { anchorCell }),
    });
    working = withPage(working, targetPageId, placed);
  }

  return { ok: true, workspace: working };
}

/**
 * Relocates an app to a page — the one true "move to section" op.
 *
 * Unlike `moveAppToPage` (folder→desktop direction, `already-on-page` for
 * any placed app), this op moves an app from ANYWHERE onto a page: the app
 * id is removed from every page geometry source and every folder's children
 * on a working copy, then appended as a canvas item on the target page. The
 * dock is completely untouched, so a pinned app stays pinned; the entity
 * array keeps every reference too — only geometry/folder references change.
 *
 * An app that already sits on the target page is `already-on-page`. Moving
 * from another canvas page PRESERVES the app's rect size, so a wide tile
 * moved from one section to another arrives wide; an app coming from a
 * legacy page, a folder or nowhere starts at the default cascade rect. The
 * target page is materialized when it was still a legacy grid page. Nothing
 * can fail for space — overlap is legal on canvas pages.
 */
export function relocateAppToPage(
  workspace: WorkspaceSnapshot,
  appId: EntityId,
  targetPageId: DesktopPageId
): WorkspaceEditResult {
  const app = findApp(workspace, appId);
  if (app === undefined) {
    return { ok: false, reason: "app-not-found" };
  }
  if (findDesktopPage(workspace, targetPageId) === undefined) {
    return { ok: false, reason: "page-not-found" };
  }
  const alreadyOnTarget = workspace.pages.some(
    (page) => page.id === targetPageId && pageItemIds(page).includes(appId)
  );
  if (alreadyOnTarget) {
    return { ok: false, reason: "already-on-page" };
  }

  const size = placementSizeOf(workspace.pages, appId);
  // Strip every geometry/folder reference first, then place against the
  // stripped working copy.
  const stripped = withoutFolderChild(withoutPageItem(workspace, appId), appId);
  const targetPage = findDesktopPage(stripped, targetPageId);
  if (targetPage === undefined) {
    return { ok: false, reason: "page-not-found" };
  }

  // Preserve geometry across the move: a span travels between Grid pages
  // (clamped into the target columns); a rect travels into freeform pages;
  // a freeform rect moving into a Grid page derives its span through the
  // target lattice. Either way the entity is never lost — worst case it
  // lands at the default 1x1.
  const targetPlacement = resolvePagePlacement(targetPage);
  const span =
    targetPlacement.mode === "grid"
      ? size !== undefined && size.kind === "span"
        ? size
        : size !== undefined && size.kind === "rect"
          ? spanFromFreeformRect(
              { x: 0, y: 0, width: size.width, height: size.height },
              targetPage.layout.grid,
            )
          : undefined
      : undefined;
  const rectSize =
    targetPlacement.mode === "freeform" && size !== undefined && size.kind === "rect"
      ? { width: size.width, height: size.height }
      : undefined;

  const placed = placePageItem(targetPage, appId, {
    index: pageItemIds(targetPage).length,
    ...(span === undefined ? {} : { span }),
    ...(rectSize === undefined ? {} : { size: rectSize }),
  });
  return { ok: true, workspace: withPage(stripped, targetPageId, placed) };
}

/**
 * Everything a delete-undo (UX-09) needs to put a deleted app back EXACTLY
 * where it was: the entity verbatim, its container (page item with the
 * captured geometry, or folder child slot), and its dock pin slot. The
 * entry is captured from the snapshot BEFORE `deleteApp` runs; both sides
 * of the pair are pure, so the capture and the restore never need to talk
 * to storage or the network.
 */
export interface DeletedAppRestoreEntry {
  readonly app: AppShortcut;
  /** The page the app was placed on; null when it lived inside a folder. */
  readonly pageId: DesktopPageId | null;
  /**
   * The captured canvas item (Grid v2 cell or freeform rect) with its exact
   * geometry and array slot, when the page had a canvas.
   */
  readonly canvasItem: CanvasLayoutItem | GridCanvasItem | null;
  readonly canvasIndex: number;
  /** The captured legacy layout item, when the page had no canvas yet. */
  readonly legacyItem: LayoutItem | null;
  /** The folder the app lived in; null when it was placed on a page. */
  readonly folderId: EntityId | null;
  readonly folderIndex: number;
  /** The dock slot the pin occupied; null when the app was not pinned. */
  readonly dockIndex: number | null;
}

/**
 * Captures the delete-undo entry for `appId` from `workspace` — call this
 * BEFORE `deleteApp`. Returns null when the app does not exist (nothing to
 * capture, nothing to restore).
 */
export function captureDeletedAppEntry(
  workspace: WorkspaceSnapshot,
  appId: EntityId,
): DeletedAppRestoreEntry | null {
  const app = findApp(workspace, appId);
  if (app === undefined) {
    return null;
  }
  let pageId: DesktopPageId | null = null;
  let canvasItem: CanvasLayoutItem | GridCanvasItem | null = null;
  let canvasIndex = 0;
  let legacyItem: LayoutItem | null = null;
  for (const page of workspace.pages) {
    if (!pageItemIds(page).includes(appId)) {
      continue;
    }
    pageId = page.id;
    if (page.canvas !== undefined) {
      const index = page.canvas.items.findIndex((item) => item.id === appId);
      if (index >= 0) {
        canvasItem = page.canvas.items[index]!;
        canvasIndex = index;
      }
    }
    const legacy = page.layout.items.find((item) => item.id === appId);
    if (legacy !== undefined) {
      legacyItem = legacy;
    }
    break;
  }
  let folderId: EntityId | null = null;
  let folderIndex = 0;
  const folder = workspace.entities.find(
    (entity): entity is Folder =>
      entity.kind === "folder" && entity.children.includes(appId),
  );
  if (folder !== undefined) {
    folderId = folder.id;
    folderIndex = folder.children.indexOf(appId);
  }
  return {
    app,
    pageId,
    canvasItem,
    canvasIndex,
    legacyItem,
    folderId,
    folderIndex,
    dockIndex: workspace.dock.items.includes(appId)
      ? workspace.dock.items.indexOf(appId)
      : null,
  };
}

/**
 * Restores a captured delete-undo entry onto `workspace`, immutably — the
 * exact inverse of the `deleteApp` that produced the entry: the entity
 * verbatim, the canvas/legacy item back at its array slot (so position,
 * size and order survive), the folder child back at its index and the dock
 * pin back at its slot.
 *
 * Fallbacks keep the restore total rather than precious: a captured
 * geometry whose canvas SHAPE no longer matches (the page switched
 * Grid↔Freeform after the delete) re-places through `placePageItem` the
 * same way a cross-mode move does — never loses the app. A FOLDER that
 * dissolved meanwhile keeps the restore total (the entity survives;
 * only the folder membership is unrecoverable in V1), while a PAGE that
 * disappeared refuses honestly (`page-not-found`). Overlap is legal, so
 * nothing can fail for space. Only a live duplicate id refuses.
 */
export function restoreDeletedApp(
  workspace: WorkspaceSnapshot,
  entry: DeletedAppRestoreEntry,
): WorkspaceEditResult {
  if (workspace.entities.some((entity) => entity.id === entry.app.id)) {
    return { ok: false, reason: "duplicate-entity-id" };
  }
  let next = withEntities(workspace, [...workspace.entities, entry.app]);

  if (entry.folderId !== null) {
    const folder = findFolder(next, entry.folderId);
    if (folder !== undefined) {
      const index = Math.min(entry.folderIndex, folder.children.length);
      const children = [...folder.children];
      children.splice(index, 0, entry.app.id);
      next = withFolder(next, folder, { ...folder, children });
    }
    // A dissolved folder cannot be resurrected here (V1 has no folder
    // restore); the app stays as an unplaced entity only if it also had no
    // page — the callers' capture always comes from a live container, so
    // this is the degenerate hand-written-entry case.
  } else if (entry.pageId !== null) {
    const page = findDesktopPage(next, entry.pageId);
    if (page === undefined) {
      return { ok: false, reason: "page-not-found" };
    }
    next = withPage(next, entry.pageId, restorePageItem(page, entry));
  }

  if (entry.dockIndex !== null && !next.dock.items.includes(entry.app.id)) {
    const items = [...next.dock.items];
    items.splice(Math.min(entry.dockIndex, items.length), 0, entry.app.id);
    next = withDock(next, { items });
  }
  return { ok: true, workspace: next };
}

/** Puts the entry's item back onto one page — exact geometry when the
 *  canvas shape still matches, the default placement otherwise. */
function restorePageItem(
  page: DesktopPage,
  entry: DeletedAppRestoreEntry,
): DesktopPage {
  const item = entry.canvasItem;
  if (page.canvas !== undefined && item !== null) {
    if (page.canvas.mode === "grid" && "column" in item) {
      const items = [...page.canvas.items] as GridCanvasItem[];
      items.splice(Math.min(entry.canvasIndex, items.length), 0, item);
      return { ...page, canvas: { ...page.canvas, items } };
    }
    if (page.canvas.mode !== "grid" && "rect" in item) {
      const items = [...page.canvas.items] as CanvasLayoutItem[];
      items.splice(Math.min(entry.canvasIndex, items.length), 0, item);
      return { ...page, canvas: { ...page.canvas, items } };
    }
  }
  const legacy = entry.legacyItem;
  if (page.canvas === undefined && legacy !== null && page.layout.items.every((existing) => existing.id !== entry.app.id)) {
    const items = [...page.layout.items];
    const index = items.findIndex((existing) => {
      const captured = legacy.position;
      return (
        existing.position.row > captured.row ||
        (existing.position.row === captured.row && existing.position.column > captured.column)
      );
    });
    items.splice(index < 0 ? items.length : index, 0, legacy);
    return { ...page, layout: { ...page.layout, items } };
  }
  // Geometry fallback (container reshaped or nothing captured): the same
  // placement path an ordinary add takes — never loses the app.
  return placePageItem(page, entry.app.id, { index: pageItemIds(page).length });
}

