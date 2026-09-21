import { canvasRectsEqual, validateCanvasRect } from "./rect";
import type {
  CanvasLayout,
  CanvasLayoutItem,
  CanvasPlacementMode,
  CanvasValidationIssue,
} from "./types";

/** True when `value` is a legal placement mode. */
export function isCanvasPlacementMode(value: unknown): value is CanvasPlacementMode {
  return value === "snap" || value === "freeform";
}

/**
 * Whole-layout validation. Issue order is deterministic: version, mode, then
 * one pass over items in array order (duplicate id before rect problems).
 *
 * Never throws and never mutates.
 */
export function validateCanvasLayout(layout: CanvasLayout): readonly CanvasValidationIssue[] {
  const issues: CanvasValidationIssue[] = [];

  if (layout.version !== 1) {
    issues.push({ type: "invalid-version", version: layout.version });
  }

  if (!isCanvasPlacementMode(layout.mode)) {
    issues.push({ type: "invalid-mode", mode: String(layout.mode) });
  }

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

/** Structural equality of two canvases: version, mode, order and geometry. */
export function areCanvasLayoutsEqual(a: CanvasLayout, b: CanvasLayout): boolean {
  if (a === b) {
    return true;
  }

  if (a.version !== b.version || a.mode !== b.mode || a.items.length !== b.items.length) {
    return false;
  }

  for (let index = 0; index < a.items.length; index += 1) {
    const left = a.items[index];
    const right = b.items[index];

    if (left === undefined || right === undefined) {
      return false;
    }

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

/** Lookup by id. */
export function findCanvasItem(
  layout: CanvasLayout,
  itemId: string,
): CanvasLayoutItem | undefined {
  return layout.items.find((item) => item.id === itemId);
}

/** Replace by id. Unknown ids and equal replacements return the input. */
export function replaceCanvasItem(layout: CanvasLayout, item: CanvasLayoutItem): CanvasLayout {
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

/** Remove by id. Unknown ids return the input reference. */
export function removeCanvasItem(layout: CanvasLayout, itemId: string): CanvasLayout {
  const items = layout.items.filter((item) => item.id !== itemId);

  if (items.length === layout.items.length) {
    return layout;
  }

  return { ...layout, items };
}

/**
 * Append an item at the end (array order is the stable item order).
 *
 * Callers own id uniqueness — use {@link replaceCanvasItem} to update an
 * existing item.
 */
export function appendCanvasItem(layout: CanvasLayout, item: CanvasLayoutItem): CanvasLayout {
  return { ...layout, items: [...layout.items, item] };
}

/** Change the placement mode. Same mode returns the input reference. */
export function withCanvasMode(layout: CanvasLayout, mode: CanvasPlacementMode): CanvasLayout {
  if (layout.mode === mode) {
    return layout;
  }

  return { ...layout, mode };
}

/** Replace the whole item list (order preserved as given). */
export function withCanvasItems(
  layout: CanvasLayout,
  items: readonly CanvasLayoutItem[],
): CanvasLayout {
  return { ...layout, items };
}
