import type { GridDefinition, GridPosition, GridSpan } from "./types";

function assertPositiveInteger(value: number, name: string): void {
  // Number.isInteger already rejects NaN and ±Infinity (they are not finite),
  // so this single check enforces finite + integer + > 0.
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite integer, received: ${value}`);
  }
}

export function createGridDefinition(columns: number, rows: number): GridDefinition {
  assertPositiveInteger(columns, "columns");
  assertPositiveInteger(rows, "rows");
  return { columns, rows };
}

/**
 * Whether a raw grid definition satisfies the grid invariant:
 * columns and rows are positive finite integers.
 *
 * `Number.isInteger` already rejects NaN, ±Infinity and fractions, so this
 * single check enforces finite + integer + > 0. A predicate, never throws.
 */
export function isValidGridDefinition(grid: GridDefinition): boolean {
  return (
    Number.isInteger(grid.columns) &&
    grid.columns > 0 &&
    Number.isInteger(grid.rows) &&
    grid.rows > 0
  );
}

export function isValidGridPosition(position: GridPosition): boolean {
  return (
    Number.isInteger(position.column) &&
    position.column >= 0 &&
    Number.isInteger(position.row) &&
    position.row >= 0
  );
}

export function isValidGridSpan(span: GridSpan): boolean {
  return (
    Number.isInteger(span.columns) &&
    span.columns > 0 &&
    Number.isInteger(span.rows) &&
    span.rows > 0
  );
}
