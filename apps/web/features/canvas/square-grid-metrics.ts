import type { CSSProperties } from "react";
import type { GridCanvasItem } from "@veladesk/canvas-engine";

/**
 * Pure metrics of the responsive square Grid (task 017).
 *
 * The physical square size derives from the right-side grid content width —
 * never from the viewport height, and never re-deriving the persistent
 * column count:
 *
 *   cellPx = (availableWidthPx - gapPx * (columns - 1)) / columns
 *
 * The spec baseline (visual-directions A: 1×1 基准 96px) caps how large a
 * cell may grow on wide stages: `cellPx` clamps to `maxCellPx`, and the
 * content then no longer fills the stage — the frame centers it (see
 * home-shell.css). Everything the browser needs (drag pitch, resize pitch,
 * content height, the visible grid pattern) comes from cellPx + gapPx.
 * These helpers are pure: React rendering only consumes them, never
 * computes them.
 */

/**
 * The Helm r2 tile ceiling: a 1×1 tile never exceeds 112 CSS px (spec
 * band 96–112); narrow stages still shrink the cell below it.
 */
export const GRID_CELL_MAX_PX = 112;

/**
 * The layout-fill retune (Helm r4): the fluid band's WIDE ceiling. A
 * 2560-class stage plates cells up to 200px — the wide desktop stops
 * reading as a small tile island in a wide sea (see {@link fluidGridCellCap}).
 */
export const GRID_CELL_WIDE_MAX_PX = 200;

/**
 * Stage width divided by this yields the fluid cell target: one 1×1 tile
 * keeps roughly a tenth of the available width, so an 8-column grid fills
 * ≈91% of the stage at 1920 and ≈77% at 2560 (where the ceiling clamps).
 */
export const GRID_CELL_STAGE_DIVISOR = 9.5;

/**
 * The vertical resting point of the grid frame between the Helm header and
 * the dock (layout-fill): the share of the FREE vertical space that rides
 * ABOVE the content. 0.36 anchors the block at a stable upper-third-ish
 * spot — visually centered against the dawn band that owns the bottom
 * quarter, never floating low against the waterline. Pure view layer: the
 * stored row geometry is never touched.
 */
export const GRID_ANCHOR_TOP_SHARE = 0.36;

/** Inputs of {@link calculateSquareGridMetrics}. */
export interface SquareGridMetricsArgs {
  readonly availableWidthPx: number;
  readonly columns: number;
  readonly gapPx: number;
  /**
   * Ceiling for `cellPx` (spec baseline). Omit (or pass +Infinity) to let
   * the derived size fill the whole stage width, the pre-r2 behavior.
   */
  readonly maxCellPx?: number;
}

/** The physical geometry of one rendered Grid. */
export interface SquareGridMetrics {
  /** Side of one square cell in CSS pixels. */
  readonly cellPx: number;
  /** Distance between two cell origins: cellPx + gapPx. */
  readonly pitchPx: number;
  /**
   * columns * cellPx + (columns - 1) * gapPx — equals availableWidthPx while
   * the cell is width-derived; below it once `maxCellPx` clamps (the frame
   * centers the narrower content).
   */
  readonly contentWidthPx: number;
  /** The persisted gap input, echoed for style consumption. */
  readonly gapPx: number;
  /** The measured stage width the metrics derived from (the cap input). */
  readonly stageWidthPx: number;
  /** The measured stage height (the frame anchor's free-space input). */
  readonly stageHeightPx: number;
}

/**
 * The square metrics of a measured Grid stage, or `null` when the inputs
 * cannot produce a finite positive cell (not laid out yet, zero columns).
 */
export function calculateSquareGridMetrics(
  args: SquareGridMetricsArgs,
): SquareGridMetrics | null {
  const { availableWidthPx, columns, gapPx, maxCellPx } = args;

  if (
    !Number.isFinite(availableWidthPx) ||
    !Number.isFinite(gapPx) ||
    !Number.isSafeInteger(columns) ||
    columns <= 0 ||
    availableWidthPx <= 0 ||
    gapPx < 0
  ) {
    return null;
  }

  const derived = (availableWidthPx - gapPx * (columns - 1)) / columns;
  const ceiling =
    maxCellPx === undefined || !Number.isFinite(maxCellPx)
      ? Number.POSITIVE_INFINITY
      : Math.max(1, maxCellPx);
  const cellPx = Math.min(derived, ceiling);

  if (!Number.isFinite(cellPx) || cellPx <= 0) {
    return null;
  }

  return {
    cellPx,
    pitchPx: cellPx + gapPx,
    contentWidthPx: columns * cellPx + gapPx * (columns - 1),
    gapPx,
    stageWidthPx: availableWidthPx,
    stageHeightPx: 0,
  };
}

/**
 * The measured stage HEIGHT companion of
 * {@link calculateSquareGridMetrics}: the width-derived metrics plus the
 * observed client height, which the frame's vertical anchor needs (free
 * space = stage height − content height). Returns `null` on a non-positive
 * height (not laid out yet).
 */
export function withMeasuredStageHeight(
  metrics: SquareGridMetrics,
  stageHeightPx: number,
): SquareGridMetrics | null {
  if (!Number.isFinite(stageHeightPx) || stageHeightPx <= 0) {
    return null;
  }
  return metrics.stageHeightPx === stageHeightPx ? metrics : { ...metrics, stageHeightPx };
}

/**
 * The viewport-fluid cell ceiling (Helm r3, retuned for layout fill): the
 * spec band's 112px floor holds on laptop stages, and wide stages let the
 * cell breathe proportionally up to {@link GRID_CELL_WIDE_MAX_PX} — at
 * 1920 the cell plates ≈167px (≈91% stage fill for an 8-column grid), at
 * 2560 it saturates at 200px, so a wide screen stops reading as a small
 * tile island in a wide sea. The stage width is the input (it is
 * layout-fixed: the centered frame never feeds back into it), so one
 * re-measure after the first observation settles the value.
 */
export function fluidGridCellCap(stageWidthPx: number | null): number {
  if (stageWidthPx === null || !Number.isFinite(stageWidthPx) || stageWidthPx <= 0) {
    return GRID_CELL_MAX_PX;
  }
  return Math.min(
    GRID_CELL_WIDE_MAX_PX,
    Math.max(GRID_CELL_MAX_PX, Math.round(stageWidthPx / GRID_CELL_STAGE_DIVISOR)),
  );
}

/**
 * Pixel delta → whole-cell delta. Rounding happens here and only here, so a
 * drag/resize gesture always lands on integer row/column geometry.
 *
 * Halves round AWAY FROM ZERO, symmetric in both directions: the threshold
 * abs(delta) >= pitch/2 must move one cell in the drag's own direction —
 * Math.round's half-toward-+Infinity would strand westward/northward
 * half-pitch gestures. Zero normalizes to +0, never -0.
 */
export function pixelsToCellDelta(deltaPx: number, pitchPx: number): number {
  if (!Number.isFinite(deltaPx) || !Number.isFinite(pitchPx) || pitchPx <= 0) {
    return 0;
  }
  const cells = deltaPx / pitchPx;
  const rounded = cells >= 0 ? Math.round(cells) : -Math.round(-cells);
  return rounded === 0 ? 0 : rounded;
}

/** Pixel extent of a span: 2 cells are exactly `2 * cellPx + gapPx` wide. */
export function gridSpanExtentPx(span: number, cellPx: number, gapPx: number): number {
  const cells = Math.max(0, Math.trunc(span));
  return cells === 0 ? 0 : cells * cellPx + (cells - 1) * gapPx;
}

/** The greatest occupied row bottom: max(row + rowSpan), 0 when empty. */
export function gridContentRows(items: readonly GridCanvasItem[]): number {
  let max = 0;
  for (const item of items) {
    max = Math.max(max, item.row + item.rowSpan);
  }
  return max;
}

/** Content height of `rows` rows: rows * cellPx + (rows - 1) * gapPx. */
export function gridContentHeightPx(rows: number, cellPx: number, gapPx: number): number {
  const count = Math.max(0, Math.trunc(rows));
  return count === 0 ? 0 : count * cellPx + (count - 1) * gapPx;
}

/** The greatest occupied column edge: max(column + columnSpan), 0 when empty. */
export function gridContentColumns(items: readonly GridCanvasItem[]): number {
  let max = 0;
  for (const item of items) {
    max = Math.max(max, item.column + item.columnSpan);
  }
  return max;
}

/**
 * The width the centered frame shrink-wraps to (layout-fill): the span the
 * content ACTUALLY occupies — max(column + columnSpan) columns — not the
 * stored column count, so a sparse section centers by its real extent
 * instead of hugging the left of a full-width frame. An empty page keeps
 * the full stored width so the arrange lattice still paints the stage.
 */
export function gridFrameContentWidthPx(
  items: readonly GridCanvasItem[],
  columns: number,
  cellPx: number,
  gapPx: number,
): number {
  const occupied = gridContentColumns(items);
  return gridSpanExtentPx(occupied > 0 ? occupied : columns, cellPx, gapPx);
}

/**
 * The frame's top offset in the stage (layout-fill): the anchored share of
 * the FREE vertical space, so the content rests at a stable upper-third
 * point between the Helm header and the dock instead of floating
 * low-mid. `null` while the stage height is unmeasured (the CSS auto-
 * margin fallback centers, then one re-measure settles the anchor).
 * Over-long content top-aligns (offset 0) exactly as before.
 */
export function gridFrameTopOffsetPx(
  items: readonly GridCanvasItem[],
  stageHeightPx: number,
  cellPx: number,
  gapPx: number,
): number | null {
  if (!Number.isFinite(stageHeightPx) || stageHeightPx <= 0) {
    return null;
  }
  const contentHeightPx = gridContentHeightPx(gridContentRows(items), cellPx, gapPx);
  const freePx = Math.max(0, stageHeightPx - contentHeightPx);
  return freePx * GRID_ANCHOR_TOP_SHARE;
}

/**
 * CSS Grid placement of one item: 1-based line start plus an explicit span,
 * so a 2×1 item always covers exactly two columns.
 */
export function gridPlacementStyle(item: GridCanvasItem): CSSProperties {
  return {
    gridColumn: `${item.column + 1} / span ${item.columnSpan}`,
    gridRow: `${item.row + 1} / span ${item.rowSpan}`,
  };
}

/** True when two measured lengths agree within subpixel tolerance. */
export function isSubpixelEqual(a: number, b: number, tolerance = 1.1): boolean {
  return Math.abs(a - b) <= tolerance;
}
