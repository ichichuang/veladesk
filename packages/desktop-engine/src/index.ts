/**
 * Version of the @veladesk/desktop-engine package.
 */
export const DESKTOP_ENGINE_VERSION = "0.1.0";

export { createGridDefinition, isValidGridPosition, isValidGridSpan } from "./grid";

export { enumerateCells, isRectWithinGrid, rectsOverlap, toGridRect } from "./geometry";

export { buildOccupancyMap, canPlaceRect, cellKey, getCollidingItemIds } from "./occupancy";

export { clampPositionToGrid, findNearestFreePosition } from "./placement";

export type {
  CellKey,
  FindNearestFreePositionArgs,
  GridDefinition,
  GridPosition,
  GridRect,
  GridSpan,
  IgnoreItemsOptions,
  LayoutItem,
  LayoutItemId,
  PageLayout,
} from "./types";
