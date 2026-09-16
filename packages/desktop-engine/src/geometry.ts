import type { GridDefinition, GridPosition, GridRect, GridSpan, LayoutItem } from "./types";
import { isValidGridPosition, isValidGridSpan } from "./grid";

export function toGridRect(item: LayoutItem): GridRect {
  return {
    column: item.position.column,
    row: item.position.row,
    columns: item.span.columns,
    rows: item.span.rows,
  };
}

/**
 * Whether two grid rectangles share at least one cell.
 *
 * Rects that merely touch along an edge or a corner do NOT overlap:
 * half-open interval comparison (`<`, never `<=`) enforces this.
 */
export function rectsOverlap(a: GridRect, b: GridRect): boolean {
  const columnsOverlap = a.column < b.column + b.columns && b.column < a.column + a.columns;
  const rowsOverlap = a.row < b.row + b.rows && b.row < a.row + a.rows;
  return columnsOverlap && rowsOverlap;
}

/**
 * Whether a rect is structurally valid and lies fully inside the grid,
 * including rects flush against the right/bottom edges.
 */
export function isRectWithinGrid(grid: GridDefinition, rect: GridRect): boolean {
  if (!isValidGridPosition(rect)) {
    return false;
  }
  if (!isValidGridSpan(rect)) {
    return false;
  }
  return rect.column + rect.columns <= grid.columns && rect.row + rect.rows <= grid.rows;
}

/**
 * All cells covered by a rect, in deterministic row-major order:
 * rows increase outer, columns increase inner.
 */
export function enumerateCells(rect: GridRect): readonly GridPosition[] {
  const cells: GridPosition[] = [];
  for (let row = 0; row < rect.rows; row += 1) {
    for (let column = 0; column < rect.columns; column += 1) {
      cells.push({ column: rect.column + column, row: rect.row + row });
    }
  }
  return cells;
}

/** Internal helper: anchor + span combined into a rect. */
export function rectAt(position: GridPosition, span: GridSpan): GridRect {
  return { column: position.column, row: position.row, columns: span.columns, rows: span.rows };
}
