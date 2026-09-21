import {
  canvasRectToSnappedRect,
  canvasRectsEqual,
  resizeCanvasRect,
} from "@veladesk/canvas-engine";
import type {
  CanvasPlacementMode,
  CanvasRect,
  CanvasResizeHandle,
} from "@veladesk/canvas-engine";
import type { GridDefinition } from "@veladesk/desktop-engine";

import { pixelsToUnits } from "./canvas-metrics";
import type { CanvasPixelMetrics } from "./canvas-metrics";

/**
 * The eight resize handles of a single selection, in DOM order.
 *
 * Edge handles exist because the product allows real rectangles: changing
 * one axis (width only / height only) must not require corner dragging.
 */
export const CANVAS_RESIZE_HANDLES: readonly CanvasResizeHandle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

/** Everything a gesture needs, snapshotted at pointerdown. */
export interface CanvasResizeSession {
  readonly handle: CanvasResizeHandle;
  readonly startRect: CanvasRect;
  readonly startPointerX: number;
  readonly startPointerY: number;
  readonly metrics: CanvasPixelMetrics;
  readonly grid: GridDefinition;
  readonly mode: CanvasPlacementMode;
}

const HANDLE_CURSORS: Readonly<Record<CanvasResizeHandle, string>> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

export function canvasResizeCursor(handle: CanvasResizeHandle): string {
  return HANDLE_CURSORS[handle];
}

/**
 * Live rect for the current pointer position.
 *
 * Pure: pixels → logical delta → `resizeCanvasRect`. `snap` mode snaps the
 * PREVIEW too, so what the user sees while dragging is already what commits;
 * only canvas bounds and the minimum size clamp a freeform resize. Shift
 * (`constrainAspect`) only affects corners, inside the engine.
 */
export function canvasResizeRectAt(
  session: CanvasResizeSession,
  pointerX: number,
  pointerY: number,
  constrainAspect: boolean,
): CanvasRect {
  const resized = resizeCanvasRect({
    start: session.startRect,
    handle: session.handle,
    deltaX: pixelsToUnits(pointerX - session.startPointerX, session.metrics.width),
    deltaY: pixelsToUnits(pointerY - session.startPointerY, session.metrics.height),
    constrainAspect,
  });

  return session.mode === "snap" ? canvasRectToSnappedRect(resized, session.grid) : resized;
}

/** True when a finished gesture would not change the rect at all. */
export function isCanvasResizeNoop(start: CanvasRect, next: CanvasRect): boolean {
  return canvasRectsEqual(start, next);
}
