import {
  clampCanvasTranslation,
  snapCanvasTranslation,
  translateCanvasItems,
} from "@veladesk/canvas-engine";
import type { CanvasLayout, CanvasTranslation } from "@veladesk/canvas-engine";
import type { GridDefinition } from "@veladesk/desktop-engine";

import { pixelsToUnits, unitsToPixels } from "./canvas-metrics";
import type { CanvasPixelMetrics } from "./canvas-metrics";

/**
 * Pure drag math for canvas pages.
 *
 * Pointer pixels become a continuous logical delta; the geometry engine
 * resolves it into the renderable translation. Freeform translation is
 * continuous and overlap-friendly, `snap` resolves ONE delta for the whole
 * selection from a single anchor so a group never tears apart, and neither
 * path can be rejected by another item.
 *
 * Presentation-only: nothing here stages or persists.
 */
export interface CanvasDragArgs {
  readonly canvas: CanvasLayout;
  readonly itemIds: readonly string[];
  /** Raw pointer translation since drag start, in CSS pixels. */
  readonly deltaX: number;
  readonly deltaY: number;
  readonly metrics: CanvasPixelMetrics;
  readonly grid: GridDefinition;
}

/** The translation to render/commit, plus its pixel form for previews. */
export interface CanvasDragPreview {
  readonly translation: CanvasTranslation;
  readonly appliedX: number;
  readonly appliedY: number;
}

export function previewCanvasDrag(args: CanvasDragArgs): CanvasDragPreview {
  const logicalX = pixelsToUnits(args.deltaX, args.metrics.width);
  const logicalY = pixelsToUnits(args.deltaY, args.metrics.height);

  const translation =
    args.canvas.mode === "snap"
      ? snapCanvasTranslation(args.canvas, args.itemIds, logicalX, logicalY, args.grid)
      : // Continuous: the clamp is resolved ONCE for the whole selection, so
        // a group stops at the canvas edge as a rigid body instead of
        // scattering item by item.
        clampCanvasTranslation(args.canvas, args.itemIds, logicalX, logicalY);

  return {
    translation,
    appliedX: unitsToPixels(translation.x, args.metrics.width),
    appliedY: unitsToPixels(translation.y, args.metrics.height),
  };
}

/**
 * The committed canvas for a finished drag, or `null` when the selection
 * would not move (no stage, no history entry, no sync).
 */
export function commitCanvasDrag(args: CanvasDragArgs): CanvasLayout | null {
  const { translation } = previewCanvasDrag(args);
  if (translation.x === 0 && translation.y === 0) {
    return null;
  }
  return translateCanvasItems(args.canvas, args.itemIds, translation.x, translation.y);
}
