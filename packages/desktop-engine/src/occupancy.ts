import type { CellKey, GridDefinition, GridPosition, GridRect, IgnoreItemsOptions, LayoutItem, LayoutItemId } from "./types";
import { enumerateCells, isRectWithinGrid, rectsOverlap, toGridRect } from "./geometry";

/** Canonical string key of a grid cell: "column:row". */
export function cellKey(position: GridPosition): CellKey {
  return `${position.column}:${position.row}`;
}

/**
 * Cell -> item id map covering every cell occupied by every item.
 *
 * Multi-cell spans register one entry per covered cell. If any two layout
 * entries already overlap in the input — including entries that share an
 * id — this throws instead of silently overwriting, naming both conflicting
 * item ids.
 */
export function buildOccupancyMap(
  items: readonly LayoutItem[],
  options?: IgnoreItemsOptions,
): ReadonlyMap<CellKey, LayoutItemId> {
  const map = new Map<CellKey, LayoutItemId>();
  for (const item of items) {
    if (options?.ignoreItemIds?.has(item.id)) {
      continue;
    }
    for (const cell of enumerateCells(toGridRect(item))) {
      const key = cellKey(cell);
      if (map.has(key)) {
        const existing = map.get(key)!;
        throw new Error(`Layout items "${existing}" and "${item.id}" overlap at cell ${key}.`);
      }
      map.set(key, item.id);
    }
  }
  return map;
}

/**
 * Ids of items whose rects overlap the candidate rect.
 *
 * Results are deduplicated and keep the original items order.
 */
export function getCollidingItemIds(
  items: readonly LayoutItem[],
  candidate: GridRect,
  options?: IgnoreItemsOptions,
): readonly LayoutItemId[] {
  const ignore = options?.ignoreItemIds;
  const seen = new Set<LayoutItemId>();
  const ids: LayoutItemId[] = [];
  for (const item of items) {
    if (ignore?.has(item.id) || seen.has(item.id)) {
      continue;
    }
    if (rectsOverlap(toGridRect(item), candidate)) {
      seen.add(item.id);
      ids.push(item.id);
    }
  }
  return ids;
}

/** Whether a rect is structurally valid, inside the grid, and collision-free. */
export function canPlaceRect(
  grid: GridDefinition,
  items: readonly LayoutItem[],
  candidate: GridRect,
  options?: IgnoreItemsOptions,
): boolean {
  return (
    isRectWithinGrid(grid, candidate) && getCollidingItemIds(items, candidate, options).length === 0
  );
}
