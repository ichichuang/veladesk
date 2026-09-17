import { findNearestFreePosition } from "@veladesk/desktop-engine";
import type { GridPosition, PageLayout } from "@veladesk/desktop-engine";
import { findDesktopPage } from "@veladesk/domain";
import type { AppShortcut, WorkspaceEntity, WorkspaceSnapshot } from "@veladesk/domain";

/** Why an immutable workspace layout edit refused to produce a new snapshot. */
export type WorkspaceLayoutEditFailureReason =
  | "page-not-found"
  | "duplicate-entity-id"
  | "no-space";

/** Result of an immutable workspace layout edit. Failures keep the input. */
export type WorkspaceLayoutEditResult =
  | {
      readonly ok: true;
      readonly workspace: WorkspaceSnapshot;
    }
  | {
      readonly ok: false;
      readonly reason: WorkspaceLayoutEditFailureReason;
    };

/** Anchor of a new 1x1 app when no explicit position is desired. */
export const DEFAULT_APP_POSITION: GridPosition = { column: 0, row: 0 };

/**
 * Replaces one page's layout inside a workspace, immutably.
 *
 * Every other page, and all workspace-level fields, keep their exact
 * references. A successful replacement keeps `layout.id === pageId` intact
 * (callers pass the layout they want stored — pass-through, no rewrite).
 */
export function replacePageLayout(
  workspace: WorkspaceSnapshot,
  pageId: string,
  nextLayout: PageLayout,
): WorkspaceLayoutEditResult {
  const pageIndex = workspace.pages.findIndex((page) => page.id === pageId);
  if (pageIndex < 0) {
    return { ok: false, reason: "page-not-found" };
  }
  const page = workspace.pages[pageIndex]!;
  const pages = workspace.pages.slice();
  pages[pageIndex] = { ...page, layout: nextLayout };
  return { ok: true, workspace: { ...workspace, pages } };
}

/**
 * Appends an app to a page as a 1x1 item, immutably.
 *
 * The entity id must not exist yet anywhere in the workspace (entity ids
 * are unique across kinds and pages), the target page must exist, and the
 * app must fit: the desired anchor (default top-left) is resolved with the
 * desktop engine's nearest-free placement against the page's CURRENT
 * layout. With no free cell the edit fails and the input stays untouched.
 *
 * On success the entity is appended to `entities` and a matching
 * `LayoutItem` is appended to the page's layout items, in that order.
 */
export function addAppToPage(
  workspace: WorkspaceSnapshot,
  pageId: string,
  app: AppShortcut,
  desiredPosition?: GridPosition,
): WorkspaceLayoutEditResult {
  if (workspace.entities.some((entity) => entity.id === app.id)) {
    return { ok: false, reason: "duplicate-entity-id" };
  }
  const page = findDesktopPage(workspace, pageId);
  if (page === undefined) {
    return { ok: false, reason: "page-not-found" };
  }

  const desired = desiredPosition ?? DEFAULT_APP_POSITION;
  const APP_SPAN = { columns: 1, rows: 1 } as const;
  const resolved = findNearestFreePosition({
    grid: page.layout.grid,
    items: page.layout.items,
    desired,
    span: APP_SPAN,
  });
  if (resolved === null) {
    return { ok: false, reason: "no-space" };
  }
  const layout: PageLayout = {
    ...page.layout,
    items: [
      ...page.layout.items,
      { id: app.id, position: resolved, span: APP_SPAN },
    ],
  };

  const entities: readonly WorkspaceEntity[] = [...workspace.entities, app];
  const pages = workspace.pages.map((candidate) =>
    candidate === page ? { ...candidate, layout } : candidate,
  );
  return { ok: true, workspace: { ...workspace, entities, pages } };
}
