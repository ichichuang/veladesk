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

/**
 * The Grid size system (visual-directions-p1.md §规范要点): tile sizes step
 * through 1×1 / 2×1 / 2×2 / 4×2 — never arbitrary spans. A live resize
 * snaps its span box to the nearest step (both axes at once; distance in
 * cells), clamped into the page's column count.
 */
export const GRID_SIZE_STEPS: readonly { readonly w: number; readonly h: number }[] = [
  { w: 1, h: 1 },
  { w: 2, h: 1 },
  { w: 2, h: 2 },
  { w: 4, h: 2 },
];

/** The step whose cell box is nearest to the desired span (stable order). */
export function snapSpanToSizeStep(
  desired: { readonly w: number; readonly h: number },
  columns: number,
): { readonly w: number; readonly h: number } {
  let best = GRID_SIZE_STEPS[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const step of GRID_SIZE_STEPS) {
    const w = Math.min(step.w, Math.max(1, columns));
    const distance = Math.abs(w - desired.w) + Math.abs(step.h - desired.h);
    if (distance < bestDistance) {
      best = { w, h: step.h };
      bestDistance = distance;
    }
  }
  return best;
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
    // Freeform is a downward-unbounded document (t63): the `s`/`se`/`sw`
    // handles may grow a tile past the first viewport's bottom edge, and an
    // item already below it is never dragged back up by the clamp.
    unboundedBelow: true,
  });
}

/**
 * Live GRID geometry for the current pointer position (t77).
 *
 * Pointer pixels become whole-cell deltas through the pitch — PAST HALF A
 * CELL the geometry carries (过半格即进位) — and the engine's span
 * semantics (min 1×1, edges never crossing, column bounds, unbounded rows)
 * do the rest: EVERY integer span is reachable, never a size-step
 * quantization. The handle center sits ON the moving edge (18px handles
 * straddle it), so the raw pointer delta IS the edge delta and the preview
 * edge tracks the pointer within half a pitch on every axis. Shift is
 * deliberately ignored: aspect locking is a freeform behavior only, never
 * ambiguous Grid spans.
 */
export function gridResizeGeometryAt(
  session: GridResizeSession,
  pointerX: number,
  pointerY: number,
): GridItemGeometry {
  // A gesture that never moved (a handle click) keeps the start geometry —
  // the cell rounding must never commit a change the user did not make.
  if (pointerX === session.startPointerX && pointerY === session.startPointerY) {
    return session.startGeometry;
  }
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
  // The engine already moves the origin WITH the dragged edge for w/n
  // handles and keeps the far corner anchored for e/s — the per-cell
  // result IS the preview, no post-hoc origin math.
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
