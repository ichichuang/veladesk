import type {
  GridPosition,
  GridTranslation,
  LayoutItem,
  LayoutItemId,
  LayoutOperationResult,
  MoveItemOptions,
  MoveItemsOptions,
  PageLayout,
} from "./types";
import { isValidGridSpan } from "./grid";
import { isRectWithinGrid, rectAt, rectsOverlap, toGridRect } from "./geometry";
import { buildOccupancyMap, getCollidingItemIds } from "./occupancy";
import { findNearestFreePosition } from "./placement";

/**
 * Whether the layout is sound for an operation on the given item entries:
 * every OTHER item must be structurally valid, inside the grid, and
 * mutually collision-free.
 *
 * The operated entries are excluded on purpose so a broken item can still be
 * moved out of an invalid spot (repair scenario) — its own defects surface
 * via the explicit span checks in each operation.
 */
function othersAreSound(layout: PageLayout, operated: ReadonlySet<LayoutItem>): boolean {
  const others = layout.items.filter((entry) => !operated.has(entry));
  try {
    buildOccupancyMap(others);
  } catch {
    return false;
  }
  return others.every((entry) => isRectWithinGrid(layout.grid, toGridRect(entry)));
}

/** New layout with one item anchored at a new position; everything else shared. */
function withItemPosition(
  layout: PageLayout,
  item: LayoutItem,
  position: GridPosition,
): PageLayout {
  if (item.position.column === position.column && item.position.row === position.row) {
    return layout;
  }
  return {
    ...layout,
    items: layout.items.map((entry) =>
      entry === item
        ? { ...entry, position: { column: position.column, row: position.row } }
        : entry,
    ),
  };
}

/**
 * Whether any item id appears more than once. Identity-based operations
 * have no deterministic semantics for duplicated ids, so callers get
 * "invalid-layout" instead of a guess. This deliberately does not use
 * validatePageLayout: the repair scenarios (operated item temporarily
 * out of bounds or overlapping) must keep working.
 */
function hasDuplicateItemIds(items: readonly LayoutItem[]): boolean {
  const seen = new Set<LayoutItemId>();
  for (const item of items) {
    if (seen.has(item.id)) {
      return true;
    }
    seen.add(item.id);
  }
  return false;
}

/**
 * Moves one item to a desired anchor, immutably.
 *
 * `placement: "exact"` (default) requires the desired anchor to be legal as
 * given; `placement: "nearest-free"` clamps it first and then resolves the
 * nearest free anchor (deterministic tie-break: smaller row, then column).
 *
 * Failures never mutate or replace the input layout. A successful no-op move
 * (target equals current position) returns the original layout reference.
 */
export function moveItem(
  layout: PageLayout,
  itemId: LayoutItemId,
  desired: GridPosition,
  options?: MoveItemOptions,
): LayoutOperationResult {
  if (hasDuplicateItemIds(layout.items)) {
    return { ok: false, reason: "invalid-layout", layout };
  }
  const item = layout.items.find((entry) => entry.id === itemId);
  if (item === undefined) {
    return { ok: false, reason: "item-not-found", layout };
  }
  if (!isValidGridSpan(item.span) || !othersAreSound(layout, new Set([item]))) {
    return { ok: false, reason: "invalid-layout", layout };
  }

  const ignore = { ignoreItemIds: new Set<LayoutItemId>([itemId]) };

  if (options?.placement === "nearest-free") {
    if (item.span.columns > layout.grid.columns || item.span.rows > layout.grid.rows) {
      return { ok: false, reason: "no-space", layout };
    }
    const resolved = findNearestFreePosition({
      grid: layout.grid,
      items: layout.items,
      desired,
      span: item.span,
      ignoreItemIds: ignore.ignoreItemIds,
    });
    if (resolved === null) {
      return { ok: false, reason: "no-space", layout };
    }
    return { ok: true, layout: withItemPosition(layout, item, resolved) };
  }

  const candidate = rectAt(desired, item.span);
  if (!isRectWithinGrid(layout.grid, candidate)) {
    return { ok: false, reason: "out-of-bounds", layout };
  }
  const colliding = getCollidingItemIds(layout.items, candidate, ignore);
  if (colliding.length > 0) {
    return { ok: false, reason: "collision", layout, collidingItemIds: colliding };
  }
  return { ok: true, layout: withItemPosition(layout, item, desired) };
}


/**
 * Whether the selection request itself is well-formed: non-empty and free
 * of duplicate ids.
 */
function selectionIsWellFormed(itemIds: readonly LayoutItemId[]): boolean {
  if (itemIds.length === 0) {
    return false;
  }
  return new Set(itemIds).size === itemIds.length;
}

/**
 * Whether a rigid translation is applicable at all: both deltas must be
 * integers (NaN and Infinity are not integers either).
 */
function translationIsApplicable(translation: GridTranslation): boolean {
  return (
    Number.isInteger(translation.columnDelta) &&
    Number.isInteger(translation.rowDelta)
  );
}

/**
 * Translates a whole selection rigidly, immutably.
 *
 * Every selected item moves by the SAME integer delta — relative offsets,
 * ids, spans and array order are preserved, and only `position` changes.
 * Unselected items keep their object references. The input is never
 * mutated.
 *
 * Failures never mutate or replace the input layout:
 * - invalid-selection: empty or duplicated requested ids
 * - invalid-layout: the layout has duplicate item ids (or, beyond the
 *   moved selection, structurally unsound items)
 * - invalid-translation: non-integer / non-finite deltas
 * - item-not-found: any requested id missing from the layout
 * - out-of-bounds / collision (exact): the translated group would leave
 *   the grid or overlap an unselected item
 * - no-space (nearest-free): no rigid translation of the whole group
 *   resolves legally
 *
 * A zero translation returns the original layout reference. A
 * single-item selection delegates to `moveItem`, keeping both behaviors
 * exactly equivalent.
 */
export function moveItems(
  layout: PageLayout,
  itemIds: readonly LayoutItemId[],
  translation: GridTranslation,
  options?: MoveItemsOptions,
): LayoutOperationResult {
  if (!selectionIsWellFormed(itemIds)) {
    return { ok: false, reason: "invalid-selection", layout };
  }
  if (hasDuplicateItemIds(layout.items)) {
    return { ok: false, reason: "invalid-layout", layout };
  }
  if (!translationIsApplicable(translation)) {
    return { ok: false, reason: "invalid-translation", layout };
  }
  const selected = new Set<LayoutItemId>();
  for (const id of itemIds) {
    const item = layout.items.find((entry) => entry.id === id);
    if (item === undefined) {
      return { ok: false, reason: "item-not-found", layout };
    }
    selected.add(id);
  }

  if (selected.size === 1) {
    const only = layout.items.find((entry) => selected.has(entry.id))!;
    return moveItem(
      layout,
      only.id,
      {
        column: only.position.column + translation.columnDelta,
        row: only.position.row + translation.rowDelta,
      },
      { placement: options?.placement ?? "exact" },
    );
  }

  const selectedEntries = layout.items.filter((entry) => selected.has(entry.id));
  const others = layout.items.filter((entry) => !selected.has(entry.id));

  // The moved group must sit on top of a sound remaining layout: every
  // selected span valid, every unselected item valid, in-grid and mutually
  // collision-free.
  if (!selectedEntries.every((entry) => isValidGridSpan(entry.span))) {
    return { ok: false, reason: "invalid-layout", layout };
  }
  if (!othersAreSound(layout, new Set(selectedEntries))) {
    return { ok: false, reason: "invalid-layout", layout };
  }

  const translated = (
    columnDelta: number,
    rowDelta: number,
  ): readonly LayoutItem[] =>
    layout.items.map((entry) =>
      selected.has(entry.id)
        ? {
            ...entry,
            position: {
              column: entry.position.column + columnDelta,
              row: entry.position.row + rowDelta,
            },
          }
        : entry,
    );

  /** Whether any translated selected rect overlaps any unselected item. */
  function collidesWithOthers(columnDelta: number, rowDelta: number): readonly LayoutItemId[] {
    const colliding = new Set<LayoutItemId>();
    for (const entry of selectedEntries) {
      const movedRect = toGridRect({
        ...entry,
        position: {
          column: entry.position.column + columnDelta,
          row: entry.position.row + rowDelta,
        },
      });
      for (const other of others) {
        if (rectsOverlap(movedRect, toGridRect(other))) {
          colliding.add(other.id);
        }
      }
    }
    return [...colliding];
  }

  if (options?.placement === "nearest-free") {
    // Rigid group bounds: the deltas that keep the WHOLE group inside the
    // grid. A zero desired translation participates in the search like any
    // other — in a broken (overlapping) state the search is the repair.
    const minColumn = Math.min(...selectedEntries.map((entry) => entry.position.column));
    const maxColumnEnd = Math.max(
      ...selectedEntries.map((entry) => entry.position.column + entry.span.columns),
    );
    const minRow = Math.min(...selectedEntries.map((entry) => entry.position.row));
    const maxRowEnd = Math.max(
      ...selectedEntries.map((entry) => entry.position.row + entry.span.rows),
    );
    const minColumnDelta = -minColumn;
    const maxColumnDelta = layout.grid.columns - maxColumnEnd;
    const minRowDelta = -minRow;
    const maxRowDelta = layout.grid.rows - maxRowEnd;
    if (
      minColumnDelta > maxColumnDelta ||
      minRowDelta > maxRowDelta
    ) {
      return { ok: false, reason: "no-space", layout };
    }

    let best: {
      columnDelta: number;
      rowDelta: number;
      distance: number;
      top: number;
      left: number;
    } | null = null;
    for (let columnDelta = minColumnDelta; columnDelta <= maxColumnDelta; columnDelta += 1) {
      for (let rowDelta = minRowDelta; rowDelta <= maxRowDelta; rowDelta += 1) {
        const distance =
          (columnDelta - translation.columnDelta) ** 2 +
          (rowDelta - translation.rowDelta) ** 2;
        if (best !== null && distance > best.distance) {
          continue;
        }
        if (collidesWithOthers(columnDelta, rowDelta).length > 0) {
          continue;
        }
        const top = minRow + rowDelta;
        const left = minColumn + columnDelta;
        if (
          best === null ||
          distance < best.distance ||
          (distance === best.distance && top < best.top) ||
          (distance === best.distance && top === best.top && left < best.left)
        ) {
          best = { columnDelta, rowDelta, distance, top, left };
        }
      }
    }
    if (best === null) {
      return { ok: false, reason: "no-space", layout };
    }
    if (best.columnDelta === 0 && best.rowDelta === 0) {
      return { ok: true, layout };
    }
    return { ok: true, layout: { ...layout, items: translated(best.columnDelta, best.rowDelta) } };
  }

  // Exact zero translation: nothing to move, original layout reference.
  if (translation.columnDelta === 0 && translation.rowDelta === 0) {
    return { ok: true, layout };
  }
  const movedItems = translated(translation.columnDelta, translation.rowDelta);
  for (const entry of movedItems) {
    if (!selected.has(entry.id)) {
      continue;
    }
    if (!isRectWithinGrid(layout.grid, toGridRect(entry))) {
      return { ok: false, reason: "out-of-bounds", layout };
    }
  }
  const colliding = collidesWithOthers(translation.columnDelta, translation.rowDelta);
  if (colliding.length > 0) {
    return { ok: false, reason: "collision", layout, collidingItemIds: colliding };
  }
  return { ok: true, layout: { ...layout, items: movedItems } };
}

/**
 * Swaps the top-left anchors of two items while each keeps its own span.
 *
 * Items with different spans may swap, but both resulting rects must be
 * inside the grid, must not overlap each other, and must not overlap any
 * other item — otherwise the operation fails with "collision" or
 * "out-of-bounds". Swapping an id with itself is a successful no-op that
 * returns the original layout reference.
 */
export function swapItems(
  layout: PageLayout,
  firstId: LayoutItemId,
  secondId: LayoutItemId,
): LayoutOperationResult {
  if (hasDuplicateItemIds(layout.items)) {
    return { ok: false, reason: "invalid-layout", layout };
  }
  const first = layout.items.find((entry) => entry.id === firstId);
  const second = layout.items.find((entry) => entry.id === secondId);
  if (first === undefined || second === undefined) {
    return { ok: false, reason: "item-not-found", layout };
  }
  if (first === second) {
    return { ok: true, layout };
  }
  if (
    !isValidGridSpan(first.span) ||
    !isValidGridSpan(second.span) ||
    !othersAreSound(layout, new Set([first, second]))
  ) {
    return { ok: false, reason: "invalid-layout", layout };
  }

  const firstRect = rectAt(second.position, first.span);
  const secondRect = rectAt(first.position, second.span);
  if (!isRectWithinGrid(layout.grid, firstRect) || !isRectWithinGrid(layout.grid, secondRect)) {
    return { ok: false, reason: "out-of-bounds", layout };
  }

  const ignoreBoth = { ignoreItemIds: new Set<LayoutItemId>([firstId, secondId]) };
  const colliding: LayoutItemId[] = [];
  for (const id of [
    ...getCollidingItemIds(layout.items, firstRect, ignoreBoth),
    ...getCollidingItemIds(layout.items, secondRect, ignoreBoth),
  ]) {
    if (!colliding.includes(id)) {
      colliding.push(id);
    }
  }
  if (rectsOverlap(firstRect, secondRect)) {
    colliding.push(firstId, secondId);
  }
  if (colliding.length > 0) {
    return { ok: false, reason: "collision", layout, collidingItemIds: colliding };
  }

  return {
    ok: true,
    layout: {
      ...layout,
      items: layout.items.map((entry) => {
        if (entry === first) {
          return { ...entry, position: { column: second.position.column, row: second.position.row } };
        }
        if (entry === second) {
          return { ...entry, position: { column: first.position.column, row: first.position.row } };
        }
        return entry;
      }),
    },
  };
}
