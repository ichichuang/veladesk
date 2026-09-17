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

/** Why an immutable layout operation refused to produce a new layout. */
export type LayoutOperationFailureReason =
  | "item-not-found"
  | "invalid-layout"
  | "out-of-bounds"
  | "collision"
  | "no-space";

/** Result of an immutable layout operation. Failures keep the input layout. */
export type LayoutOperationResult =
  | {
      readonly ok: true;
      readonly layout: PageLayout;
    }
  | {
      readonly ok: false;
      readonly reason: LayoutOperationFailureReason;
      readonly layout: PageLayout;
      readonly collidingItemIds?: readonly LayoutItemId[];
    };

/** Placement strategy for moveItem. */
export interface MoveItemOptions {
  readonly placement?: "exact" | "nearest-free";
}

/** One discoverable defect of a page layout. */
export type LayoutValidationIssue =
  | {
      readonly type: "invalid-grid";
    }
  | {
      readonly type: "duplicate-id";
      readonly itemId: string;
    }
  | {
      readonly type: "invalid-position";
      readonly itemId: string;
    }
  | {
      readonly type: "invalid-span";
      readonly itemId: string;
    }
  | {
      readonly type: "out-of-bounds";
      readonly itemId: string;
    }
  | {
      readonly type: "overlap";
      readonly itemIds: readonly [string, string];
    };

/** Snapshot-based undo/redo history of one page layout. */
export interface LayoutHistory {
  readonly past: readonly PageLayout[];
  readonly present: PageLayout;
  readonly future: readonly PageLayout[];
  readonly limit: number;
}
