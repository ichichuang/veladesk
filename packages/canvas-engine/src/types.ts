/**
 * Continuous canvas contracts for VelaDesk desktop pages.
 *
 * A canvas page stores free rectangles in resolution-independent logical
 * units instead of grid cells. This module is pure TypeScript: no React, no
 * DOM, no IndexedDB, no Node fs, no Next.
 */

/**
 * Resolution-independent extent of one canvas axis.
 *
 * Geometry is persisted in these units, never in CSS pixels, so a section
 * renders identically on any display. `10000` keeps one logical unit far
 * below a device pixel at realistic window sizes while staying a safe
 * integer.
 */
export const CANVAS_UNITS = 10_000;

/** Smallest allowed rect extent. Deliberately not a pixel value. */
export const MIN_CANVAS_SIZE = 1;

/**
 * A rectangle in canvas units.
 *
 * `x`/`y` are the top-left corner; `width`/`height` are independent, so any
 * aspect ratio (square, landscape, portrait) is legal. There is no scale cap:
 * the only maximum is the canvas itself.
 */
export interface CanvasRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One placed entity on a canvas. Array order is the stable item order. */
export interface CanvasLayoutItem {
  readonly id: string;
  readonly rect: CanvasRect;
}

/**
 * How v1 canvas items are edited.
 *
 * `snap` means edges/positions align to the page's grid lattice — it does
 * NOT mean a cell is occupied or that overlap is rejected.
 */
export type CanvasPlacementMode = "snap" | "freeform";

/** The v1 canvas shape, preserved verbatim so old snapshots stay valid. */
export interface CanvasLayoutV1 {
  readonly version: 1;
  readonly mode: CanvasPlacementMode;
  readonly items: readonly CanvasLayoutItem[];
}

/**
 * One placed entity in a v2 Grid canvas: integer cell geometry.
 *
 * `column`/`row` are 0-based cell origins; spans are whole cells >= 1.
 * `row` has no maximum — Grid content grows downward without bound.
 */
export interface GridCanvasItem {
  readonly id: string;
  readonly column: number;
  readonly row: number;
  readonly columnSpan: number;
  readonly rowSpan: number;
}

/**
 * A true integer square-cell Grid canvas (Task 017).
 *
 * `columns` is persistent layout structure: the browser derives the physical
 * square size from the available width, never the other way around.
 */
export interface GridCanvasLayoutV2 {
  readonly version: 2;
  readonly mode: "grid";
  readonly columns: number;
  readonly items: readonly GridCanvasItem[];
}

/** A v2 continuous canvas: exactly the v1 freeform model, re-versioned. */
export interface FreeformCanvasLayoutV2 {
  readonly version: 2;
  readonly mode: "freeform";
  readonly items: readonly CanvasLayoutItem[];
}

/**
 * Geometry and edit mode of one page/section, versioned.
 *
 * v1 keeps both `snap` and `freeform`; v2 splits them into dedicated Grid
 * and Freeform shapes. Readers resolve everything through one canonical
 * resolver that lazily derives v2 placement from v1/legacy pages.
 */
export type CanvasLayout = CanvasLayoutV1 | GridCanvasLayoutV2 | FreeformCanvasLayoutV2;

/** Any layout whose items are continuous rects (v1 both modes, v2 freeform). */
export type RectCanvasLayout = CanvasLayoutV1 | FreeformCanvasLayoutV2;

/** The production placement modes a resolved page can render/edit in. */
export type PagePlacementMode = "grid" | "freeform";

/** Why a rect is not a legal canvas rect. Order of reporting is stable. */
export type CanvasRectProblem =
  | "not-safe-integer"
  | "negative-origin"
  | "size-below-minimum"
  | "exceeds-canvas";

/** Why a Grid item's integer geometry is not legal. Order is stable. */
export type GridItemProblem =
  | "not-safe-integer"
  | "negative-position"
  | "span-below-minimum"
  | "exceeds-columns";

/** Structural/semantic problems of a whole canvas layout. */
export type CanvasValidationIssue =
  | { readonly type: "invalid-version"; readonly version: number }
  | { readonly type: "invalid-mode"; readonly mode: string }
  | { readonly type: "invalid-columns"; readonly columns: number }
  | { readonly type: "duplicate-item-id"; readonly itemId: string }
  | {
      readonly type: "invalid-rect";
      readonly itemId: string;
      readonly problems: readonly CanvasRectProblem[];
    }
  | {
      readonly type: "invalid-grid-item";
      readonly itemId: string;
      readonly problems: readonly GridItemProblem[];
    };

/** The eight resize handles of a single selection. */
export type CanvasResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** Input of the pure resize math. Deltas are in logical units. */
export interface CanvasResizeArgs {
  readonly start: CanvasRect;
  readonly handle: CanvasResizeHandle;
  readonly deltaX: number;
  readonly deltaY: number;
  /**
   * Aspect lock (Shift). Only corner handles honour it; edge handles resize a
   * single axis either way.
   */
  readonly constrainAspect: boolean;
}

/** A translation in logical units. */
export interface CanvasTranslation {
  readonly x: number;
  readonly y: number;
}

/**
 * Snap lattice derived from a grid definition.
 *
 * Edge indexes are converted one by one with `round(index / count * units)`
 * so that a non-divisible count (e.g. 6 rows) never accumulates a drift.
 */
export interface CanvasLattice {
  readonly columnEdges: readonly number[];
  readonly rowEdges: readonly number[];
}

/** Undo/redo history of one canvas. Snapshot model, never a command log. */
export interface CanvasHistory {
  readonly past: readonly CanvasLayout[];
  readonly present: CanvasLayout;
  readonly future: readonly CanvasLayout[];
  readonly limit: number;
}

/** History depth. Matches the desktop engine's grid history limit. */
export const DEFAULT_CANVAS_HISTORY_LIMIT = 50;
