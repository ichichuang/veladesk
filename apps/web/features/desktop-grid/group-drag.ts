import type { GridPosition, GridTranslation, LayoutItemId } from "@veladesk/desktop-engine";

/**
 * Pure helpers for rigid group drags.
 *
 * The drag source defines the gesture; the selection defines what moves.
 * When the source is part of the selection the whole selection drags as
 * one rigid group, otherwise the drag is the source alone (so users never
 * have to select before dragging).
 */

/**
 * The layout item ids this drag moves: the whole selection when the source
 * belongs to it, otherwise just the source. Selection order is preserved.
 */
export function resolveDragItemIds(
  sourceId: LayoutItemId,
  selection: ReadonlySet<LayoutItemId>,
): readonly LayoutItemId[] {
  if (!selection.has(sourceId)) {
    return [sourceId];
  }
  return [...selection];
}

/** The rigid grid translation that carries the source to its desired cell. */
export function translationFromDesired(
  sourceStart: GridPosition,
  desired: GridPosition,
): GridTranslation {
  return {
    columnDelta: desired.column - sourceStart.column,
    rowDelta: desired.row - sourceStart.row,
  };
}
