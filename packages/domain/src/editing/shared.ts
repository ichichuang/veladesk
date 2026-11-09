import { removeCanvasItem } from "@veladesk/canvas-engine";

import { pageItemIds } from "../canvas";
import type {
  AppShortcut,
  DesktopPage,
  DesktopPageId,
  Dock,
  EntityId,
  Folder,
  WorkspaceEntity,
  WorkspaceSnapshot,
} from "../types";

/**
 * Shared internals of the workspace editing operations (P1 split of the
 * former editing.ts monolith): the failure/result vocabulary every op
 * speaks, and the immutable snapshot splices they compose from. Nothing
 * here is part of the package's public surface — the editing/ barrel
 * re-exports only the operations and the result types.
 */

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
  | "invalid-wallpaper"
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

export function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/** The entity with this id, or undefined. Entities are unique across kinds. */
export function findEntity(
  workspace: WorkspaceSnapshot,
  entityId: EntityId
): WorkspaceEntity | undefined {
  return workspace.entities.find((entity) => entity.id === entityId);
}

export function findFolder(
  workspace: WorkspaceSnapshot,
  folderId: EntityId
): Folder | undefined {
  const entity = findEntity(workspace, folderId);
  return entity !== undefined && entity.kind === "folder" ? entity : undefined;
}

export function findApp(
  workspace: WorkspaceSnapshot,
  appId: EntityId
): AppShortcut | undefined {
  const entity = findEntity(workspace, appId);
  return entity !== undefined && entity.kind === "app" ? entity : undefined;
}

export function withEntities(
  workspace: WorkspaceSnapshot,
  entities: readonly WorkspaceEntity[]
): WorkspaceSnapshot {
  return { ...workspace, entities };
}

export function withDock(workspace: WorkspaceSnapshot, dock: Dock): WorkspaceSnapshot {
  return { ...workspace, dock };
}

/** Replaces one folder entity in place (index preserved). */
export function withFolder(
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
export function withoutPageItem(
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
export function withPage(
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
export function isOnAnyPage(workspace: WorkspaceSnapshot, itemId: EntityId): boolean {
  return workspace.pages.some((page) => pageItemIds(page).includes(itemId));
}

/** Whether a page holds at least one item, from its authoritative source. */
export function hasPageItems(page: DesktopPage): boolean {
  return pageItemIds(page).length > 0;
}

/** Two id lists with the same members (order and duplicates aside). */
export function hasSameItemIds(left: readonly EntityId[], right: readonly EntityId[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

/** Folders with `appId` removed from every children list. */
export function withoutFolderChild(
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
