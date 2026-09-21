import { areCanvasLayoutsEqual } from "./layout";
import { DEFAULT_CANVAS_HISTORY_LIMIT } from "./types";
import type { CanvasHistory, CanvasLayout } from "./types";

/**
 * Create a history whose present is `initial`. The input is not retained as
 * a past entry.
 */
export function createCanvasHistory(
  initial: CanvasLayout,
  limit: number = DEFAULT_CANVAS_HISTORY_LIMIT,
): CanvasHistory {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError(`limit must be a positive integer, received: ${limit}`);
  }

  return { past: [], present: initial, future: [], limit };
}

/** True when there is a previous snapshot to return to. */
export function canUndoCanvas(history: CanvasHistory): boolean {
  return history.past.length > 0;
}

/** True when there is a future snapshot to redo. */
export function canRedoCanvas(history: CanvasHistory): boolean {
  return history.future.length > 0;
}

/**
 * Record one new canvas state.
 *
 * A canvas equal to the present is dropped (same history reference), so a
 * no-op drag never adds an undo step. Committing clears the redo branch and
 * truncates the past to `limit`.
 */
export function commitCanvas(history: CanvasHistory, next: CanvasLayout): CanvasHistory {
  if (areCanvasLayoutsEqual(history.present, next)) {
    return history;
  }

  const past = [...history.past, history.present].slice(-history.limit);

  return { past, present: next, future: [], limit: history.limit };
}

/** Step back. An empty past returns the same history reference. */
export function undoCanvas(history: CanvasHistory): CanvasHistory {
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

/** Step forward. An empty future returns the same history reference. */
export function redoCanvas(history: CanvasHistory): CanvasHistory {
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

/**
 * Rebase the present without touching past/future.
 *
 * Used when an authoritative canvas arrives for the same page: identical
 * geometry keeps the branch, different geometry resets it.
 */
export function reconcileCanvasHistory(
  history: CanvasHistory,
  next: CanvasLayout,
): CanvasHistory {
  if (areCanvasLayoutsEqual(history.present, next)) {
    return history.present === next ? history : { ...history, present: next };
  }

  return createCanvasHistory(next, history.limit);
}
