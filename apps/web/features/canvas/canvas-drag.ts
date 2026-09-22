import {
  clampCanvasTranslation,
  clampGridTranslation,
  translateCanvasItems,
  translateGridItems,
} from "@veladesk/canvas-engine";
import type { PagePlacement } from "@veladesk/domain";

import { pixelsToUnits, unitsToPixels } from "./canvas-metrics";
import type { CanvasPixelMetrics } from "./canvas-metrics";
import { pixelsToCellDelta } from "./square-grid-metrics";

/**
 * Pure drag math for placed pages (task 017).
 *
 * Pointer pixels become either a continuous logical delta (freeform) or a
 * whole-cell delta (grid), and the engine resolves it into the renderable
 * translation. Both paths clamp ONE delta for the whole selection, so a
 * group never tears apart, and neither can be rejected by another item
 * (overlap stays legal).
 *
 * Presentation-only: nothing here stages or persists.
 */
export interface CanvasDragArgs {
  readonly placement: PagePlacement;
  readonly itemIds: readonly string[];
  /** Raw pointer translation since drag start, in CSS pixels. */
  readonly deltaX: number;
  readonly deltaY: number;
  /** Freeform: the canvas pixel box. Grid: unused. */
  readonly metrics: CanvasPixelMetrics;
  /** Grid: the cell pitch (cellPx + gapPx). Freeform: unused. */
  readonly pitchPx: number;
}

/** The translation to render/commit, plus its pixel form for previews. */
export interface CanvasDragPreview {
  readonly appliedX: number;
  readonly appliedY: number;
  /**
   * The resolved whole-cell delta (grid mode; 0 in freeform). Consumers that
   * need the logical cells — e.g. the target-slot feedback — read these
   * instead of dividing pixels back down.
   */
  readonly columnDelta: number;
  readonly rowDelta: number;
}

function gridTranslationOf(args: CanvasDragArgs): {
  readonly columnDelta: number;
  readonly rowDelta: number;
} {
  if (args.placement.mode !== "grid") {
    return { columnDelta: 0, rowDelta: 0 };
  }
  return clampGridTranslation(
    args.placement,
    args.itemIds,
    pixelsToCellDelta(args.deltaX, args.pitchPx),
    pixelsToCellDelta(args.deltaY, args.pitchPx),
  );
}

export function previewCanvasDrag(args: CanvasDragArgs): CanvasDragPreview {
  if (args.placement.mode === "grid") {
    const { columnDelta, rowDelta } = gridTranslationOf(args);
    return {
      appliedX: columnDelta * args.pitchPx,
      appliedY: rowDelta * args.pitchPx,
      columnDelta,
      rowDelta,
    };
  }

  const logicalX = pixelsToUnits(args.deltaX, args.metrics.width);
  const logicalY = pixelsToUnits(args.deltaY, args.metrics.height);
  // Continuous: the clamp is resolved ONCE for the whole selection, so a
  // group stops at the canvas edge as a rigid body instead of scattering
  // item by item.
  const translation = clampCanvasTranslation(args.placement, args.itemIds, logicalX, logicalY);

  return {
    appliedX: unitsToPixels(translation.x, args.metrics.width),
    appliedY: unitsToPixels(translation.y, args.metrics.height),
    columnDelta: 0,
    rowDelta: 0,
  };
}

/** True when the resolved translation of this drag is zero on both axes. */
export function isCanvasDragNoop(args: CanvasDragArgs): boolean {
  const preview = previewCanvasDrag(args);
  return preview.appliedX === 0 && preview.appliedY === 0;
}

/**
 * The committed placement for a finished drag, or `null` when the selection
 * would not move (no stage, no history entry, no sync).
 */
export function commitCanvasDrag(args: CanvasDragArgs): PagePlacement | null {
  if (isCanvasDragNoop(args)) {
    return null;
  }

  if (args.placement.mode === "grid") {
    const { columnDelta, rowDelta } = gridTranslationOf(args);
    return translateGridItems(args.placement, args.itemIds, columnDelta, rowDelta);
  }

  const logicalX = pixelsToUnits(args.deltaX, args.metrics.width);
  const logicalY = pixelsToUnits(args.deltaY, args.metrics.height);
  const translation = clampCanvasTranslation(args.placement, args.itemIds, logicalX, logicalY);
  return translateCanvasItems(
    args.placement,
    args.itemIds,
    translation.x,
    translation.y,
  ) as PagePlacement;
}
