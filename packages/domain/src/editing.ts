import { findNearestFreePosition, validatePageLayout } from "@veladesk/desktop-engine";
import type { GridPosition, LayoutItem, PageLayout } from "@veladesk/desktop-engine";

import { findDesktopPage } from "./lookup";
import { validateWorkspaceAppearance } from "./appearance";
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

const APP_SPAN = { columns: 1, rows: 1 } as const;
const DEFAULT_POSITION: GridPosition = { column: 0, row: 0 };

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

/** Page layouts with `itemId` removed from every page's items. */
function withoutLayoutItem(
  workspace: WorkspaceSnapshot,
  itemId: EntityId
): WorkspaceSnapshot {
  return {
    ...workspace,
    pages: workspace.pages.map((page) =>
      page.layout.items.some((item) => item.id === itemId)
        ? { ...page, layout: { ...page.layout, items: page.layout.items.filter((item) => item.id !== itemId) } }
        : page
    ),
  };
}

/** Whether any page layout carries an item with this id. */
function isOnAnyPage(workspace: WorkspaceSnapshot, itemId: EntityId): boolean {
  return workspace.pages.some((page) =>
    page.layout.items.some((item) => item.id === itemId)
  );
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
 * Places a 1x1 item on a page layout, immutably: nearest-free resolution
 * from the desired anchor. Returns undefined when the grid has no room.
 */
function placeItem(
  layout: PageLayout,
  itemId: EntityId,
  desired: GridPosition
): LayoutItem | undefined {
  const resolved = findNearestFreePosition({
    grid: layout.grid,
    items: layout.items,
    desired,
    span: APP_SPAN,
  });
  if (resolved === null) {
    return undefined;
  }
  return { id: itemId, position: resolved, span: APP_SPAN };
}

function withLayoutItem(
  workspace: WorkspaceSnapshot,
  pageId: DesktopPageId,
  item: LayoutItem
): WorkspaceSnapshot {
  return {
    ...workspace,
    pages: workspace.pages.map((page) =>
      page.id === pageId
        ? { ...page, layout: { ...page.layout, items: [...page.layout.items, item] } }
        : page
    ),
  };
}

/**
 * Appends an app to a page as a 1x1 item, immutably.
 *
 * The entity id must not exist yet anywhere in the workspace (entity ids
 * are unique across kinds and pages) and the target page must exist. The
 * app's name and url must be non-blank after trimming (custom protocols
 * stay valid — urls are stored verbatim, never rewritten). The desired
 * anchor (default top-left) is resolved with the desktop engine's
 * nearest-free placement against the page's CURRENT layout; with no free
 * cell the edit fails and the input stays untouched. On success the entity
 * is appended to `entities` and a matching `LayoutItem` is appended to the
 * page's layout items.
 */
export function addAppToPage(
  workspace: WorkspaceSnapshot,
  pageId: DesktopPageId,
  app: AppShortcut,
  desiredPosition?: GridPosition
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
  const item = placeItem(page.layout, app.id, desiredPosition ?? DEFAULT_POSITION);
  if (item === undefined) {
    return { ok: false, reason: "no-space" };
  }
  return {
    ok: true,
    workspace: withLayoutItem(withEntities(workspace, [...workspace.entities, app]), pageId, item),
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
 * a `folder-must-be-empty` failure. The folder gets a 1x1 nearest-free
 * placement like an app.
 */
export function addFolderToPage(
  workspace: WorkspaceSnapshot,
  pageId: DesktopPageId,
  folder: Folder,
  desiredPosition?: GridPosition
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
  const item = placeItem(page.layout, folder.id, desiredPosition ?? DEFAULT_POSITION);
  if (item === undefined) {
    return { ok: false, reason: "no-space" };
  }
  return {
    ok: true,
    workspace: withLayoutItem(
      withEntities(workspace, [...workspace.entities, folder]),
      pageId,
      item
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
 * The app id is removed from every PageLayout and every folder's children,
 * then appended to the target folder's children. The app entity keeps its
 * `entities` index and the dock is completely untouched — so a pinned app
 * stays pinned across page→folder and folder→folder moves. Moving an app
 * that is already in the target folder is an `already-in-folder` failure.
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
  const removedFromLayouts = withoutLayoutItem(workspace, appId);
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
 * unplaced→desktop). Apps already on ANY page are `already-on-page`; the
 * desired anchor (default top-left) is resolved nearest-free on the target
 * page first, and `no-space` leaves the input completely unchanged. On
 * success the app id is removed from every folder's children; the dock is
 * untouched.
 */
export function moveAppToPage(
  workspace: WorkspaceSnapshot,
  appId: EntityId,
  pageId: DesktopPageId,
  desiredPosition?: GridPosition
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
  const item = placeItem(page.layout, appId, desiredPosition ?? DEFAULT_POSITION);
  if (item === undefined) {
    return { ok: false, reason: "no-space" };
  }
  const removedFromFolders = withoutFolderChild(workspace, appId);
  return { ok: true, workspace: withLayoutItem(removedFromFolders, pageId, item) };
}

/**
 * Deletes an app and every reference to it, immutably: the entity itself,
 * all page layout items, all folder children and the dock pin. Categories
 * are untouched (an app's categoryId dying with the app never invalidates
 * the category list).
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
  const withoutLayouts = withoutLayoutItem(withoutEntity, appId);
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
  return { ok: true, workspace: { ...workspace, preferences: nextPreferences } };
}

/**
 * Deletes a folder by dissolving it: the folder shell (entity, layout
 * item, dock pin) disappears and its child apps return to the target page
 * as visible 1x1 items — never as invisible unplaced data.
 *
 * The whole operation is atomic. Children keep their `children` order;
 * each child is placed nearest-free from the folder's original anchor when
 * the folder lived on the target page (else from the top-left), and every
 * placement sees the cells the previous children took. Child dock pins are
 * preserved. Any child that does not fit fails the whole dissolve with
 * `no-space` and leaves the input untouched.
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
  const currentPage = workspace.pages.find((page) =>
    page.layout.items.some((item) => item.id === folderId)
  );
  const targetPage = findDesktopPage(workspace, targetPageId);
  if (targetPage === undefined) {
    return { ok: false, reason: "page-not-found" };
  }

  const desired: GridPosition =
    currentPage !== undefined && currentPage.id === targetPageId
      ? (currentPage.layout.items.find((item) => item.id === folderId)?.position ??
        DEFAULT_POSITION)
      : DEFAULT_POSITION;

  // Working copy: strip the folder shell first, then place children one by
  // one against the accumulating layout.
  let working: WorkspaceSnapshot = withoutLayoutItem(workspace, folderId);
  working = withDock(working, {
    items: working.dock.items.filter((itemId) => itemId !== folderId),
  });
  working = withEntities(
    working,
    working.entities.filter((entity) => entity.id !== folderId)
  );

  const placedItems: LayoutItem[] = [];
  for (const childId of folder.children) {
    const child = findApp(working, childId);
    if (child === undefined) {
      // A dangling or non-app child reference (invalid input) disappears
      // together with the folder that referenced it.
      continue;
    }
    const item = placeItem(working.pages.find((page) => page.id === targetPageId)!.layout, childId, desired);
    if (item === undefined) {
      return { ok: false, reason: "no-space" };
    }
    placedItems.push(item);
    working = withLayoutItem(working, targetPageId, item);
  }
  return { ok: true, workspace: working };
}

// ---------------------------------------------------------------------------
// Sections (DesktopPage CRUD) — task 015
// ---------------------------------------------------------------------------

/** The page layout carrying at least one item. */
function isNonEmptyLayout(page: DesktopPage): boolean {
  return page.layout.items.length > 0;
}

/**
 * Appends an empty page (a user-facing Section) to the workspace, immutably.
 *
 * The id must be unique, the name non-blank after trimming, the layout id
 * must equal the page id, the layout must hold no items, and the grid must
 * pass the desktop engine's semantic validation. On success ONLY
 * `workspace.pages` grows — entities, categories, dock and preferences keep
 * their exact references.
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
  if (isNonEmptyLayout(page)) {
    return { ok: false, reason: "page-must-be-empty" };
  }
  if (validatePageLayout(page.layout).length > 0) {
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
 * Only a page whose layout holds no items can be deleted, and at least one
 * page must survive (`page-not-empty` / `cannot-delete-last-page`). When the
 * deleted page was the default, the default moves to the NEXT page — the
 * one at the deleted position — or, at the end of the array, to the previous
 * page; that matches where the user is looking better than always falling
 * back to `pages[0]`.
 */
export function deleteEmptyPage(
  workspace: WorkspaceSnapshot,
  pageId: DesktopPageId
): WorkspaceEditResult {
  const page = findDesktopPage(workspace, pageId);
  if (page === undefined) {
    return { ok: false, reason: "page-not-found" };
  }
  if (isNonEmptyLayout(page)) {
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
 * id is removed from every page layout and every folder's children on a
 * working copy, then placed 1x1 nearest-free on the target page. The dock is
 * completely untouched, so a pinned app stays pinned; the entity array keeps
 * every reference too — only layout/folder references change. An app that
 * already sits on the target page is `already-on-page`; a full target page
 * fails atomically with `no-space` (the input is returned untouched, never
 * half-moved).
 */
export function relocateAppToPage(
  workspace: WorkspaceSnapshot,
  appId: EntityId,
  targetPageId: DesktopPageId,
  desiredPosition?: GridPosition
): WorkspaceEditResult {
  const app = findApp(workspace, appId);
  if (app === undefined) {
    return { ok: false, reason: "app-not-found" };
  }
  if (findDesktopPage(workspace, targetPageId) === undefined) {
    return { ok: false, reason: "page-not-found" };
  }
  const alreadyOnTarget = workspace.pages.some(
    (page) => page.id === targetPageId && page.layout.items.some((item) => item.id === appId)
  );
  if (alreadyOnTarget) {
    return { ok: false, reason: "already-on-page" };
  }
  // Strip every layout/folder reference first, then place against the
  // stripped working copy. A `no-space` below abandons the copy entirely.
  const stripped = withoutFolderChild(withoutLayoutItem(workspace, appId), appId);
  const targetPage = findDesktopPage(stripped, targetPageId);
  if (targetPage === undefined) {
    return { ok: false, reason: "page-not-found" };
  }
  const item = placeItem(targetPage.layout, appId, desiredPosition ?? DEFAULT_POSITION);
  if (item === undefined) {
    return { ok: false, reason: "no-space" };
  }
  return { ok: true, workspace: withLayoutItem(stripped, targetPageId, item) };
}
