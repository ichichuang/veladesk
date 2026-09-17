import type { FindNearestFreePositionArgs, GridDefinition, GridPosition, GridSpan } from "./types";
import { isValidGridSpan } from "./grid";
import { rectAt } from "./geometry";
import { canPlaceRect, getCollidingItemIds } from "./occupancy";

/**
 * Position coordinates are logical integer cells. Out-of-range integers are
 * clamp's normal input; anything non-integral (fraction, NaN, Infinity) has
 * no cell meaning and is rejected.
 */
function assertIntegerCoordinate(value: number, name: string): void {
  if (!Number.isInteger(value)) {
    throw new RangeError(
      `${name} must be a finite integer, received ${value}`,
    );
  }
}

/**
 * Clamps a position so that a rect with the given span anchored there stays
 * inside the grid. Negative coordinates clamp to 0; coordinates beyond the
 * grid clamp to the bottom-right-most legal anchor. Both coordinates must be
 * integers — out-of-range integers are clamped, fractional and non-finite
 * coordinates throw RangeError.
 *
 * A span that is invalid or larger than the whole grid throws RangeError —
 * the span is never silently shrunk.
 */
export function clampPositionToGrid(
  grid: GridDefinition,
  position: GridPosition,
  span: GridSpan,
): GridPosition {
  assertIntegerCoordinate(position.column, "position.column");
  assertIntegerCoordinate(position.row, "position.row");
  if (!isValidGridSpan(span)) {
    throw new RangeError(
      `span must be positive finite integers, received columns: ${span.columns}, rows: ${span.rows}`,
    );
  }
  if (span.columns > grid.columns || span.rows > grid.rows) {
    throw new RangeError(
      `span ${span.columns} x ${span.rows} does not fit inside grid ${grid.columns} x ${grid.rows}`,
    );
  }
  const maxColumn = grid.columns - span.columns;
  const maxRow = grid.rows - span.rows;
  return {
    column: Math.min(Math.max(position.column, 0), maxColumn),
    row: Math.min(Math.max(position.row, 0), maxRow),
  };
}

/**
 * Closest free anchor for a span, or null when the grid has no room.
 *
 * Deterministic resolution rules:
 * 1. `desired` is clamped to a legal anchor first (see clampPositionToGrid).
 * 2. If the clamped anchor is free, it is returned immediately.
 * 3. Otherwise every legal anchor in the grid is scanned and the free anchor
 *    with the minimum squared Euclidean distance
 *    (dc * dc + dr * dr) to the clamped desired anchor wins.
 * 4. Distance ties break by smaller row first, then smaller column. The
 *    row-major scan order plus a strict "better only if smaller distance"
 *    comparison implements this rule without depending on object key order,
 *    Set iteration order, or randomness.
 *
 * This is an exhaustive grid scan by design: personal desktop grids are
 * small, and correctness plus deterministic behavior take priority over
 * premature optimization.
 */
export function findNearestFreePosition(args: FindNearestFreePositionArgs): GridPosition | null {
  const { grid, items, span } = args;
  const ignoreOptions =
    args.ignoreItemIds === undefined ? undefined : { ignoreItemIds: args.ignoreItemIds };

  const desired = clampPositionToGrid(grid, args.desired, span);
  if (canPlaceRect(grid, items, rectAt(desired, span), ignoreOptions)) {
    return desired;
  }

  const maxColumn = grid.columns - span.columns;
  const maxRow = grid.rows - span.rows;
  let best: GridPosition | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let row = 0; row <= maxRow; row += 1) {
    for (let column = 0; column <= maxColumn; column += 1) {
      const distance = (column - desired.column) ** 2 + (row - desired.row) ** 2;
      if (distance >= bestDistance) {
        continue;
      }
      const colliding = getCollidingItemIds(items, rectAt({ column, row }, span), ignoreOptions);
      if (colliding.length > 0) {
        continue;
      }
      best = { column, row };
      bestDistance = distance;
    }
  }
  return best;
}
