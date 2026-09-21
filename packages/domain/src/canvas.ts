/**
 * Canvas geometry helpers of the workspace domain.
 *
 * These functions are the ONLY place that decides whether a page's geometry
 * and membership come from a v2 Grid/Freeform canvas, a v1 canvas, or the
 * legacy grid layout. Container logic must go through `pageItemIds` instead
 * of reaching into `page.layout.items` or `page.canvas.items` directly.
 */

import {
  CANVAS_UNITS,
  MIN_CANVAS_SIZE,
  appendCanvasItem,
  appendGridItem,
  canvasLattice,
  canvasRectToGridGeometry,
  canvasRectToSnappedRect,
  clampNumber,
  firstFreeGridPlacement,
  findCanvasItem,
  freeformLayoutFromV1,
  gridLayoutFromV1,
  nearestEdgeIndex,
} from "@veladesk/canvas-engine";
import type {
  CanvasLayout,
  CanvasRect,
  FreeformCanvasLayoutV2,
  GridCanvasItem,
  GridCanvasLayoutV2,
} from "@veladesk/canvas-engine";
import type { GridDefinition } from "@veladesk/desktop-engine";

import type { DesktopPage, EntityId } from "./types";

/** A page whose geometry source is a stored canvas. */
export interface CanvasPage extends DesktopPage {
  readonly canvas: CanvasLayout;
}

/**
 * The production placement of a page — always v2: a true integer Grid or a
 * continuous Freeform canvas. This is what rendering and editing consume;
 * v1/legacy pages are derived lazily and never written on read.
 */
export type PagePlacement = GridCanvasLayoutV2 | FreeformCanvasLayoutV2;

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
 * be empty); without one, the legacy layout items are. Works identically
 * for v1 and v2 canvases: both carry `id` on every item.
 */
export function pageItemIds(page: DesktopPage): readonly EntityId[] {
  return page.canvas === undefined
    ? page.layout.items.map((item) => item.id)
    : page.canvas.items.map((item) => item.id);
}

/**
 * THE canonical placement resolver (task 017).
 *
 * Read behavior, pure — rendering never writes:
 * - v2 grid / v2 freeform: used directly.
 * - v1 `snap`: lazily derived as v2 grid through the page's grid lattice
 *   (edge indexes, never pixels).
 * - v1 `freeform`: lazily derived as v2 freeform with rects unchanged.
 * - legacy `layout.items` without a canvas: derived as v2 grid exactly from
 *   the stored GridPosition/GridSpan.
 */
export function resolvePagePlacement(page: DesktopPage): PagePlacement {
  const canvas = page.canvas;
  if (canvas === undefined) {
    return {
      version: 2,
      mode: "grid",
      columns: page.layout.grid.columns,
      items: page.layout.items.map((item) => ({
        id: item.id,
        column: item.position.column,
        row: item.position.row,
        columnSpan: item.span.columns,
        rowSpan: item.span.rows,
      })),
    };
  }
  if (canvas.version === 2) {
    return canvas;
  }
  return canvas.mode === "snap"
    ? gridLayoutFromV1(canvas, page.layout.grid)
    : freeformLayoutFromV1(canvas);
}

/**
 * Lazy data upgrade: freeze a page's placement into a STORED v2 canvas and
 * empty the legacy item list (the page grid stays as the snap lattice).
 *
 * Pages that already carry a v2 canvas are returned unchanged. This is the
 * single materialization path — the first geometry-aware mutation runs it,
 * rendering never does.
 */
export function materializePagePlacement(
  page: DesktopPage,
): DesktopPage & { canvas: PagePlacement } {
  if (page.canvas !== undefined && page.canvas.version === 2) {
    return page as DesktopPage & { canvas: PagePlacement };
  }
  return {
    ...page,
    layout: { ...page.layout, items: [] },
    canvas: resolvePagePlacement(page),
  };
}

/** Replace the canvas of an already-materialized page. */
export function withPageCanvas(page: CanvasPage, canvas: CanvasLayout): CanvasPage {
  return { ...page, canvas };
}

/** Arguments of {@link newCanvasItemRect}. */
export interface NewCanvasItemRectArgs {
  readonly grid: GridDefinition;
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
 * Deterministic default rect for a newly placed FREEFORM item.
 *
 * The freeform cascade walks continuously by an eighth of a cell (about
 * 16 CSS px on a 1300 px canvas) and clamps into the canvas. Overlap is
 * legal. (Grid items use first-free row-major placement instead — see
 * {@link placePageItem}.)
 */
export function newCanvasItemRect(args: NewCanvasItemRectArgs): CanvasRect {
  const cellWidth = Math.round(CANVAS_UNITS / Math.max(1, args.grid.columns));
  const cellHeight = Math.round(CANVAS_UNITS / Math.max(1, args.grid.rows));
  const index = Math.max(0, Math.trunc(args.index));
  const step = Math.max(1, Math.round(cellWidth / CASCADE_STEP_DIVISOR));

  return {
    x: clampNumber((args.anchor?.x ?? 0) + index * step, 0, CANVAS_UNITS - cellWidth),
    y: clampNumber((args.anchor?.y ?? 0) + index * step, 0, CANVAS_UNITS - cellHeight),
    width: cellWidth,
    height: cellHeight,
  };
}

/** Where a newly placed page item lands. */
export interface PageItemPlacement {
  /** Cascade offset for freeform pages: the page's item count, or a child index on dissolve. */
  readonly index: number;
  /** Dissolve anchor: where the first child starts (rect for freeform, cell for Grid). */
  readonly anchor?: CanvasRect;
  /**
   * Dissolve anchor cell for Grid pages — the folder shell's column/row.
   * Takes precedence over `anchor` in Grid mode.
   */
  readonly anchorCell?: { readonly column: number; readonly row: number };
  /** Preserved source size (relocating a freeform app that already had a rect). */
  readonly size?: { readonly width: number; readonly height: number };
  /** Preserved source span (relocating between Grid pages). */
  readonly span?: { readonly columnSpan: number; readonly rowSpan: number };
}

/** Clamp a span into the column count, keeping at least one cell. */
function clampSpan(
  span: { readonly columnSpan: number; readonly rowSpan: number },
  columns: number,
): { readonly columnSpan: number; readonly rowSpan: number } {
  return {
    columnSpan: Math.min(Math.max(1, Math.trunc(span.columnSpan)), columns),
    rowSpan: Math.max(1, Math.trunc(span.rowSpan)),
  };
}

/** Derive a Grid span from a freeform rect through the target page lattice. */
export function spanFromFreeformRect(
  rect: CanvasRect,
  grid: GridDefinition,
): { readonly columnSpan: number; readonly rowSpan: number } {
  const geometry = canvasRectToGridGeometry(
    { ...rect, width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) },
    grid,
  );
  return { columnSpan: geometry.columnSpan, rowSpan: geometry.rowSpan };
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

/**
 * Append `itemId` to a page at its deterministic default position,
 * materializing legacy/v1 geometry into a stored v2 canvas first.
 *
 * Grid pages place the item at the first free row-major location for its
 * span (default 1×1; a preserved span is clamped into the columns) — rows
 * are unbounded, so Grid creation never fails for space. Freeform pages
 * cascade continuously from the anchor (dissolve) or the origin.
 */
export function placePageItem(
  page: DesktopPage,
  itemId: EntityId,
  placement: PageItemPlacement,
): DesktopPage & { canvas: PagePlacement } {
  const materialized = materializePagePlacement(page);

  if (materialized.canvas.mode === "grid") {
    const base = materialized.canvas;
    const span = clampSpan(placement.span ?? { columnSpan: 1, rowSpan: 1 }, base.columns);
    const origin =
      placement.anchorCell ??
      (placement.anchor === undefined
        ? undefined
        : latticeCellOf(placement.anchor, page.layout.grid));
    const position = firstFreeGridPlacement(base, span, origin ?? {});
    return { ...materialized, canvas: appendGridItem(base, { id: itemId, ...position, ...span }) };
  }

  const base = materialized.canvas;
  const cascade = newCanvasItemRect({
    grid: page.layout.grid,
    index: placement.index,
    ...(placement.anchor === undefined ? {} : { anchor: placement.anchor }),
  });
  const rect = placement.size === undefined ? cascade : fitSizeIntoCanvas(cascade, placement.size);

  return { ...materialized, canvas: appendCanvasItem(base, { id: itemId, rect }) as FreeformCanvasLayoutV2 };
}

/**
 * Snap a freeform rect fully onto the page lattice — the geometry side of a
 * freeform→grid mode switch.
 */
export function snappedRectForGrid(rect: CanvasRect, grid: GridDefinition): CanvasRect {
  return canvasRectToSnappedRect(rect, grid);
}

/**
 * The geometry an entity currently occupies, when it lives on a page:
 * a freeform rect size or a Grid span. Legacy grid geometry reports a
 * derived span, because that IS the size the item keeps when the page
 * materializes.
 */
export function placementSizeOf(
  workspacePages: readonly DesktopPage[],
  itemId: EntityId,
):
  | { readonly kind: "rect"; readonly width: number; readonly height: number }
  | { readonly kind: "span"; readonly columnSpan: number; readonly rowSpan: number }
  | undefined {
  for (const page of workspacePages) {
    if (!pageItemIds(page).includes(itemId)) {
      continue;
    }
    const placement = resolvePagePlacement(page);
    if (placement.mode === "grid") {
      const item = placement.items.find((candidate) => candidate.id === itemId);
      if (item !== undefined) {
        return { kind: "span", columnSpan: item.columnSpan, rowSpan: item.rowSpan };
      }
    } else {
      const item = findCanvasItem(placement, itemId);
      if (item !== undefined && "rect" in item) {
        return { kind: "rect", width: item.rect.width, height: item.rect.height };
      }
    }
  }
  return undefined;
}

/** A page's stored Grid canvas, when it already has one. */
export function gridPlacementOf(page: DesktopPage): GridCanvasLayoutV2 | undefined {
  const placement = page.canvas;
  return placement !== undefined && placement.version === 2 && placement.mode === "grid"
    ? placement
    : undefined;
}

export type { GridCanvasItem, GridCanvasLayoutV2, FreeformCanvasLayoutV2 };
