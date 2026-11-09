import type { PagePlacementMode } from "@veladesk/canvas-engine";
import { findDesktopPage, resolvePagePlacement, switchPagePlacementMode } from "@veladesk/domain";
import type { DesktopPageId, PagePlacement, WorkspaceSnapshot } from "@veladesk/domain";

/**
 * The pure core of a placement-mode switch commit (P1), split out of
 * use-canvas-commits to keep that hook's file small: run the retained
 * -dataset domain op against the GIVEN snapshot (the queue's turn state —
 * the snapshot may have moved on since the click) and return the edited
 * snapshot plus the placement the display should hand off to. Null when
 * there is nothing to do (page gone, already in the target mode, or a
 * refused lossy first conversion — never silently compress or drop
 * geometry). The optimistic handoff, staging and history reset stay in
 * the hook.
 */
export function resolvePlacementSwitch(
  snapshot: WorkspaceSnapshot,
  pageId: DesktopPageId,
  next: PagePlacementMode,
): { readonly snapshot: WorkspaceSnapshot; readonly placement: PagePlacement } | null {
  const page = findDesktopPage(snapshot, pageId);
  if (page === undefined || resolvePagePlacement(page).mode === next) {
    return null;
  }
  const switched = switchPagePlacementMode(snapshot, pageId, next);
  if (!switched.ok) {
    return null;
  }
  return {
    snapshot: switched.workspace,
    placement: resolvePagePlacement(findDesktopPage(switched.workspace, pageId) ?? page),
  };
}
