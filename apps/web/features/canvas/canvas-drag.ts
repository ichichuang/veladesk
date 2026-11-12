import {
  clampCanvasTranslation,
  clampGridTranslation,
  displaceGridOverlaps,
  gridReflowPushOf,
  raiseCanvasItems,
  reflowGridOverlaps,
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

export function gridTranslationOf(args: CanvasDragArgs): {
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
    const translated = translateGridItems(args.placement, args.itemIds, columnDelta, rowDelta);
    // t129: the drop settles with the Apple-style reflow — bystanders the
    // dragged set landed on yield by cascading toward the vacated cells, so
    // the committed layout is EXACTLY the one the live preview showed.
    const push = gridReflowPushOf(columnDelta, rowDelta);
    return push === null ? translated : reflowGridOverlaps(translated, args.itemIds, push);
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

/**
 * The freeform drop's z-order commit (P1): item order is the stacking
 * order, so the tiles this drag actually moved rise to the top of the
 * canvas — overlap stays legal and the moved set never sinks beneath what
 * it crossed. Pure: order only, geometry unchanged. Snap mode never
 * reorders (geometry alone carries the drop).
 */
export function freeformRaisedPlacement(
  movedPlacement: PagePlacement,
  placementAtStart: PagePlacement,
): PagePlacement {
  if (movedPlacement.mode !== "freeform" || placementAtStart.mode !== "freeform") {
    return movedPlacement;
  }
  const movedIds = movedPlacement.items
    .map((item, index) => {
      const before = placementAtStart.items[index];
      return before !== undefined &&
        before.id === item.id &&
        (before.rect.x !== item.rect.x ||
          before.rect.y !== item.rect.y ||
          before.rect.width !== item.rect.width ||
          before.rect.height !== item.rect.height)
        ? item.id
        : null;
    })
    .filter((id): id is string => id !== null);
  return raiseCanvasItems(movedPlacement, movedIds) as PagePlacement;
}

/**
 * The live Apple-style reflow PREVIEW for a grid drag (t129): the bystanders
 * render at the cells they will occupy at commit — reflowed against the
 * dragged set's resolved target — while the dragged items themselves keep
 * their ORIGIN cells (the pointer-following source and the drop placeholder
 * carry the target; committing moves the dragged slots in one step that the
 * drop settle glides closed). Returns the input reference when the resolved
 * delta would reflow nothing, so the renderer can cheaply dedupe reports.
 * Pure; the same `reflowGridOverlaps` the commit runs guarantees preview and
 * commit agree cell for cell.
 */
export function gridReflowPreviewPlacement(args: CanvasDragArgs): PagePlacement {
  if (args.placement.mode !== "grid") {
    return args.placement;
  }
  const { columnDelta, rowDelta } = gridTranslationOf(args);
  const push = gridReflowPushOf(columnDelta, rowDelta);
  if (push === null) {
    return args.placement;
  }
  const dragged = new Set(args.itemIds);
  const startById = new Map(args.placement.items.map((item) => [item.id, item] as const));
  const reflowed = reflowGridOverlaps(
    translateGridItems(args.placement, args.itemIds, columnDelta, rowDelta),
    args.itemIds,
    push,
  );
  return {
    ...reflowed,
    items: reflowed.items.map((item) => {
      const origin = startById.get(item.id);
      return dragged.has(item.id) && origin !== undefined ? origin : item;
    }),
  };
}

/**
 * The GRID drop's settle commit (Helm r2, reflow since t129): the dragged
 * tiles keep exactly the cells the target feedback showed while bystanders
 * were already reflowed by {@link commitCanvasDrag}. This pass remains as
 * the NO-STACKING safety net — anything still under the dragged set (a
 * reflow budget fallback) is displaced to its nearest free cell, and an
 * overlap-free layout returns the input reference untouched.
 */
export function settledGridDropPlacement(
  movedPlacement: PagePlacement,
  placementAtStart: PagePlacement,
): PagePlacement {
  if (movedPlacement.mode !== "grid" || placementAtStart.mode !== "grid") {
    return movedPlacement;
  }
  const startById = new Map(
    placementAtStart.items.map((item) => [item.id, item] as const),
  );
  const movedIds = movedPlacement.items
    .filter((item) => {
      const before = startById.get(item.id);
      return (
        before === undefined ||
        before.column !== item.column ||
        before.row !== item.row ||
        before.columnSpan !== item.columnSpan ||
        before.rowSpan !== item.rowSpan
      );
    })
    .map((item) => item.id);
  return displaceGridOverlaps(movedPlacement, movedIds);
}
