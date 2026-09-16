import type {
  GridPosition,
  LayoutItem,
  LayoutItemId,
  LayoutOperationResult,
  MoveItemOptions,
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
