import type { LayoutValidationIssue, PageLayout } from "./types";
import { isValidGridDefinition, isValidGridPosition, isValidGridSpan } from "./grid";
import { isRectWithinGrid, rectsOverlap, toGridRect } from "./geometry";

/**
 * Reports every discoverable defect of a page layout instead of throwing.
 *
 * Deterministic issue order:
 * 1. `invalid-grid` at most once, first, when the grid definition itself is
 *    malformed. Bounds are never judged against an invalid grid, so no
 *    `out-of-bounds` issues are derived from it; grid-independent defects
 *    (duplicate ids, invalid positions/spans, overlaps) still are.
 * 2. Per-item issues in item array order. Within one item:
 *    duplicate-id, invalid-position, invalid-span, out-of-bounds
 *    (bounds are only checked when the grid, position and span are valid).
 * 3. Overlap pairs among items with valid position and span, scanned by
 *    ascending array indices, so each colliding pair is reported exactly
 *    once as [earlier item id, later item id].
 */
export function validatePageLayout(layout: PageLayout): readonly LayoutValidationIssue[] {
  const issues: LayoutValidationIssue[] = [];
  const gridValid = isValidGridDefinition(layout.grid);
  if (!gridValid) {
    issues.push({ type: "invalid-grid" });
  }
  const seenIds = new Set<string>();
  const geometryItems = [];

  for (const item of layout.items) {
    if (seenIds.has(item.id)) {
      issues.push({ type: "duplicate-id", itemId: item.id });
    } else {
      seenIds.add(item.id);
    }

    const positionValid = isValidGridPosition(item.position);
    const spanValid = isValidGridSpan(item.span);
    if (!positionValid) {
      issues.push({ type: "invalid-position", itemId: item.id });
    }
    if (!spanValid) {
      issues.push({ type: "invalid-span", itemId: item.id });
    }
    if (positionValid && spanValid) {
      if (gridValid && !isRectWithinGrid(layout.grid, toGridRect(item))) {
        issues.push({ type: "out-of-bounds", itemId: item.id });
      }
      geometryItems.push(item);
    }
  }

  for (let i = 0; i < geometryItems.length; i += 1) {
    for (let j = i + 1; j < geometryItems.length; j += 1) {
      const first = geometryItems[i]!;
      const second = geometryItems[j]!;
      if (rectsOverlap(toGridRect(first), toGridRect(second))) {
        issues.push({ type: "overlap", itemIds: [first.id, second.id] });
      }
    }
  }

  return issues;
}
