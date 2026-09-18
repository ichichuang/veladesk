/**
 * Pure marquee-selection geometry.
 *
 * Client-coordinate rectangles only; intersection requires a positive
 * overlap area — merely touching an edge does not select.
 */
export interface ClientRectLike {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The axis-aligned bounding rect of two arbitrary drag corners. */
export function normalizeSelectionRect(
  cornerA: ClientRectLike,
  cornerB: ClientRectLike,
): ClientRectLike {
  return {
    left: Math.min(cornerA.left, cornerB.left),
    top: Math.min(cornerA.top, cornerB.top),
    right: Math.max(cornerA.right, cornerB.right),
    bottom: Math.max(cornerA.bottom, cornerB.bottom),
  };
}

/** Positive-area intersection: edge touching is deliberately excluded. */
export function rectsIntersect(a: ClientRectLike, b: ClientRectLike): boolean {
  // Degenerate (zero-area) rects — e.g. a not-yet-moved marquee — never
  // positively intersect anything.
  if (a.left >= a.right || a.top >= a.bottom || b.left >= b.right || b.top >= b.bottom) {
    return false;
  }
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Every item whose rect positively intersects the marquee, in item order. */
export function selectIntersectingItemIds(
  items: readonly { readonly id: string; readonly rect: ClientRectLike }[],
  marquee: ClientRectLike,
): readonly string[] {
  return items
    .filter((item) => rectsIntersect(item.rect, marquee))
    .map((item) => item.id);
}
