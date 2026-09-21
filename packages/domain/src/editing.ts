import {
  canvasItemIds,
  findCanvasItem,
  removeCanvasItem,
  validateCanvasLayout,
} from "@veladesk/canvas-engine";
import type { CanvasLayout, CanvasRect } from "@veladesk/canvas-engine";
import { validatePageLayout } from "@veladesk/desktop-engine";

import { findDesktopPage } from "./lookup";
import { validateWorkspaceAppearance } from "./appearance";
import { isValidGridGapPx } from "./preferences";
import {
  materializePagePlacement,
  pageItemIds,
  placePageItem,
  placementSizeOf,
  resolvePagePlacement,
  spanFromFreeformRect,
  withPageCanvas,
} from "./canvas";
import type {
  AppShortcut,
  DesktopPage,
  DesktopPageId,
  Dock,
  EntityId,
  Folder,
  WorkspaceEntity,
  WorkspacePreferences,
  WorkspaceSnapshot,
} from "./types";

/**
 * Why an immutable workspace editing operation refused to produce a new
 * snapshot. Ordinary edit failures are values, never throws.
 *
 * `no-space` belongs to the legacy grid vocabulary: a canvas page always
 * accepts another item (overlap is legal), so no canvas-aware operation can
 * report it.
 */
export type WorkspaceEditFailureReason =
  | "page-not-found"
  | "app-not-found"
  | "folder-not-found"
  | "entity-not-found"
  | "duplicate-entity-id"
  | "folder-must-be-empty"
  | "already-in-folder"
  | "already-on-page"
  | "no-space"
  | "already-pinned"
  | "not-pinned"
  | "dock-kind-not-allowed"
  | "invalid-name"
  | "invalid-url"
  | "default-page-not-found"
  | "invalid-appearance"
  | "invalid-grid-gap"
  | "duplicate-page-id"
  | "invalid-page-name"
  | "page-layout-id-mismatch"
  | "page-must-be-empty"
  | "invalid-page-layout"
  | "page-not-empty"
  | "cannot-delete-last-page"
  | "page-order-boundary";

/** Result of an immutable workspace editing operation. Failures keep the input. */
export type WorkspaceEditResult =
  | {
      readonly ok: true;
      readonly workspace: WorkspaceSnapshot;
    }
  | {
      readonly ok: false;
      readonly reason: WorkspaceEditFailureReason;
    };

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/** The entity with this id, or undefined. Entities are unique across kinds. */
function findEntity(
  workspace: WorkspaceSnapshot,
  entityId: EntityId
): WorkspaceEntity | undefined {
  return workspace.entities.find((entity) => entity.id === entityId);
}

function findFolder(
  workspace: WorkspaceSnapshot,
  folderId: EntityId
): Folder | undefined {
  const entity = findEntity(workspace, folderId);
  return entity !== undefined && entity.kind === "folder" ? entity : undefined;
}

function findApp(
  workspace: WorkspaceSnapshot,
  appId: EntityId
): AppShortcut | undefined {
  const entity = findEntity(workspace, appId);
  return entity !== undefined && entity.kind === "app" ? entity : undefined;
}

function withEntities(
  workspace: WorkspaceSnapshot,
  entities: readonly WorkspaceEntity[]
): WorkspaceSnapshot {
  return { ...workspace, entities };
}

function withDock(workspace: WorkspaceSnapshot, dock: Dock): WorkspaceSnapshot {
  return { ...workspace, dock };
}

/** Replaces one folder entity in place (index preserved). */
function withFolder(
  workspace: WorkspaceSnapshot,
  previous: Folder,
  next: Folder
): WorkspaceSnapshot {
  return withEntities(
    workspace,
    workspace.entities.map((entity) => (entity === previous ? next : entity))
  );
}

/**
 * Pages with `itemId` removed from every geometry source — canvas items and
 * legacy layout items alike, so a half-migrated page can never keep a stale
 * reference either way.
 */
function withoutPageItem(
  workspace: WorkspaceSnapshot,
  itemId: EntityId
): WorkspaceSnapshot {
  return {
    ...workspace,
    pages: workspace.pages.map((page) => {
      const stripped =
        page.canvas !== undefined && page.canvas.items.some((item) => item.id === itemId)
          ? { ...page, canvas: removeCanvasItem(page.canvas, itemId) }
          : page;

      return stripped.layout.items.some((item) => item.id === itemId)
        ? {
            ...stripped,
            layout: {
              ...stripped.layout,
              items: stripped.layout.items.filter((item) => item.id !== itemId),
            },
          }
        : stripped;
    }),
  };
}

/** Replaces one page in place (index preserved). */
function withPage(
  workspace: WorkspaceSnapshot,
  pageId: DesktopPageId,
  nextPage: DesktopPage
): WorkspaceSnapshot {
  return {
    ...workspace,
    pages: workspace.pages.map((page) => (page.id === pageId ? nextPage : page)),
  };
}

/** Whether any page — canvas or legacy — carries an item with this id. */
function isOnAnyPage(workspace: WorkspaceSnapshot, itemId: EntityId): boolean {
  return workspace.pages.some((page) => pageItemIds(page).includes(itemId));
}

/** Whether a page holds at least one item, from its authoritative source. */
function hasPageItems(page: DesktopPage): boolean {
  return pageItemIds(page).length > 0;
}



/** Two id lists with the same members (order and duplicates aside). */
function hasSameItemIds(left: readonly EntityId[], right: readonly EntityId[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

/** Folders with `appId` removed from every children list. */
function withoutFolderChild(
  workspace: WorkspaceSnapshot,
  appId: EntityId
): WorkspaceSnapshot {
  return withEntities(
    workspace,
    workspace.entities.map((entity) =>
      entity.kind === "folder" && entity.children.includes(appId)
        ? { ...entity, children: entity.children.filter((childId) => childId !== appId) }
        : entity
    )
  );
}

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

// ---------------------------------------------------------------------------
// Sections (DesktopPage CRUD) — task 015
// ---------------------------------------------------------------------------

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
