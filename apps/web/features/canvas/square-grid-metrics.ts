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
 * Everything the browser needs (drag pitch, resize pitch, content height,
 * the visible grid pattern) comes from cellPx + gapPx. These helpers are
 * pure: React rendering only consumes them, never computes them.
 */

/** Inputs of {@link calculateSquareGridMetrics}. */
export interface SquareGridMetricsArgs {
  readonly availableWidthPx: number;
  readonly columns: number;
  readonly gapPx: number;
}

/** The physical geometry of one rendered Grid. */
export interface SquareGridMetrics {
  /** Side of one square cell in CSS pixels. */
  readonly cellPx: number;
  /** Distance between two cell origins: cellPx + gapPx. */
  readonly pitchPx: number;
  /** columns * cellPx + (columns - 1) * gapPx — equals availableWidthPx. */
  readonly contentWidthPx: number;
  /** The persisted gap input, echoed for style consumption. */
  readonly gapPx: number;
}

/**
 * The square metrics of a measured Grid stage, or `null` when the inputs
 * cannot produce a finite positive cell (not laid out yet, zero columns).
 */
export function calculateSquareGridMetrics(
  args: SquareGridMetricsArgs,
): SquareGridMetrics | null {
  const { availableWidthPx, columns, gapPx } = args;

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

  const cellPx = (availableWidthPx - gapPx * (columns - 1)) / columns;

  if (!Number.isFinite(cellPx) || cellPx <= 0) {
    return null;
  }

  return {
    cellPx,
    pitchPx: cellPx + gapPx,
    contentWidthPx: columns * cellPx + gapPx * (columns - 1),
    gapPx,
  };
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
