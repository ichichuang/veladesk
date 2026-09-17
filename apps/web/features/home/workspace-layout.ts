import type { WorkspaceEditFailureReason, WorkspaceSnapshot } from "@veladesk/domain";
import type { GridPosition, PageLayout } from "@veladesk/desktop-engine";

/**
 * Web-side workspace layout editing on top of the domain editing
 * operations.
 *
 * `addAppToPage` is the domain implementation (re-exported so task 010
 * imports and tests keep working); `replacePageLayout` stays here because
 * it is the drag-commit entry point of the production shell.
 */

export { addAppToPage } from "@veladesk/domain";

/** Anchor of a new 1x1 app when no explicit position is desired. */
export const DEFAULT_APP_POSITION: GridPosition = { column: 0, row: 0 };

/** Why an immutable workspace layout edit refused to produce a new snapshot. */
export type WorkspaceLayoutEditFailureReason =
  | WorkspaceEditFailureReason
  | "layout-id-mismatch";

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

/**
 * Replaces one page's layout inside a workspace, immutably.
 *
 * The incoming layout must already carry the target page's id — a layout
 * whose `id` differs is rejected with `layout-id-mismatch` instead of
 * being written into the workspace (a dropped layout identity would break
 * the `layout.id === page.id` invariant). Every other page, and all
 * workspace-level fields, keep their exact references.
 */
export function replacePageLayout(
  workspace: WorkspaceSnapshot,
  pageId: string,
  nextLayout: PageLayout
): WorkspaceLayoutEditResult {
  if (nextLayout.id !== pageId) {
    return { ok: false, reason: "layout-id-mismatch" };
  }
  const pageIndex = workspace.pages.findIndex((page) => page.id === pageId);
  if (pageIndex < 0) {
    return { ok: false, reason: "page-not-found" };
  }
  const page = workspace.pages[pageIndex]!;
  const pages = workspace.pages.slice();
  pages[pageIndex] = { ...page, layout: nextLayout };
  return { ok: true, workspace: { ...workspace, pages } };
}
