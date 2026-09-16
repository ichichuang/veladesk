/**
 * Formal coordinate and layout model of the desktop engine.
 *
 * All coordinates are 0-based logical grid cells and never pixels:
 * the top-left cell of a grid is column 0, row 0.
 */

/** Size of a desktop page grid, in cells. */
export interface GridDefinition {
  readonly columns: number;
  readonly rows: number;
}

/** Top-left cell of an item, 0-based. */
export interface GridPosition {
  readonly column: number;
  readonly row: number;
}

/** Size of an item, in cells. */
export interface GridSpan {
  readonly columns: number;
  readonly rows: number;
}

/** A rectangle on the grid: top-left position plus size. */
export interface GridRect extends GridPosition, GridSpan {}

/** Stable identifier of a layout item within a page. */
export type LayoutItemId = string;

/**
 * A single item on a desktop page.
 *
 * The engine deliberately knows nothing about app metadata, URLs, titles,
 * icons, folder contents or widget configuration — `LayoutItem` only owns
 * layout geometry.
 */
export interface LayoutItem {
  readonly id: LayoutItemId;
  readonly position: GridPosition;
  readonly span: GridSpan;
}

/** Full layout of one desktop page. */
export interface PageLayout {
  readonly id: string;
  readonly grid: GridDefinition;
  readonly items: readonly LayoutItem[];
}

/** String key identifying a single grid cell, formatted "column:row". */
export type CellKey = `${number}:${number}`;

/** Options shared by occupancy and collision helpers. */
export interface IgnoreItemsOptions {
  readonly ignoreItemIds?: ReadonlySet<LayoutItemId>;
}

/** Arguments of {@link findNearestFreePosition}. */
export interface FindNearestFreePositionArgs extends IgnoreItemsOptions {
  readonly grid: GridDefinition;
  readonly items: readonly LayoutItem[];
  readonly desired: GridPosition;
  readonly span: GridSpan;
}
