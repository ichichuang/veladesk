/**
 * Canvas geometry helpers of the workspace domain.
 *
 * These functions are the ONLY place that decides whether a page's geometry
 * and membership come from continuous canvas rects or from the legacy grid
 * layout. Container logic must go through `pageItemIds` instead of reaching
 * into `page.layout.items` directly.
 */

import {
  CANVAS_UNITS,
  MIN_CANVAS_SIZE,
  appendCanvasItem,
  canvasCellRect,
  canvasItemIds,
  canvasLattice,
  clampNumber,
  gridPositionToCanvasRect,
  nearestEdgeIndex,
} from "@veladesk/canvas-engine";
import type {
  CanvasLayout,
  CanvasPlacementMode,
  CanvasRect,
} from "@veladesk/canvas-engine";
import type { GridDefinition } from "@veladesk/desktop-engine";

import type { DesktopPage, EntityId } from "./types";

/** A page whose geometry source is a stored canvas. */
export interface CanvasPage extends DesktopPage {
  readonly canvas: CanvasLayout;
}

/** One eighth of a lattice cell — the freeform cascade step. */
const CASCADE_STEP_DIVISOR = 8;

/** True when the page stores canvas geometry. */
export function isCanvasPage(page: DesktopPage): page is CanvasPage {
  return page.canvas !== undefined;
}

/**
 * Member ids of a page — the single membership source.
 *
 * With a canvas, the canvas items are authoritative (the legacy layout must
 * be empty); without one, the legacy layout items are.
 */
export function pageItemIds(page: DesktopPage): readonly EntityId[] {
  return page.canvas === undefined
    ? page.layout.items.map((item) => item.id)
    : canvasItemIds(page.canvas);
}

/**
 * Legacy grid items seen as a virtual canvas: `snap` mode, every edge
 * rounded from its own lattice line so six rows never accumulate a
 * division error. Pure derivation — nothing is persisted.
 */
function derivedPageCanvas(page: DesktopPage): CanvasLayout {
  return {
    version: 1,
    mode: "snap",
    items: page.layout.items.map((item) => ({
      id: item.id,
      rect: gridPositionToCanvasRect(item.position, item.span, page.layout.grid),
    })),
  };
}

/**
 * The geometry a page renders with: its stored canvas, or a virtual canvas
 * derived from legacy grid items.
 *
 * Rendering a legacy page must never write anything — callers that only
 * display a page use this and leave the snapshot alone.
 */
export function resolvePageCanvas(page: DesktopPage): CanvasLayout {
  return page.canvas ?? derivedPageCanvas(page);
}

/**
 * Lazy data upgrade: freeze a legacy page's grid geometry into a stored
 * canvas and empty the legacy item list (the grid stays as the snap
 * lattice).
 *
 * Pages that already carry a canvas are returned unchanged, so this is safe
 * to call on every mutation.
 */
export function materializePageCanvas(page: DesktopPage): CanvasPage {
  if (page.canvas !== undefined) {
    return {
      id: page.id,
      name: page.name,
      layout: page.layout,
      canvas: page.canvas,
    };
  }
  return {
    id: page.id,
    name: page.name,
    layout: { ...page.layout, items: [] },
    canvas: derivedPageCanvas(page),
  };
}

/** Replace the canvas of an already-materialized page. */
export function withPageCanvas(page: CanvasPage, canvas: CanvasLayout): CanvasPage {
  return { ...page, canvas };
}

/** Arguments of {@link newCanvasItemRect}. */
export interface NewCanvasItemRectArgs {
  readonly grid: GridDefinition;
  readonly mode: CanvasPlacementMode;
  /** How many items already sit on the canvas (the cascade position). */
  readonly index: number;
  /** Dissolve anchor: the folder shell rect the first child starts from. */
  readonly anchor?: CanvasRect;
}

/** Lattice cell whose top-left edge is closest to the rect origin. */
function latticeCellOf(
  rect: CanvasRect,
  grid: GridDefinition,
): { readonly column: number; readonly row: number } {
  const lattice = canvasLattice(grid);
  return {
    column: nearestEdgeIndex(lattice.columnEdges, rect.x),
    row: nearestEdgeIndex(lattice.rowEdges, rect.y),
  };
}

/**
 * Deterministic default rect for a newly placed item.
 *
 * Both modes start at one lattice cell in size — canvas pages have no
 * capacity limit, so placement never searches for a free spot and never
 * fails. `snap` walks the lattice diagonal from the anchor cell; `freeform`
 * cascades continuously by an eighth of a cell (about 16 CSS px on a 1300 px
 * canvas) and clamps into the canvas. Overlap is legal in both modes.
 */
export function newCanvasItemRect(args: NewCanvasItemRectArgs): CanvasRect {
  const cell = canvasCellRect(args.grid, 0, 0);
  const index = Math.max(0, Math.trunc(args.index));

  if (args.mode === "snap") {
    const origin =
      args.anchor === undefined
        ? { column: 0, row: 0 }
        : latticeCellOf(args.anchor, args.grid);
    return canvasCellRect(
      args.grid,
      (origin.column + index) % args.grid.columns,
      (origin.row + index) % args.grid.rows,
    );
  }

  const step = Math.max(1, Math.round(cell.width / CASCADE_STEP_DIVISOR));
  return {
    x: clampNumber((args.anchor?.x ?? 0) + index * step, 0, CANVAS_UNITS - cell.width),
    y: clampNumber((args.anchor?.y ?? 0) + index * step, 0, CANVAS_UNITS - cell.height),
    width: cell.width,
    height: cell.height,
  };
}

/**
 * Append `itemId` to a page at the deterministic default rect, materializing
 * legacy geometry first when needed.
 */
export function placePageItem(
  page: DesktopPage,
  itemId: EntityId,
  placement: PageItemPlacement,
): CanvasPage {
  const materialized = materializePageCanvas(page);
  const base = newCanvasItemRect({
    grid: materialized.layout.grid,
    mode: materialized.canvas.mode,
    index: placement.index,
    ...(placement.anchor === undefined ? {} : { anchor: placement.anchor }),
  });
  const rect = placement.size === undefined ? base : fitSizeIntoCanvas(base, placement.size);

  return withPageCanvas(
    materialized,
    appendCanvasItem(materialized.canvas, { id: itemId, rect }),
  );
}

/** Where a newly placed page item lands. */
export interface PageItemPlacement {
  /** Cascade offset: the page's item count, or the child index on a dissolve. */
  readonly index: number;
  /** Dissolve anchor: the folder shell rect the first child cascades from. */
  readonly anchor?: CanvasRect;
  /** Preserved source size (relocating an app that already had a rect). */
  readonly size?: { readonly width: number; readonly height: number };
}

/** Keep a source size, clamped into the canvas at the cascade position. */
function fitSizeIntoCanvas(
  base: CanvasRect,
  size: { readonly width: number; readonly height: number },
): CanvasRect {
  const width = clampNumber(size.width, MIN_CANVAS_SIZE, CANVAS_UNITS);
  const height = clampNumber(size.height, MIN_CANVAS_SIZE, CANVAS_UNITS);

  return {
    x: clampNumber(base.x, 0, CANVAS_UNITS - width),
    y: clampNumber(base.y, 0, CANVAS_UNITS - height),
    width,
    height,
  };
}
