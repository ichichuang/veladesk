import {
  clampCanvasTranslation,
  clampGridTranslation,
  displaceGridOverlaps,
  gridReflowPushOf,
  raiseCanvasItems,
  translateCanvasItems,
  yieldGridDragPlacement,
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
 * Boundary hysteresis for grid drags (t163), in cells: the pointer must
 * travel this far PAST the half-pitch boundary before the resolved slot
 * switches, and back out the same margin before it switches home again.
 * Half-pitch rounding alone switches at the same point in both directions,
 * so pointer jitter on a boundary retriggers the whole yield — the "乱跳"
 * report. 0.15 cells ≈ 17px at the 112px spec cell.
 */
export const GRID_DRAG_HYSTERESIS_CELLS = 0.15;

/** The sticky grid-drag state one session carries between frames (t163). */
export interface GridDragSessionState {
  /** The last RESOLVED (feasible) integer column delta. */
  readonly columnDelta: number;
  /** The last RESOLVED (feasible) integer row delta. */
  readonly rowDelta: number;
  /** The push axis the last frame used — keeps diagonal drags on one axis. */
  readonly axisHint: "column" | "row" | null;
}

/** One resolved grid drag: what the preview shows and the commit lands. */
export interface GridDragResolution {
  /** Dragged items at their resolved cells, bystanders yielded — legal. */
  readonly placement: PagePlacement;
  /**
   * The LIVE preview render: bystanders at their yielded cells while the
   * dragged slots stay at their origin (the pointer-following source and
   * the drop placeholder carry the target).
   */
  readonly previewPlacement: PagePlacement;
  readonly columnDelta: number;
  readonly rowDelta: number;
  /** The state the drag session should carry into the next frame. */
  readonly session: GridDragSessionState;
}

/**
 * Schmitt trigger on one axis (t163): the sticky integer only moves when the
 * raw cell position clears the half-pitch boundary by the hysteresis margin,
 * so jitter around a boundary can never toggle the resolved slot. Supports
 * multi-cell jumps (a fast fling crosses several boundaries at once).
 * Pure.
 */
function stickyCellDelta(rawCells: number, sticky: number): number {
  const h = GRID_DRAG_HYSTERESIS_CELLS;
  if (rawCells >= sticky + 0.5 + h) {
    return normalizeZero(Math.floor(rawCells + 0.5 + h));
  }
  if (rawCells <= sticky - 0.5 - h) {
    return normalizeZero(Math.ceil(rawCells - 0.5 - h));
  }
  return sticky;
}

/** Math.ceil/floor can produce −0; consumers compare with ===. */
function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * The infeasible-target walk (t163): try the wanted delta, then step it back
 * toward the drag origin — first on the push axis (the rubber-band keeps the
 * perpendicular component), then on the perpendicular axis — until the
 * engine reports a placement the bystanders can yield to cleanly. The origin
 * itself always terminates the walk, so a resolution always exists. Pure.
 */
function feasibleGridDelta(
  placement: PagePlacement & { mode: "grid" },
  itemIds: readonly string[],
  columnDelta: number,
  rowDelta: number,
  axisHint: "column" | "row" | null,
): { readonly columnDelta: number; readonly rowDelta: number } {
  const tryAt = (c: number, r: number) =>
    yieldGridDragPlacement(placement, itemIds, c, r, axisHint) !== null;
  const clamp = (c: number, r: number) => clampGridTranslation(placement, itemIds, c, r);

  let column = clamp(columnDelta, rowDelta).columnDelta;
  let row = clamp(columnDelta, rowDelta).rowDelta;
  if (tryAt(column, row)) {
    return { columnDelta: column, rowDelta: row };
  }

  // The push axis gives way first; the perpendicular axis keeps its delta as
  // long as it can (the drag stays as close to the pointer as possible).
  const push = gridReflowPushOf(column, row, axisHint);
  const axes: readonly ("column" | "row")[] =
    push?.axis === "row" ? ["row", "column"] : ["column", "row"];

  for (const axis of axes) {
    let value = axis === "column" ? column : row;
    while (value !== 0) {
      value += value > 0 ? -1 : 1;
      const candidate =
        axis === "column" ? clamp(value, row) : clamp(column, value);
      if (tryAt(candidate.columnDelta, candidate.rowDelta)) {
        return candidate;
      }
    }
    if (axis === "column") {
      column = 0;
    } else {
      row = 0;
    }
    const zeroed = clamp(column, row);
    if (tryAt(zeroed.columnDelta, zeroed.rowDelta)) {
      return zeroed;
    }
  }

  // Both axes exhausted: the drag resolves home (always feasible).
  return { columnDelta: 0, rowDelta: 0 };
}

/**
 * Resolves one grid-drag frame (t163): the sticky Schmitt deltas from the raw
 * pointer, the bounds clamp, and the feasibility walk — ending in the
 * placement the preview renders and the commit lands, guaranteed legal
 * (no overlaps, in bounds) and identical between preview and commit because
 * both run this one pure function on the same inputs.
 *
 * `session` carries the previous frame's sticky state; without it the
 * resolution starts from plain half-away-from-zero rounding (a fresh drag).
 */
export function resolveGridDragPlacement(
  args: CanvasDragArgs,
  session: GridDragSessionState | null,
): GridDragResolution {
  if (args.placement.mode !== "grid") {
    throw new Error("resolveGridDragPlacement: placement must be a grid placement");
  }
  const pitch = args.pitchPx > 0 ? args.pitchPx : 1;
  const rawColumn = args.deltaX / pitch;
  const rawRow = args.deltaY / pitch;
  const stickyColumn = stickyCellDelta(
    rawColumn,
    session?.columnDelta ?? pixelsToCellDelta(args.deltaX, pitch),
  );
  const stickyRow = stickyCellDelta(
    rawRow,
    session?.rowDelta ?? pixelsToCellDelta(args.deltaY, pitch),
  );
  const axisHint = session?.axisHint ?? null;

  const feasible = feasibleGridDelta(
    args.placement,
    args.itemIds,
    stickyColumn,
    stickyRow,
    axisHint,
  );
  const yielded = yieldGridDragPlacement(
    args.placement,
    args.itemIds,
    feasible.columnDelta,
    feasible.rowDelta,
    axisHint,
  );
  // feasibleGridDelta only returns deltas the engine accepted, so this is
  // never null here; (0,0) is the always-feasible identity.
  const placement = (yielded?.layout ?? args.placement) as PagePlacement;

  const byStart = new Map(args.placement.items.map((item) => [item.id, item] as const));
  const dragged = new Set(args.itemIds);
  const previewPlacement =
    feasible.columnDelta === 0 && feasible.rowDelta === 0
      ? args.placement
      : ({
          ...placement,
          items: placement.items.map((item) => {
            const origin = byStart.get(item.id);
            return dragged.has(item.id) && origin !== undefined ? origin : item;
          }),
        } as PagePlacement);

  return {
    placement,
    previewPlacement,
    columnDelta: feasible.columnDelta,
    rowDelta: feasible.rowDelta,
    session: {
      columnDelta: feasible.columnDelta,
      rowDelta: feasible.rowDelta,
      axisHint: yielded?.push?.axis ?? axisHint,
    },
  };
}

/**
 * The committed placement for a finished drag, or `null` when the selection
 * would not move (no stage, no history entry, no sync).
 *
 * Grid drags pass the SESSION state the live preview resolved with, so the
 * commit is the exact placement the preview showed (t163 preview-commit
 * consistency); without it the resolution starts fresh from the raw release
 * delta (still the same pure resolver).
 */
export function commitCanvasDrag(
  args: CanvasDragArgs,
  session?: GridDragSessionState | null,
): PagePlacement | null {
  if (args.placement.mode === "grid") {
    const resolution = resolveGridDragPlacement(args, session ?? null);
    if (resolution.columnDelta === 0 && resolution.rowDelta === 0) {
      return null;
    }
    return resolution.placement;
  }

  if (isCanvasDragNoop(args)) {
    return null;
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
 * The live Apple-style reflow PREVIEW for a grid drag (t129, retuned t163):
 * the bystanders render at the cells they will occupy at commit — yielded
 * against the dragged set's resolved target — while the dragged items
 * themselves keep their ORIGIN cells (the pointer-following source and the
 * drop placeholder carry the target; committing moves the dragged slots in
 * one step that the drop settle glides closed). Returns the input reference
 * when the resolved delta would reflow nothing, so the renderer can cheaply
 * dedupe reports. Pure; the same {@link resolveGridDragPlacement} the commit
 * runs guarantees preview and commit agree cell for cell.
 */
export function gridReflowPreviewPlacement(args: CanvasDragArgs): PagePlacement {
  if (args.placement.mode !== "grid") {
    return args.placement;
  }
  return resolveGridDragPlacement(args, null).previewPlacement;
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
