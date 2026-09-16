import type { LayoutHistory, PageLayout } from "./types";

export const DEFAULT_HISTORY_LIMIT = 50;

/**
 * Structural layout equality: page id, grid size, item count, item order,
 * and every item's id, position and span. No JSON serialization involved.
 */
export function arePageLayoutsEqual(a: PageLayout, b: PageLayout): boolean {
  if (a === b) {
    return true;
  }
  if (a.id !== b.id || a.grid.columns !== b.grid.columns || a.grid.rows !== b.grid.rows) {
    return false;
  }
  if (a.items.length !== b.items.length) {
    return false;
  }
  for (let index = 0; index < a.items.length; index += 1) {
    const left = a.items[index]!;
    const right = b.items[index]!;
    if (
      left.id !== right.id ||
      left.position.column !== right.position.column ||
      left.position.row !== right.position.row ||
      left.span.columns !== right.span.columns ||
      left.span.rows !== right.span.rows
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Snapshot history around one present layout. `limit` bounds how many past
 * snapshots are retained; it must be a positive integer.
 */
export function createLayoutHistory(
  initial: PageLayout,
  limit: number = DEFAULT_HISTORY_LIMIT,
): LayoutHistory {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError(`limit must be a positive finite integer, received: ${limit}`);
  }
  return { past: [], present: initial, future: [], limit };
}

/**
 * Commits the next layout. Semantically equal commits are ignored (same
 * reference back), real commits clear the redo branch and keep at most
 * `limit` past snapshots. Never mutates the input history.
 */
export function commitLayout(history: LayoutHistory, nextLayout: PageLayout): LayoutHistory {
  if (arePageLayoutsEqual(history.present, nextLayout)) {
    return history;
  }
  const past = [...history.past, history.present].slice(-history.limit);
  return { past, present: nextLayout, future: [], limit: history.limit };
}

/** Steps one snapshot back; returns the input reference when there is none. */
export function undoLayout(history: LayoutHistory): LayoutHistory {
  const previous = history.past.at(-1);
  if (previous === undefined) {
    return history;
  }
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    limit: history.limit,
  };
}

/** Steps one snapshot forward; returns the input reference when there is none. */
export function redoLayout(history: LayoutHistory): LayoutHistory {
  const next = history.future[0];
  if (next === undefined) {
    return history;
  }
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
    limit: history.limit,
  };
}
