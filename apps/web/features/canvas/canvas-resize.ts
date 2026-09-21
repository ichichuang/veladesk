import {
  canvasRectsEqual,
  gridItemsEqual,
  resizeCanvasRect,
  resizeGridItem,
} from "@veladesk/canvas-engine";
import type {
  CanvasRect,
  CanvasResizeHandle,
  GridCanvasItem,
  GridCanvasLayoutV2,
} from "@veladesk/canvas-engine";

import { pixelsToUnits } from "./canvas-metrics";
import type { CanvasPixelMetrics } from "./canvas-metrics";
import { pixelsToCellDelta } from "./square-grid-metrics";

/**
 * The eight resize handles of a single selection, in DOM order.
 *
 * Edge handles exist because both models allow real rectangles/cells:
 * changing one axis (columns only / rows only) must not require corner
 * dragging.
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

/** Integer cell geometry of one Grid item (id aside). */
export type GridItemGeometry = Omit<GridCanvasItem, "id">;

/** Everything a FREEFORM gesture needs, snapshotted at pointerdown. */
export interface FreeformResizeSession {
  readonly kind: "freeform";
  readonly handle: CanvasResizeHandle;
  readonly startRect: CanvasRect;
  readonly startPointerX: number;
  readonly startPointerY: number;
  readonly metrics: CanvasPixelMetrics;
}

/** Everything a GRID gesture needs, snapshotted at pointerdown. */
export interface GridResizeSession {
  readonly kind: "grid";
  readonly handle: CanvasResizeHandle;
  readonly itemId: string;
  readonly startGeometry: GridItemGeometry;
  readonly startPointerX: number;
  readonly startPointerY: number;
  /** Cell pitch — pointer pixels become whole cells through it. */
  readonly pitchPx: number;
  readonly columns: number;
}

export type CanvasResizeSession = FreeformResizeSession | GridResizeSession;

/** The geometry a finished gesture commits. */
export type ResizeCommitGeometry =
  | { readonly kind: "freeform"; readonly rect: CanvasRect }
  | { readonly kind: "grid"; readonly geometry: GridItemGeometry };

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
 * Live FREEFORM rect for the current pointer position.
 *
 * Pure: pixels → logical delta → `resizeCanvasRect`. Only the canvas bounds
 * and the minimum size clamp the result. Shift (`constrainAspect`) only
 * affects corners, inside the engine.
 */
export function canvasResizeRectAt(
  session: FreeformResizeSession,
  pointerX: number,
  pointerY: number,
  constrainAspect: boolean,
): CanvasRect {
  return resizeCanvasRect({
    start: session.startRect,
    handle: session.handle,
    deltaX: pixelsToUnits(pointerX - session.startPointerX, session.metrics.width),
    deltaY: pixelsToUnits(pointerY - session.startPointerY, session.metrics.height),
    constrainAspect,
  });
}

/**
 * Live GRID geometry for the current pointer position.
 *
 * Pointer pixels become whole-cell deltas through the pitch; the engine's
 * span semantics (min 1×1, edges never crossing, column bounds, unbounded
 * rows) do the rest. Shift is deliberately ignored: aspect locking is a
 * freeform behavior only, never ambiguous Grid spans.
 */
export function gridResizeGeometryAt(
  session: GridResizeSession,
  pointerX: number,
  pointerY: number,
): GridItemGeometry {
  const single: GridCanvasLayoutV2 = {
    version: 2,
    mode: "grid",
    columns: session.columns,
    items: [{ id: session.itemId, ...session.startGeometry }],
  };
  const resized = resizeGridItem(
    single,
    session.itemId,
    session.handle,
    pixelsToCellDelta(pointerX - session.startPointerX, session.pitchPx),
    pixelsToCellDelta(pointerY - session.startPointerY, session.pitchPx),
  );
  const item = resized.items[0];
  if (item === undefined) {
    return session.startGeometry;
  }
  return {
    column: item.column,
    row: item.row,
    columnSpan: item.columnSpan,
    rowSpan: item.rowSpan,
  };
}

/** True when a finished gesture would not change the geometry at all. */
export function isCanvasResizeNoop(
  start: ResizeCommitGeometry,
  next: ResizeCommitGeometry,
): boolean {
  if (start.kind === "freeform" && next.kind === "freeform") {
    return canvasRectsEqual(start.rect, next.rect);
  }
  if (start.kind === "grid" && next.kind === "grid") {
    return (
      start.geometry.column === next.geometry.column &&
      start.geometry.row === next.geometry.row &&
      start.geometry.columnSpan === next.geometry.columnSpan &&
      start.geometry.rowSpan === next.geometry.rowSpan
    );
  }
  return true;
}

/** Structural equality helper for Grid geometry previews. */
export function areGridGeometriesEqual(a: GridItemGeometry, b: GridItemGeometry): boolean {
  return gridItemsEqual({ id: "", ...a }, { id: "", ...b });
}
