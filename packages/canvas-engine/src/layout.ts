import { canvasRectsEqual, validateCanvasRect } from "./rect";
import type {
  CanvasLayout,
  CanvasLayoutItem,
  CanvasLayoutV1,
  CanvasPlacementMode,
  CanvasValidationIssue,
  FreeformCanvasLayoutV2,
  GridCanvasItem,
  GridCanvasLayoutV2,
  RectCanvasLayout,
} from "./types";
import { gridItemsEqual, validateGridCanvasItems } from "./grid";

/** True when `value` is a legal v1 placement mode. */
export function isCanvasPlacementMode(value: unknown): value is CanvasPlacementMode {
  return value === "snap" || value === "freeform";
}

/** Rect-item pass shared by v1 (both modes) and v2 freeform. */
function validateRectItems(
  layout: RectCanvasLayout,
): readonly CanvasValidationIssue[] {
  const issues: CanvasValidationIssue[] = [];
  const seen = new Set<string>();

  for (const item of layout.items) {
    if (seen.has(item.id)) {
      issues.push({ type: "duplicate-item-id", itemId: item.id });
    } else {
      seen.add(item.id);
    }

    const problems = validateCanvasRect(item.rect);
    if (problems.length > 0) {
      issues.push({ type: "invalid-rect", itemId: item.id, problems });
    }
  }

  return issues;
}

/**
 * Whole-layout validation across all canvas versions.
 *
 * v1 keeps its historical rules; v2 Grid validates integer cell geometry
 * against `columns`; v2 Freeform applies the v1 rect rules. Issue order is
 * deterministic: version, mode, columns (Grid only), then one pass over
 * items in array order (duplicate id before geometry problems).
 *
 * Never throws and never mutates.
 */
export function validateCanvasLayout(layout: CanvasLayout): readonly CanvasValidationIssue[] {
  const wide = layout as { version: number; mode: string };

  if (wide.version === 2 && wide.mode === "grid") {
    const grid = layout as GridCanvasLayoutV2;
    const issues: CanvasValidationIssue[] = [];
    if (!Number.isSafeInteger(grid.columns) || grid.columns <= 0) {
      issues.push({ type: "invalid-columns", columns: grid.columns });
    }
    issues.push(...validateGridCanvasItems(grid.items, grid.columns));
    return issues;
  }

  if (wide.version === 2) {
    if (wide.mode !== "freeform") {
      return [{ type: "invalid-mode", mode: String(wide.mode) }];
    }
    return validateRectItems(layout as FreeformCanvasLayoutV2);
  }

  // v1-shaped (or malformed) input: the historical accumulation order —
  // version, mode, then one items pass — so old snapshots report exactly as
  // they always did.
  const issues: CanvasValidationIssue[] = [];

  if (wide.version !== 1) {
    issues.push({ type: "invalid-version", version: wide.version });
  }

  if (!isCanvasPlacementMode(wide.mode)) {
    issues.push({ type: "invalid-mode", mode: String(wide.mode) });
  }

  issues.push(...validateRectItems(layout as CanvasLayoutV1));

  return issues;
}

/**
 * Structural equality of two layouts of any version: version, mode, Grid
 * columns, order and per-item geometry.
 */
export function areCanvasLayoutsEqual(a: CanvasLayout, b: CanvasLayout): boolean {
  if (a === b) {
    return true;
  }

  if (a.version !== b.version || a.mode !== b.mode || a.items.length !== b.items.length) {
    return false;
  }

  if (a.version === 2 && a.mode === "grid" && b.version === 2 && b.mode === "grid") {
    if (a.columns !== b.columns) {
      return false;
    }
    for (let index = 0; index < a.items.length; index += 1) {
      const left = a.items[index] as GridCanvasItem;
      const right = b.items[index] as GridCanvasItem;
      if (!gridItemsEqual(left, right)) {
        return false;
      }
    }
    return true;
  }

  for (let index = 0; index < a.items.length; index += 1) {
    const left = a.items[index] as CanvasLayoutItem;
    const right = b.items[index] as CanvasLayoutItem;
    if (left.id !== right.id || !canvasRectsEqual(left.rect, right.rect)) {
      return false;
    }
  }

  return true;
}

/** Ids in canvas order. This is the page membership when a canvas exists. */
export function canvasItemIds(layout: CanvasLayout): readonly string[] {
  return layout.items.map((item) => item.id);
}

/** Any item (rect or Grid) by id, in a type-safe union. */
export function findCanvasItem(
  layout: CanvasLayout,
  itemId: string,
): CanvasLayoutItem | GridCanvasItem | undefined {
  return layout.items.find((item) => item.id === itemId) as
    | CanvasLayoutItem
    | GridCanvasItem
    | undefined;
}

/**
 * Replace a rect item by id (v1 and v2 freeform layouts). Unknown ids and
 * equal replacements return the input.
 */
export function replaceCanvasItem(
  layout: RectCanvasLayout,
  item: CanvasLayoutItem,
): RectCanvasLayout {
  const index = layout.items.findIndex((candidate) => candidate.id === item.id);

  if (index === -1) {
    return layout;
  }

  const current = layout.items[index];
  if (current !== undefined && canvasRectsEqual(current.rect, item.rect)) {
    return layout;
  }

  const items = layout.items.map((candidate, candidateIndex) =>
    candidateIndex === index ? item : candidate,
  );

  return { ...layout, items };
}

/** Remove by id (any canvas version). Unknown ids return the input reference. */
export function removeCanvasItem(layout: CanvasLayout, itemId: string): CanvasLayout {
  const items = layout.items.filter((item) => item.id !== itemId);

  if (items.length === layout.items.length) {
    return layout;
  }

  return { ...layout, items } as CanvasLayout;
}

/**
 * Append a rect item at the end (v1 and v2 freeform layouts; array order is
 * the stable item order).
 *
 * Callers own id uniqueness — use {@link replaceCanvasItem} to update an
 * existing item.
 */
export function appendCanvasItem(
  layout: RectCanvasLayout,
  item: CanvasLayoutItem,
): RectCanvasLayout {
  return { ...layout, items: [...layout.items, item] };
}

/** Change the v1 placement mode. Same mode returns the input reference. */
export function withCanvasMode(
  layout: CanvasLayoutV1,
  mode: CanvasPlacementMode,
): CanvasLayoutV1 {
  if (layout.mode === mode) {
    return layout;
  }

  return { ...layout, mode };
}

/** Replace the whole rect item list (v1 and v2 freeform; order as given). */
export function withCanvasItems(
  layout: RectCanvasLayout,
  items: readonly CanvasLayoutItem[],
): RectCanvasLayout {
  return { ...layout, items };
}

