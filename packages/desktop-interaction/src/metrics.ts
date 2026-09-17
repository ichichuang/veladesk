import type { GridPixelMeasurementInput, GridPixelMetrics } from "./types";

function requireFinite(name: string, value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, received: ${value}`);
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

function requirePositive(name: string, value: number): number {
  requireFinite(name, value);
  if (value <= 0) {
    throw new RangeError(`${name} must be > 0, received: ${value}`);
  }
  return value;
}

function requirePositiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer, received: ${value}`);
  }
  return value;
}

/**
 * Converts a raw container measurement into usable grid pixel metrics.
 *
 * Keeps full float precision — rounding is deliberately left to the render
 * layer, never to this math. Rejects any input that cannot describe a real
 * grid: non-finite or non-positive sizes, negative gaps, invalid grids, or
 * containers too small for their own gaps (cell size would be <= 0).
 */
export function calculateGridPixelMetrics(input: GridPixelMeasurementInput): GridPixelMetrics {
  const width = requirePositive("width", input.width);
  const height = requirePositive("height", input.height);
  const columnGap = requireNonNegative("columnGap", input.columnGap);
  const rowGap = requireNonNegative("rowGap", input.rowGap);
  requirePositiveInteger("grid.columns", input.grid.columns);
  requirePositiveInteger("grid.rows", input.grid.rows);

  const cellWidth = (width - columnGap * (input.grid.columns - 1)) / input.grid.columns;
  const cellHeight = (height - rowGap * (input.grid.rows - 1)) / input.grid.rows;

  requirePositive("cellWidth", cellWidth);
  requirePositive("cellHeight", cellHeight);

  return {
    width,
    height,
    columnGap,
    rowGap,
    cellWidth,
    cellHeight,
  };
}
