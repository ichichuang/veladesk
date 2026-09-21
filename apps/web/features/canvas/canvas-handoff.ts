import { areCanvasLayoutsEqual } from "@veladesk/canvas-engine";
import type { CanvasLayout } from "@veladesk/canvas-engine";
import type { DesktopPageId } from "@veladesk/domain";

/**
 * Session-only optimistic canvas established the instant a move or a resize
 * is released, before any IndexedDB promise resolves, so the section keeps
 * showing the geometry the user just produced.
 *
 * Presentation state only: never written into a WorkspaceSnapshot,
 * IndexedDB, the server or localStorage. `token` is the generation guard —
 * a stale async completion must never clear a newer handoff.
 */
export interface PendingCanvasHandoff {
  readonly token: number;
  readonly pageId: DesktopPageId;
  readonly canvas: CanvasLayout;
}

/**
 * The canvas a section renders right now: the pending handoff wins only
 * while it targets the active page, every other case renders the
 * authoritative canvas.
 */
export function resolveDisplayCanvas(
  handoff: PendingCanvasHandoff | null,
  activePageId: DesktopPageId,
  authoritativeCanvas: CanvasLayout,
): CanvasLayout {
  if (handoff === null || handoff.pageId !== activePageId) {
    return authoritativeCanvas;
  }
  return handoff.canvas;
}

/** True when the authoritative canvas caught up (pixel-identical). */
export function isCanvasHandoffCaughtUp(
  handoff: PendingCanvasHandoff | null,
  authoritativeCanvas: CanvasLayout | undefined,
): boolean {
  if (handoff === null || authoritativeCanvas === undefined) {
    return true;
  }
  return areCanvasLayoutsEqual(handoff.canvas, authoritativeCanvas);
}

/**
 * The single reconcile rule after every workspace change: keep the override
 * while the durable stage is still in flight and the canvas really differs;
 * drop it once the authoritative canvas matches, once the page vanished, or
 * once the attempt settled somewhere else (yield, never shadow forever).
 */
export function reconcileCanvasHandoff(
  handoff: PendingCanvasHandoff | null,
  authoritativeCanvas: CanvasLayout | undefined,
  hasSettled: boolean,
): PendingCanvasHandoff | null {
  if (handoff === null || authoritativeCanvas === undefined) {
    return null;
  }
  if (areCanvasLayoutsEqual(handoff.canvas, authoritativeCanvas)) {
    return null;
  }
  if (hasSettled) {
    return null;
  }
  return handoff;
}
