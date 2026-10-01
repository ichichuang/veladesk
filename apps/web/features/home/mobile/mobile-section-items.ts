import {
  findDesktopPage,
  pageItemIds,
  resolvePagePlacement,
} from "@veladesk/domain";
import type {
  DesktopPageId,
  EntityId,
  WorkspaceEntity,
  WorkspaceSnapshot,
} from "@veladesk/domain";

/**
 * Mobile section item derivation (task 026 §21/§22): the ONE pure
 * projection from a workspace page to the mobile consumption list.
 *
 * The mobile shell NEVER consumes desktop geometry — it renders a derived,
 * regular grid — but the ORDER still mirrors what the user arranged on the
 * desktop, so the reading direction stays familiar:
 *
 *  - Grid pages: top row → left column → stable id tie-break.
 *  - Freeform pages: top → left → stable id tie-break.
 *  - Widgets are quietly skipped (desktop-only presentation in v1; never
 *    deleted, never re-written back into the workspace).
 *  - Dangling member references (an entity removed elsewhere) are skipped.
 *
 * Pure: the input snapshot is never mutated, and no presentation state is
 * persisted — mobile layout is derived on every render (§20).
 */

/** One consumable item of a mobile section: an app or a folder. */
export interface MobileSectionItem {
  readonly kind: "app" | "folder";
  readonly entityId: EntityId;
}

export function resolveMobileSectionItems(input: {
  readonly workspace: WorkspaceSnapshot;
  readonly pageId: DesktopPageId | null;
}): readonly MobileSectionItem[] {
  const page =
    input.pageId === null
      ? undefined
      : findDesktopPage(input.workspace, input.pageId);
  if (page === undefined) {
    return [];
  }
  const placement = resolvePagePlacement(page);

  const orderedIds: EntityId[] =
    placement.mode === "grid"
      ? placement.items
          .map((item) => ({
            id: item.id,
            /** Visual reading order: row-major — top rows first, left first. */
            sortKey: `${String(item.row).padStart(6, "0")}:${String(item.column).padStart(6, "0")}`,
          }))
          .sort((a, b) => (a.sortKey === b.sortKey ? compareId(a.id, b.id) : a.sortKey < b.sortKey ? -1 : 1))
          .map((entry) => entry.id)
      : placement.items
          .map((item) => ({
            id: item.id,
            sortKey: `${String(Math.round(item.rect.y)).padStart(8, "0")}:${String(Math.round(item.rect.x)).padStart(8, "0")}`,
          }))
          .sort((a, b) => (a.sortKey === b.sortKey ? compareId(a.id, b.id) : a.sortKey < b.sortKey ? -1 : 1))
          .map((entry) => entry.id);

  const items: MobileSectionItem[] = [];
  for (const entityId of orderedIds) {
    const entity = input.workspace.entities.find(
      (candidate: WorkspaceEntity) => candidate.id === entityId,
    );
    if (entity === undefined || entity.kind === "widget") {
      continue;
    }
    items.push({ kind: entity.kind, entityId: entity.id });
  }
  return items;
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The members of a folder, in stored order, resolved to consumable apps —
 * the mobile folder sheet's single data source. Folder children are apps
 * only by domain contract; anything unresolvable is skipped, never
 * invented.
 */
export function resolveMobileFolderApps(
  workspace: WorkspaceSnapshot,
  folderId: EntityId | null,
): readonly { readonly app: WorkspaceEntity & { readonly kind: "app" } }[] {
  if (folderId === null) {
    return [];
  }
  const folder = workspace.entities.find(
    (entity) => entity.kind === "folder" && entity.id === folderId,
  );
  if (folder === undefined || folder.kind !== "folder") {
    return [];
  }
  const apps: { readonly app: WorkspaceEntity & { readonly kind: "app" } }[] = [];
  for (const childId of folder.children) {
    const child = workspace.entities.find((entity) => entity.id === childId);
    if (child !== undefined && child.kind === "app") {
      apps.push({ app: child });
    }
  }
  return apps;
}

/**
 * Membership sanity for the page contract (kept beside the resolver so
 * tests assert against the same membership source the desktop uses).
 */
export function mobilePageMemberCount(page: Parameters<typeof pageItemIds>[0]): number {
  return pageItemIds(page).length;
}
