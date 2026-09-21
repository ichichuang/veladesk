import {
  areCanvasLayoutsEqual,
} from "@veladesk/canvas-engine";
import type { PagePlacement } from "@veladesk/domain";
import type { DesktopPageId } from "@veladesk/domain";

/**
 * Session-only optimistic placement established the instant a move or a
 * resize is released, before any IndexedDB promise resolves, so the section
 * keeps showing the geometry the user just produced.
 *
 * Presentation state only: never written into a WorkspaceSnapshot,
 * IndexedDB, the server or localStorage. `token` is the generation guard —
 * a stale async completion must never clear a newer handoff.
 */
export interface PendingCanvasHandoff {
  readonly token: number;
  readonly pageId: DesktopPageId;
  readonly placement: PagePlacement;
}

/**
 * The placement a section renders right now: the pending handoff wins only
 * while it targets the active page, every other case renders the
 * authoritative placement.
 */
export function resolveDisplayPlacement(
  handoff: PendingCanvasHandoff | null,
  activePageId: DesktopPageId,
  authoritativePlacement: PagePlacement,
): PagePlacement {
  if (handoff === null || handoff.pageId !== activePageId) {
    return authoritativePlacement;
  }
  return handoff.placement;
}

/** True when the authoritative placement caught up (pixel-identical). */
export function isCanvasHandoffCaughtUp(
  handoff: PendingCanvasHandoff | null,
  authoritativePlacement: PagePlacement | undefined,
): boolean {
  if (handoff === null || authoritativePlacement === undefined) {
    return true;
  }
  return areCanvasLayoutsEqual(handoff.placement, authoritativePlacement);
}

/**
 * The single reconcile rule after every workspace change: keep the override
 * while the durable stage is still in flight and the placement really
 * differs; drop it once the authoritative placement matches, once the page
 * vanished, or once the attempt settled somewhere else (yield, never shadow
 * forever).
 */
export function reconcileCanvasHandoff(
  handoff: PendingCanvasHandoff | null,
  authoritativePlacement: PagePlacement | undefined,
  hasSettled: boolean,
): PendingCanvasHandoff | null {
  if (handoff === null || authoritativePlacement === undefined) {
    return null;
  }
  if (areCanvasLayoutsEqual(handoff.placement, authoritativePlacement)) {
    return null;
  }
  if (hasSettled) {
    return null;
  }
  return handoff;
}
