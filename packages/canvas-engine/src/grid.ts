import type { GridDefinition } from "@veladesk/desktop-engine";

import { canvasLattice, nearestEdgeIndex } from "./lattice";
import type {
  CanvasLayoutV1,
  CanvasRect,
  CanvasValidationIssue,
  FreeformCanvasLayoutV2,
  GridCanvasItem,
  GridCanvasLayoutV2,
  GridItemProblem,
} from "./types";

/**
 * Integer square-grid geometry for v2 Grid canvases (Task 017).
 *
 * Everything here is pure cell arithmetic: columns clamp horizontally, rows
 * are unbounded downward, overlap between items stays legal, and a group
 * drag/resize is always one rigid integer delta. Pixel math (cell size,
 * pitch) deliberately does NOT live in this package — the browser owns the
 * responsive square-cell metrics.
 */

/** Why a Grid item's geometry is not legal, in stable order. */
function validateGridItemGeometry(
  item: Omit<GridCanvasItem, "id">,
  columns: number,
): readonly GridItemProblem[] {
  const { column, row, columnSpan, rowSpan } = item;

  if (
    !Number.isSafeInteger(column) ||
    !Number.isSafeInteger(row) ||
    !Number.isSafeInteger(columnSpan) ||
    !Number.isSafeInteger(rowSpan)
  ) {
    return ["not-safe-integer"];
  }

  const problems: GridItemProblem[] = [];

  if (column < 0 || row < 0) {
    problems.push("negative-position");
  }
  if (columnSpan < 1 || rowSpan < 1) {
    problems.push("span-below-minimum");
  }
  if (column + columnSpan > columns) {
    problems.push("exceeds-columns");
  }

  return problems;
}

/**
 * Item-level validation pass shared by whole-layout validation.
 *
 * Duplicate ids are reported by the caller's whole-layout pass; this walks
 * items in array order reporting geometry problems only.
 */
export function validateGridCanvasItems(
  items: readonly GridCanvasItem[],
  columns: number,
): readonly CanvasValidationIssue[] {
  const issues: CanvasValidationIssue[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (seen.has(item.id)) {
      issues.push({ type: "duplicate-item-id", itemId: item.id });
      continue;
    }
    seen.add(item.id);

    const problems = validateGridItemGeometry(item, columns);
    if (problems.length > 0) {
      issues.push({ type: "invalid-grid-item", itemId: item.id, problems });
    }
  }

  return issues;
}

/** Field-by-field equality of two Grid items. */
export function gridItemsEqual(a: GridCanvasItem, b: GridCanvasItem): boolean {
  return (
    a === b ||
    (a.id === b.id &&
      a.column === b.column &&
      a.row === b.row &&
      a.columnSpan === b.columnSpan &&
      a.rowSpan === b.rowSpan)
  );
}

/** True when the layout is a v2 Grid canvas. */
export function isGridCanvasLayout(
  layout: unknown,
): layout is GridCanvasLayoutV2 {
  return (
    typeof layout === "object" &&
    layout !== null &&
    (layout as { version?: unknown }).version === 2 &&
    (layout as { mode?: unknown }).mode === "grid"
  );
}

/** True when the layout is a v2 Freeform canvas. */
export function isFreeformCanvasLayout(
  layout: unknown,
): layout is FreeformCanvasLayoutV2 {
  return (
    typeof layout === "object" &&
    layout !== null &&
    (layout as { version?: unknown }).version === 2 &&
    (layout as { mode?: unknown }).mode === "freeform"
  );
}

/** Find a Grid item by id. */
export function findGridItem(
  layout: GridCanvasLayoutV2,
  itemId: string,
): GridCanvasItem | undefined {
  return layout.items.find((item) => item.id === itemId);
}

/**
 * Replace a Grid item by id. Unknown ids and equal replacements return the
 * input reference.
 */
export function replaceGridItem(
  layout: GridCanvasLayoutV2,
  item: GridCanvasItem,
): GridCanvasLayoutV2 {
  const index = layout.items.findIndex((candidate) => candidate.id === item.id);

  if (index === -1) {
    return layout;
  }

  const current = layout.items[index];
  if (current !== undefined && gridItemsEqual(current, item)) {
    return layout;
  }

  return {
    ...layout,
    items: layout.items.map((candidate, candidateIndex) =>
      candidateIndex === index ? item : candidate,
    ),
  };
}

/** Append a Grid item at the end (array order is the stable item order). */
export function appendGridItem(
  layout: GridCanvasLayoutV2,
  item: GridCanvasItem,
): GridCanvasLayoutV2 {
  return { ...layout, items: [...layout.items, item] };
}

/** The greatest occupied row bottom: max(row + rowSpan), 0 when empty. */
export function maxOccupiedRow(items: readonly GridCanvasItem[]): number {
  let max = 0;
  for (const item of items) {
    max = Math.max(max, item.row + item.rowSpan);
  }
  return max;
}

/** Cell geometry without the id — placement candidates and overlap checks. */
type GridCellRect = Omit<GridCanvasItem, "id">;

function cellsOverlap(a: GridCellRect, b: GridCellRect): boolean {
  return (
    a.column < b.column + b.columnSpan &&
    b.column < a.column + a.columnSpan &&
    a.row < b.row + b.rowSpan &&
    b.row < a.row + a.rowSpan
  );
}

/**
 * The first row-major location where a span fits without overlapping any
 * existing item, scanning from `origin` (default 0,0).
 *
 * Rows are unbounded, so a location always exists: Grid creation can never
 * fail for lack of space. Overlap stays legal for moves — this scan is only
 * the deterministic default for NEW items.
 */
export function firstFreeGridPlacement(
  layout: GridCanvasLayoutV2,
  span: { readonly columnSpan: number; readonly rowSpan: number },
  origin: { readonly column?: number; readonly row?: number } = {},
): { readonly column: number; readonly row: number } {
  const columnSpan = Math.max(1, Math.trunc(span.columnSpan));
  const rowSpan = Math.max(1, Math.trunc(span.rowSpan));
  const originColumn = Math.max(0, Math.trunc(origin.column ?? 0));
  const originRow = Math.max(0, Math.trunc(origin.row ?? 0));

  for (let row = originRow; ; row += 1) {
    // Reading order: the origin row starts at the origin column, every row
    // below restarts from the left edge.
    const firstColumn = row === originRow ? originColumn : 0;
    for (let column = firstColumn; column + columnSpan <= layout.columns; column += 1) {
      const candidate = { column, row, columnSpan, rowSpan };
      if (!layout.items.some((item) => cellsOverlap(candidate, item))) {
        return { column, row };
      }
    }
  }
}

/**
 * Rigid integer translation of a selection.
 *
 * One column/row delta for every selected item; horizontal clamping keeps
 * the whole group inside `columns`, vertical clamping stops at row 0 and
 * has no maximum. Overlap with unselected items is legal. A zero result
 * returns the input reference (no-op identity semantics).
 */
export function translateGridItems(
  layout: GridCanvasLayoutV2,
  itemIds: readonly string[],
  columnDelta: number,
  rowDelta: number,
): GridCanvasLayoutV2 {
  const clamped = clampGridTranslation(layout, itemIds, columnDelta, rowDelta);

  if (clamped.columnDelta === 0 && clamped.rowDelta === 0) {
    return layout;
  }

  const wanted = new Set(itemIds);

  return {
    ...layout,
    items: layout.items.map((item) =>
      wanted.has(item.id)
        ? {
            ...item,
            column: item.column + clamped.columnDelta,
            row: item.row + clamped.rowDelta,
          }
        : item,
    ),
  };
}

/**
 * Settles a Grid canvas after a COMMITTED geometry edit: the items in
 * `settledIds` (the moved/dragged/resized set) keep exactly the geometry the
 * gesture produced — the target-slot feedback the user saw is never
 * rewritten — while every OTHER item that now sits under one of them is
 * displaced to the first row-major free location scanned from its own
 * origin (so a bystander hops aside, never across the canvas).
 *
 * This is the COMMIT-side policy that keeps "overlap stays legal" from
 * becoming "two tiles stacked in one cell": the pure translation/resize
 * primitives above still permit overlap during a gesture (previews must
 * show the raw landing), and this pass runs once at commit. Displacement
 * preserves each item's span, processes bystanders in array order against
 * the working layout (already-displaced items included), and a layout with
 * no bystander overlap returns the input reference.
 */
export function displaceGridOverlaps(
  layout: GridCanvasLayoutV2,
  settledIds: readonly string[],
): GridCanvasLayoutV2 {
  const settled = new Set(settledIds);
  let next = layout;
  let changed = false;

  for (const item of layout.items) {
    if (settled.has(item.id)) {
      continue;
    }
    const overlapped = next.items.some(
      (other) => other.id !== item.id && settled.has(other.id) && cellsOverlap(item, other),
    );
    if (!overlapped) {
      continue;
    }
    // Scan against the layout WITHOUT this item so its own cell does not
    // block the nearest free location (which may be the very next cell).
    const without = {
      ...next,
      items: next.items.filter((candidate) => candidate.id !== item.id),
    };
    const position = firstFreeGridPlacement(
      without,
      { columnSpan: item.columnSpan, rowSpan: item.rowSpan },
      { column: item.column, row: item.row },
    );
    next = replaceGridItem(next, { ...item, ...position });
    changed = true;
  }

  return changed ? next : layout;
}

/**
 * The push vector of an Apple-style live reflow (t129): while a Grid drag
 * holds its resolved target, every bystander it covers shifts ONE cell at a
 * time in `direction` along `axis` — the direction is OPPOSITE the drag's
 * dominant delta, so the wave of yielding tiles travels toward the vacated
 * cells and the gap follows the pointer. Null when the resolved delta is
 * zero (nothing to reflow).
 */
export interface GridReflowPush {
  readonly axis: "column" | "row";
  readonly direction: -1 | 1;
}

/**
 * Derives the reflow push from the resolved whole-cell drag delta. Pure.
 */
export function gridReflowPushOf(
  columnDelta: number,
  rowDelta: number,
): GridReflowPush | null {
  if (columnDelta === 0 && rowDelta === 0) {
    return null;
  }
  if (Math.abs(columnDelta) >= Math.abs(rowDelta)) {
    return { axis: "column", direction: columnDelta > 0 ? -1 : 1 };
  }
  return { axis: "row", direction: rowDelta > 0 ? -1 : 1 };
}

/** The next cell of a one-step reflow push, or null at the backward edge. */
function reflowStepOf(
  item: Omit<GridCanvasItem, "id">,
  push: GridReflowPush,
  columns: number,
): { readonly column: number; readonly row: number } | null {
  if (push.axis === "column") {
    const column = item.column + push.direction;
    if (column >= 0 && column + item.columnSpan <= columns) {
      return { column, row: item.row };
    }
    if (push.direction > 0) {
      // Pushed past the right edge: flow to the next row's start (reading
      // order keeps increasing, so the wave always terminates).
      return { column: 0, row: item.row + 1 };
    }
    // Pushed past the left edge: flow to the previous row's end. Above row 0
    // there is no further backward room — the settle fallback owns it.
    const row = item.row - 1;
    return row >= 0
      ? { column: Math.max(0, columns - item.columnSpan), row }
      : null;
  }
  const row = item.row + push.direction;
  // Rows are unbounded downward; upward stops at row 0 (fallback).
  return row >= 0 ? { column: item.column, row } : null;
}

/**
 * The Apple-style live reflow settle (t129): given a layout whose DRAGGED
 * items already sit at their resolved target cells, every bystander they
 * cover yields by cascading ONE CELL at a time along `push` — the tile
 * under the dragged footprint steps aside, whatever it lands on steps aside
 * in turn, and the wave keeps travelling until it falls into the cells the
 * dragged set vacated. Same-row neighbours slide toward the hole while the
 * gap follows the pointer, instead of the Helm r2 "displace the bystander
 * downward" scan. Untouched items NEVER move, so intentional saved gaps
 * survive a drag that never crosses them; spans are preserved; the dragged
 * set's own geometry is exactly what the caller placed.
 *
 * Deterministic: conflicts are processed from the bystanders under the
 * dragged set (array order); between two overlapping bystanders the one
 * further along the push direction yields. A generous iteration budget
 * bounds pathological packings — if it ever runs out, the remainder is
 * settled by {@link displaceGridOverlaps} so the no-stacking invariant
 * holds regardless. Pure; returns the input reference when nothing moved.
 */
export function reflowGridOverlaps(
  layout: GridCanvasLayoutV2,
  draggedIds: readonly string[],
  push: GridReflowPush,
): GridCanvasLayoutV2 {
  // The working copies shed `readonly` for the in-place cascade; the result
  // rebuilds fresh frozen-shape items from them (order preserved).
  type WorkingItem = { -readonly [K in keyof GridCanvasItem]: GridCanvasItem[K] };
  const dragged = new Set(draggedIds);
  const working: WorkingItem[] = layout.items.map((item) => ({ ...item }));
  const byId = new Map(working.map((item) => [item.id, item] as const));
  let changed = false;
  let pushes = 0;
  // Each push moves one item one cell strictly along the push direction
  // (reading order monotone), so a budget of cells-per-item bounds every
  // realistic cascade; the cap keeps the worst case cheap.
  const budget = Math.min(working.length * (layout.columns + 4) + 16, 2048);

  const conflictsOf = (item: WorkingItem): WorkingItem[] =>
    working.filter(
      (other) => other.id !== item.id && cellsOverlap(item, other),
    );

  const applyPush = (item: WorkingItem): boolean => {
    const step = reflowStepOf(item, push, layout.columns);
    let next = step;
    if (next === null) {
      // Backward edge exhausted: nearest free cell from its own origin (the
      // Helm r2 scan) — if that is where it already sits, this item cannot
      // progress and the caller's settle fallback takes over.
      const without = working.filter((candidate) => candidate.id !== item.id);
      next = firstFreeGridPlacement(
        { ...layout, items: without },
        { columnSpan: item.columnSpan, rowSpan: item.rowSpan },
        { column: item.column, row: item.row },
      );
      if (next.column === item.column && next.row === item.row) {
        return false;
      }
    }
    item.column = next.column;
    item.row = next.row;
    changed = true;
    pushes += 1;
    return true;
  };

  // Seeds: the bystanders a dragged tile currently covers, array order.
  const stack: WorkingItem[] = [];
  for (const item of working) {
    if (!dragged.has(item.id) && conflictsOf(item).some((other) => dragged.has(other.id))) {
      stack.push(item);
    }
  }

  while (stack.length > 0) {
    if (pushes > budget) {
      // Pathological packing: settle whatever is left with the older
      // displacement pass so two tiles can never share a cell.
      return displaceGridOverlaps(
        { ...layout, items: working },
        draggedIds,
      );
    }
    const current = stack[stack.length - 1] as WorkingItem;
    const conflicts = conflictsOf(current);
    if (conflicts.length === 0) {
      stack.pop();
      continue;
    }
    // Under a dragged tile, the bystander itself moves. Otherwise the tile
    // it just landed on yields — the one furthest along the push direction,
    // so the wave travels toward the vacated cells.
    if (conflicts.some((other) => dragged.has(other.id))) {
      if (!applyPush(current)) {
        stack.pop();
      }
      continue;
    }
    const along = (item: WorkingItem): number =>
      push.axis === "column" ? item.column : item.row;
    let obstacle = conflicts[0] as WorkingItem;
    for (const candidate of conflicts) {
      const better =
        push.direction < 0
          ? along(candidate) < along(obstacle)
          : along(candidate) > along(obstacle);
      if (better) {
        obstacle = candidate;
      }
    }
    if (!applyPush(obstacle)) {
      // The obstacle cannot yield further; move the current aside instead.
      if (!applyPush(current)) {
        stack.pop();
      }
      continue;
    }
    stack.push(obstacle);
  }

  if (!changed) {
    return layout;
  }
  return {
    ...layout,
    items: layout.items.map((item) => {
      const moved = byId.get(item.id);
      return moved === undefined ? item : { ...moved };
    }),
  };
}

/** The rigid delta a group drag may apply, after bounds clamping. */
export function clampGridTranslation(
  layout: GridCanvasLayoutV2,
  itemIds: readonly string[],
  columnDelta: number,
  rowDelta: number,
): { readonly columnDelta: number; readonly rowDelta: number } {
  if (!Number.isFinite(columnDelta) || !Number.isFinite(rowDelta)) {
    return { columnDelta: 0, rowDelta: 0 };
  }

  let minColumn = Number.POSITIVE_INFINITY;
  let minRow = Number.POSITIVE_INFINITY;
  let maxColumnEnd = Number.NEGATIVE_INFINITY;
  let found = false;

  const wanted = new Set(itemIds);
  for (const item of layout.items) {
    if (!wanted.has(item.id)) {
      continue;
    }
    found = true;
    minColumn = Math.min(minColumn, item.column);
    minRow = Math.min(minRow, item.row);
    maxColumnEnd = Math.max(maxColumnEnd, item.column + item.columnSpan);
  }

  if (!found) {
    return { columnDelta: 0, rowDelta: 0 };
  }

  const columns = Math.round(columnDelta);
  const rows = Math.round(rowDelta);

  return {
    columnDelta: Math.min(Math.max(columns, -minColumn), layout.columns - maxColumnEnd),
    rowDelta: Math.max(rows, -minRow),
  };
}

/**
 * Integer span resize of one item through any of the eight handles.
 *
 * E/W change columns only; N/S change rows only; corners change both axes.
 * West/North handles move origin and span together; E/W may never cross the
 * opposite edge; the minimum size is 1×1; the horizontal bound is the
 * column count; the vertical bottom is unbounded. The result is always
 * integer cell geometry, and an unchanged geometry returns the input
 * reference.
 */
export function resizeGridItem(
  layout: GridCanvasLayoutV2,
  itemId: string,
  handle: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w",
  columnDelta: number,
  rowDelta: number,
): GridCanvasLayoutV2 {
  const current = findGridItem(layout, itemId);
  if (current === undefined || !Number.isFinite(columnDelta) || !Number.isFinite(rowDelta)) {
    return layout;
  }

  const movesLeft = handle === "w" || handle === "nw" || handle === "sw";
  const movesRight = handle === "e" || handle === "ne" || handle === "se";
  const movesTop = handle === "n" || handle === "nw" || handle === "ne";
  const movesBottom = handle === "s" || handle === "sw" || handle === "se";

  const startColumnEnd = current.column + current.columnSpan;
  const startRowEnd = current.row + current.rowSpan;
  const columns = Math.round(columnDelta);
  const rows = Math.round(rowDelta);

  let column = current.column;
  let columnSpan = current.columnSpan;
  let row = current.row;
  let rowSpan = current.rowSpan;

  if (movesLeft) {
    // Origin and span move together; the left edge may never cross the right
    // edge (min span 1) or leave the canvas (min column 0).
    column = Math.min(
      Math.max(current.column + columns, 0),
      startColumnEnd - 1,
    );
    columnSpan = startColumnEnd - column;
  } else if (movesRight) {
    // Span only; the right edge may never cross the left edge or the last
    // column.
    columnSpan = Math.min(
      Math.max(current.columnSpan + columns, 1),
      layout.columns - current.column,
    );
  }

  if (movesTop) {
    row = Math.min(Math.max(current.row + rows, 0), startRowEnd - 1);
    rowSpan = startRowEnd - row;
  } else if (movesBottom) {
    rowSpan = Math.max(current.rowSpan + rows, 1);
  }

  const next: GridCanvasItem = { id: current.id, column, row, columnSpan, rowSpan };
  return replaceGridItem(layout, next);
}

/**
 * Convert one v1 snap rect into integer cell geometry through the page's
 * grid lattice — edge indexes, never pixels.
 *
 * Each rect edge maps to its nearest lattice edge index; a degenerate span
 * (both edges on one line) expands to one cell, shifted back inside the
 * column count when that would overflow.
 */
export function canvasRectToGridGeometry(
  rect: CanvasRect,
  grid: GridDefinition,
): { readonly column: number; readonly row: number; readonly columnSpan: number; readonly rowSpan: number } {
  const lattice = canvasLattice(grid);

  const column = nearestEdgeIndex(lattice.columnEdges, rect.x);
  const columnEnd = nearestEdgeIndex(lattice.columnEdges, rect.x + rect.width);
  const row = nearestEdgeIndex(lattice.rowEdges, rect.y);
  const rowEnd = nearestEdgeIndex(lattice.rowEdges, rect.y + rect.height);

  let startColumn = column;
  let spanColumns = Math.max(1, columnEnd - column);
  if (startColumn + spanColumns > grid.columns) {
    spanColumns = Math.max(1, grid.columns - startColumn);
    startColumn = grid.columns - spanColumns;
  }

  return {
    column: startColumn,
    row,
    columnSpan: spanColumns,
    rowSpan: Math.max(1, rowEnd - row),
  };
}

/**
 * A v1 `snap` canvas as a v2 Grid canvas: columns come from the page grid,
 * every item converts through the lattice (edge indexes, not pixels), ids
 * and order survive verbatim.
 */
export function gridLayoutFromV1(
  canvas: CanvasLayoutV1,
  grid: GridDefinition,
): GridCanvasLayoutV2 {
  return {
    version: 2,
    mode: "grid",
    columns: grid.columns,
    items: canvas.items.map((item) => ({
      id: item.id,
      ...canvasRectToGridGeometry(item.rect, grid),
    })),
  };
}

/** A v1 `freeform` canvas as a v2 Freeform canvas, rects untouched. */
export function freeformLayoutFromV1(canvas: CanvasLayoutV1): FreeformCanvasLayoutV2 {
  return { version: 2, mode: "freeform", items: canvas.items };
}

/** The lattice rect of one Grid item — used for Grid→Freeform conversion. */
export function gridItemToCanvasRect(
  item: GridCanvasItem,
  grid: GridDefinition,
): CanvasRect {
  const lattice = canvasLattice(grid);
  const edgeAt = (edges: readonly number[], index: number): number =>
    edges[Math.min(Math.max(index, 0), edges.length - 1)] ?? 0;

  const left = edgeAt(lattice.columnEdges, item.column);
  const right = edgeAt(lattice.columnEdges, item.column + item.columnSpan);
  const top = edgeAt(lattice.rowEdges, item.row);
  const bottom = edgeAt(lattice.rowEdges, item.row + item.rowSpan);

  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/**
 * Whether a Grid layout can become Freeform without losing geometry.
 *
 * The Freeform canvas is exactly one viewport tall (`grid.rows` lattice
 * rows), so any item whose row bottom exceeds the row count would clamp and
 * therefore be lossy. Horizontal fit is guaranteed by Grid validation.
 */
export function canConvertGridToFreeform(
  items: readonly GridCanvasItem[],
  grid: GridDefinition,
): boolean {
  return items.every((item) => item.row + item.rowSpan <= grid.rows);
}

/**
 * The lossless Grid→Freeform conversion, or `null` when
 * {@link canConvertGridToFreeform} refuses.
 */
export function gridLayoutToFreeform(
  layout: GridCanvasLayoutV2,
  grid: GridDefinition,
): FreeformCanvasLayoutV2 | null {
  if (!canConvertGridToFreeform(layout.items, grid)) {
    return null;
  }
  return {
    version: 2,
    mode: "freeform",
    items: layout.items.map((item) => ({
      id: item.id,
      rect: gridItemToCanvasRect(item, grid),
    })),
  };
}
