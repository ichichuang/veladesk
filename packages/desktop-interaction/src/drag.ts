import type { GridPosition } from "@veladesk/desktop-engine";
import type {
  DragDeltaToPositionArgs,
  GridPixelMetrics,
} from "./types";

function requireFinite(name: string, value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, received: ${value}`);
  }
  return value;
}

function requirePositive(name: string, value: number): number {
  requireFinite(name, value);
  if (value <= 0) {
    throw new RangeError(`${name} must be > 0, received: ${value}`);
  }
  return value;
}

function requireNonNegative(name: string, value: number): number {
  requireFinite(name, value);
  if (value < 0) {
    throw new RangeError(`${name} must be >= 0, received: ${value}`);
  }
  return value;
}

/**
 * Guards against metrics values that could never come out of
 * {@link calculateGridPixelMetrics} — a hand-built or stale object must fail
 * loudly instead of producing NaN cells downstream.
 */
function assertMetrics(metrics: GridPixelMetrics): void {
  requirePositive("metrics.width", metrics.width);
  requirePositive("metrics.height", metrics.height);
  requireNonNegative("metrics.columnGap", metrics.columnGap);
  requireNonNegative("metrics.rowGap", metrics.rowGap);
  requirePositive("metrics.cellWidth", metrics.cellWidth);
  requirePositive("metrics.cellHeight", metrics.cellHeight);
}

/**
 * Converts a free drag's pixel delta into the desired logical grid position.
 *
 * Pure conversion only: the result is intentionally NOT clamped or
 * collision-resolved — clamping, nearest-free placement and layout invariants
 * belong to @veladesk/desktop-engine and are applied when the drop is
 * committed.
 */
export function dragDeltaToDesiredPosition(args: DragDeltaToPositionArgs): GridPosition {
  const { start, delta, metrics } = args;

  requireFinite("delta.x", delta.x);
  requireFinite("delta.y", delta.y);
  assertMetrics(metrics);

  const pitchX = metrics.cellWidth + metrics.columnGap;
  const pitchY = metrics.cellHeight + metrics.rowGap;
  const deltaColumn = Math.round(delta.x / pitchX);
  const deltaRow = Math.round(delta.y / pitchY);

  return {
    column: start.column + deltaColumn,
    row: start.row + deltaRow,
  };
}
