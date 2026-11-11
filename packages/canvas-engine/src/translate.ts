import type { GridDefinition } from "@veladesk/desktop-engine";

import { canvasRectToSnappedRect } from "./lattice";
import { clampNumber } from "./rect";
import { CANVAS_UNITS } from "./types";
import type {
  CanvasLayoutV1,
  CanvasTranslation,
  FreeformCanvasLayoutV2,
} from "./types";


/** Rect-item layouts: v1 (both modes) and v2 freeform. */
type RectItemsLayout = CanvasLayoutV1 | FreeformCanvasLayoutV2;

interface CanvasBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxRight: number;
  readonly maxBottom: number;
}

function boundsOf(
  layout: RectItemsLayout,
  itemIds: ReadonlySet<string>,
): CanvasBounds | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxRight = Number.NEGATIVE_INFINITY;
  let maxBottom = Number.NEGATIVE_INFINITY;
  let found = false;

  for (const item of layout.items) {
    if (!itemIds.has(item.id)) {
      continue;
    }

    found = true;
    minX = Math.min(minX, item.rect.x);
    minY = Math.min(minY, item.rect.y);
    maxRight = Math.max(maxRight, item.rect.x + item.rect.width);
    maxBottom = Math.max(maxBottom, item.rect.y + item.rect.height);
  }

  return found ? { minX, minY, maxRight, maxBottom } : undefined;
}

/**
 * Round a raw logical translation and clamp it once for the whole selection.
 *
 * The clamp is computed from the group's bounding box, so every item moves by
 * the same delta and the group can never scatter against the canvas edge.
 *
 * t63 "air wall": a v2 Freeform layout is a downward-unbounded document —
 * `y` clamps only at the canvas origin (the group can never cross above the
 * top), never at the first viewport's bottom edge, so a drag can push
 * content any distance below the visible area and the scroller follows. v1
 * keeps the historical one-viewport bounds on both axes.
 */
export function clampCanvasTranslation(
  layout: RectItemsLayout,
  itemIds: readonly string[],
  deltaX: number,
  deltaY: number,
): CanvasTranslation {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    return { x: 0, y: 0 };
  }

  const bounds = boundsOf(layout, new Set(itemIds));

  if (bounds === undefined) {
    return { x: 0, y: 0 };
  }

  const maxY =
    layout.version === 2 ? Number.POSITIVE_INFINITY : CANVAS_UNITS - bounds.maxBottom;

  return {
    x: clampNumber(Math.round(deltaX), -bounds.minX, CANVAS_UNITS - bounds.maxRight),
    y: clampNumber(Math.round(deltaY), -bounds.minY, maxY),
  };
}

/**
 * Rigidly translate a selection by a continuous logical delta.
 *
 * Freeform semantics: no grid involvement, no collision check — overlapping
 * another item is legal and never fails a translation. Items outside the
 * selection and the untouched canvas fields keep their identity.
 */
export function translateCanvasItems(
  layout: RectItemsLayout,
  itemIds: readonly string[],
  deltaX: number,
  deltaY: number,
): RectItemsLayout {
  const { x, y } = clampCanvasTranslation(layout, itemIds, deltaX, deltaY);

  if (x === 0 && y === 0) {
    return layout;
  }

  const wanted = new Set(itemIds);

  return {
    ...layout,
    items: layout.items.map((item) =>
      wanted.has(item.id)
        ? { id: item.id, rect: { ...item.rect, x: item.rect.x + x, y: item.rect.y + y } }
        : item,
    ),
  };
}

/**
 * Raise a selection to the TOP of the freeform z-order (P1).
 *
 * Item order is the freeform stacking order; a raised selection moves to
 * the END of the array (relative order inside the selection preserved),
 * everything else keeps its relative order. Items not on the canvas are
 * ignored; an empty or no-op selection returns the input identity — the
 * caller treats that as "nothing to commit".
 */
export function raiseCanvasItems(
  layout: RectItemsLayout,
  itemIds: readonly string[],
): RectItemsLayout {
  const wanted = new Set(itemIds);
  const raised = layout.items.filter((item) => wanted.has(item.id));
  if (raised.length === 0 || raised.length === layout.items.length) {
    return layout;
  }
  return {
    ...layout,
    items: [...layout.items.filter((item) => !wanted.has(item.id)), ...raised],
  };
}

/**
 * Snap translation for a whole group, resolved from ONE anchor.
 *
 * The anchor is the first selected item in canvas order. Its snapped target
 * position defines a single delta reused by every selected item, so a snap
 * drag keeps relative geometry (never per-item snapping, which would tear the
 * group apart).
 */
export function snapCanvasTranslation(
  layout: CanvasLayoutV1,
  itemIds: readonly string[],
  deltaX: number,
  deltaY: number,
  grid: GridDefinition,
): CanvasTranslation {
  const wanted = new Set(itemIds);
  const anchor = layout.items.find((item) => wanted.has(item.id));

  if (anchor === undefined || !Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    return { x: 0, y: 0 };
  }

  const candidate = {
    x: clampNumber(Math.round(anchor.rect.x + deltaX), 0, CANVAS_UNITS - anchor.rect.width),
    y: clampNumber(Math.round(anchor.rect.y + deltaY), 0, CANVAS_UNITS - anchor.rect.height),
    width: anchor.rect.width,
    height: anchor.rect.height,
  };
  const snapped = canvasRectToSnappedRect(candidate, grid);

  return clampCanvasTranslation(
    layout,
    itemIds,
    snapped.x - anchor.rect.x,
    snapped.y - anchor.rect.y,
  );
}
