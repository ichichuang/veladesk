import { clampNumber } from "./rect";
import { CANVAS_UNITS, MIN_CANVAS_SIZE } from "./types";
import type { CanvasRect, CanvasResizeArgs, CanvasResizeHandle } from "./types";

interface Edges {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

function movesTop(handle: CanvasResizeHandle): boolean {
  return handle === "n" || handle === "nw" || handle === "ne";
}

function movesBottom(handle: CanvasResizeHandle): boolean {
  return handle === "s" || handle === "sw" || handle === "se";
}

function movesLeft(handle: CanvasResizeHandle): boolean {
  return handle === "w" || handle === "nw" || handle === "sw";
}

function movesRight(handle: CanvasResizeHandle): boolean {
  return handle === "e" || handle === "ne" || handle === "se";
}

/** A corner handle moves one horizontal and one vertical edge. */
export function isCornerHandle(handle: CanvasResizeHandle): boolean {
  return (movesLeft(handle) || movesRight(handle)) && (movesTop(handle) || movesBottom(handle));
}

/** The edge that stays put while a corner is dragged. */
function anchorOf(edges: Edges, handle: CanvasResizeHandle): { readonly x: number; readonly y: number } {
  return {
    x: movesLeft(handle) ? edges.right : edges.left,
    y: movesTop(handle) ? edges.bottom : edges.top,
  };
}

/**
 * Scale a rect to the start aspect ratio, anchored at the fixed corner.
 *
 * The axis that moved more relative to the start rect drives the other one
 * (dragging a corner up shrinks both dimensions, dragging it right widens
 * both). The ratio is then kept while shrinking to fit the canvas or growing
 * back to the minimum size.
 */
function fitAspectRatio(
  edges: Edges,
  handle: CanvasResizeHandle,
  start: CanvasRect,
  aspect: number,
): Edges {
  const anchor = anchorOf(edges, handle);
  const availableX = movesLeft(handle) ? anchor.x : CANVAS_UNITS - anchor.x;
  const availableY = movesTop(handle) ? anchor.y : CANVAS_UNITS - anchor.y;

  const draggedWidth = edges.right - edges.left;
  const draggedHeight = edges.bottom - edges.top;
  const relativeWidth = Math.abs(draggedWidth - start.width) / start.width;
  const relativeHeight = Math.abs(draggedHeight - start.height) / start.height;

  let width = relativeWidth >= relativeHeight ? draggedWidth : draggedHeight * aspect;
  let height = relativeWidth >= relativeHeight ? draggedWidth / aspect : draggedHeight;

  if (!(width > 0)) {
    width = MIN_CANVAS_SIZE;
  }
  if (!(height > 0)) {
    height = MIN_CANVAS_SIZE;
  }

  const shrink = Math.min(1, availableX / width, availableY / height);
  width *= shrink;
  height *= shrink;

  const grow = Math.max(1, MIN_CANVAS_SIZE / Math.min(width, height));
  width *= grow;
  height *= grow;

  const left = movesLeft(handle) ? anchor.x - width : anchor.x;
  const top = movesTop(handle) ? anchor.y - height : anchor.y;

  return { left, top, right: left + width, bottom: top + height };
}

function toCanvasRect(edges: Edges, handle: CanvasResizeHandle): CanvasRect {
  let left = Math.round(edges.left);
  let top = Math.round(edges.top);
  let right = Math.round(edges.right);
  let bottom = Math.round(edges.bottom);

  if (right - left < MIN_CANVAS_SIZE) {
    if (movesLeft(handle)) {
      left = right - MIN_CANVAS_SIZE;
    } else {
      right = left + MIN_CANVAS_SIZE;
    }
  }

  if (bottom - top < MIN_CANVAS_SIZE) {
    if (movesTop(handle)) {
      top = bottom - MIN_CANVAS_SIZE;
    } else {
      bottom = top + MIN_CANVAS_SIZE;
    }
  }

  left = clampNumber(left, 0, CANVAS_UNITS - MIN_CANVAS_SIZE);
  top = clampNumber(top, 0, CANVAS_UNITS - MIN_CANVAS_SIZE);
  right = clampNumber(right, left + MIN_CANVAS_SIZE, CANVAS_UNITS);
  bottom = clampNumber(bottom, top + MIN_CANVAS_SIZE, CANVAS_UNITS);

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Pure resize math: pointer delta in logical units → new rect.
 *
 * The handle owns which edges move (`nw` moves the top and left edge, `e`
 * only the right edge, …), so the browser gets real rectangles: dragging `e`
 * changes width alone, dragging `s` height alone, and corners change both.
 * Only the canvas bounds and the minimum size clamp the result — there is no
 * grid, no fixed scale and no aspect lock unless `constrainAspect` is set
 * (Shift), which only corner handles honour.
 */
export function resizeCanvasRect(args: CanvasResizeArgs): CanvasRect {
  const { start, handle, deltaX, deltaY, constrainAspect } = args;

  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    return start;
  }

  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;

  if (movesLeft(handle)) {
    left = clampNumber(left + deltaX, 0, right - MIN_CANVAS_SIZE);
  }
  if (movesRight(handle)) {
    right = clampNumber(right + deltaX, left + MIN_CANVAS_SIZE, CANVAS_UNITS);
  }
  if (movesTop(handle)) {
    top = clampNumber(top + deltaY, 0, bottom - MIN_CANVAS_SIZE);
  }
  if (movesBottom(handle)) {
    bottom = clampNumber(bottom + deltaY, top + MIN_CANVAS_SIZE, CANVAS_UNITS);
  }

  let edges: Edges = { left, top, right, bottom };

  if (constrainAspect && isCornerHandle(handle)) {
    edges = fitAspectRatio(edges, handle, start, start.width / start.height);
  }

  return toCanvasRect(edges, handle);
}
