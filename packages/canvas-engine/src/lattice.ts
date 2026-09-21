import type { GridDefinition } from "@veladesk/desktop-engine";

import { canvasRectsEqual } from "./rect";
import { CANVAS_UNITS, MIN_CANVAS_SIZE } from "./types";
import type { CanvasLattice, CanvasRect } from "./types";

function assertGridCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer, received: ${value}`);
  }
}

/**
 * Lattice edges of one axis, computed edge by edge.
 *
 * `round(index / count * CANVAS_UNITS)` per edge — never a repeated addition
 * of a rounded cell size, so a count that does not divide `CANVAS_UNITS`
 * (6 rows, 7 columns, …) cannot accumulate drift.
 */
export function latticeEdges(count: number): readonly number[] {
  assertGridCount(count, "count");

  const edges: number[] = [];
  for (let index = 0; index <= count; index += 1) {
    edges.push(Math.round((index / count) * CANVAS_UNITS));
  }
  return edges;
}

/** Snap lattice of a page grid. Keeps the grid as an alignment reference only. */
export function canvasLattice(grid: GridDefinition): CanvasLattice {
  return {
    columnEdges: latticeEdges(grid.columns),
    rowEdges: latticeEdges(grid.rows),
  };
}

function edgeAt(edges: readonly number[], index: number): number {
  const clamped = Math.min(Math.max(index, 0), edges.length - 1);
  return edges[clamped] ?? CANVAS_UNITS;
}

/** Index of the lattice edge closest to `value`. Ties resolve to the lower edge. */
export function nearestEdgeIndex(edges: readonly number[], value: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    if (edge === undefined) {
      continue;
    }
    const distance = Math.abs(edge - value);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }

  return best;
}

function snapInterval(
  edges: readonly number[],
  start: number,
  end: number,
): readonly [number, number] {
  const lastIndex = edges.length - 1;
  let startIndex = nearestEdgeIndex(edges, start);
  let endIndex = nearestEdgeIndex(edges, end);

  // Both edges landed on the same lattice line (or crossed): expand to the
  // nearest single lattice interval, so a snapped rect is never degenerate.
  if (endIndex <= startIndex) {
    if (startIndex < lastIndex) {
      endIndex = startIndex + 1;
    } else {
      startIndex = lastIndex - 1;
    }
  }

  return [edgeAt(edges, startIndex), edgeAt(edges, endIndex)];
}

/**
 * Snap all four edges to their closest lattice lines.
 *
 * Only alignment changes — overlap with other items stays legal, and nothing
 * else on the canvas is moved or pushed aside. Returns the input reference
 * when the rect is already aligned.
 */
export function snapCanvasRect(rect: CanvasRect, lattice: CanvasLattice): CanvasRect {
  const [left, right] = snapInterval(lattice.columnEdges, rect.x, rect.x + rect.width);
  const [top, bottom] = snapInterval(lattice.rowEdges, rect.y, rect.y + rect.height);

  if (left === rect.x && top === rect.y && right - left === rect.width && bottom - top === rect.height) {
    return rect;
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** {@link snapCanvasRect} against the lattice derived from a grid definition. */
export function canvasRectToSnappedRect(rect: CanvasRect, grid: GridDefinition): CanvasRect {
  return snapCanvasRect(rect, canvasLattice(grid));
}

/** Canvas rect of one grid cell. Edges are rounded, so cells stay gap-free. */
export function gridPositionToCanvasRect(
  position: { readonly column: number; readonly row: number },
  span: { readonly columns: number; readonly rows: number },
  grid: GridDefinition,
): CanvasRect {
  const lattice = canvasLattice(grid);

  const left = edgeAt(lattice.columnEdges, position.column);
  const right = edgeAt(lattice.columnEdges, position.column + span.columns);
  const top = edgeAt(lattice.rowEdges, position.row);
  const bottom = edgeAt(lattice.rowEdges, position.row + span.rows);

  return {
    x: left,
    y: top,
    width: Math.max(MIN_CANVAS_SIZE, right - left),
    height: Math.max(MIN_CANVAS_SIZE, bottom - top),
  };
}

/** Rect of one lattice cell — the default size of a newly added app. */
export function canvasCellRect(
  grid: GridDefinition,
  column: number,
  row: number,
): CanvasRect {
  return gridPositionToCanvasRect(
    { column, row },
    { columns: 1, rows: 1 },
    grid,
  );
}

/** Size of one lattice cell. */
export function canvasCellSize(grid: GridDefinition): { readonly width: number; readonly height: number } {
  const cell = canvasCellRect(grid, 0, 0);
  return { width: cell.width, height: cell.height };
}

/** True when the rect's edges all sit on lattice lines. */
export function isCanvasRectSnapped(rect: CanvasRect, lattice: CanvasLattice): boolean {
  return canvasRectsEqual(rect, snapCanvasRect(rect, lattice));
}
