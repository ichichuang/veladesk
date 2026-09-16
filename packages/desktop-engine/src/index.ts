/**
 * Version of the @veladesk/desktop-engine package.
 */
export const DESKTOP_ENGINE_VERSION = "0.1.0";

export { createGridDefinition, isValidGridPosition, isValidGridSpan } from "./grid";

export { enumerateCells, isRectWithinGrid, rectsOverlap, toGridRect } from "./geometry";

export type {
  GridDefinition,
  GridPosition,
  GridRect,
  GridSpan,
  LayoutItem,
  LayoutItemId,
  PageLayout,
} from "./types";
