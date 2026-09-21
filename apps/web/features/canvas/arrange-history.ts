import {
  areCanvasLayoutsEqual,
  canRedoCanvas,
  canUndoCanvas,
  commitCanvas,
  createCanvasHistory,
  redoCanvas,
  undoCanvas,
} from "@veladesk/canvas-engine";
import type { CanvasHistory, CanvasLayout } from "@veladesk/canvas-engine";

/**
 * Per-page arrange history: one canvas history per page id, session-only.
 *
 * Only geometry edits are recorded — move and resize. Adding or deleting an
 * app, section CRUD, appearance edits and placement-mode switches are
 * structural: their canvas diverges from the recorded one, and
 * `reconcilePageCanvasHistory` resets the page branch instead of handing
 * back a canvas the user can no longer reach. The legacy grid history in
 * @veladesk/desktop-engine stays untouched for the interaction lab.
 *
 * All transitions are immutable map replacements, so a refused stage rolls
 * back by simply not accepting the candidate map (`restoreHistories`).
 */
export type ArrangeCanvasHistories = Readonly<Record<string, CanvasHistory>>;

/** The history recorded for a page, if any geometry edit was committed yet. */
export function historyForPage(
  histories: ArrangeCanvasHistories,
  pageId: string,
): CanvasHistory | undefined {
  return histories[pageId];
}

/** Commit one geometry edit on a page (creating the page history on first use). */
export function commitPageCanvas(
  histories: ArrangeCanvasHistories,
  pageId: string,
  nextCanvas: CanvasLayout,
): ArrangeCanvasHistories {
  const existing = histories[pageId];
  const next =
    existing === undefined
      ? createCanvasHistory(nextCanvas)
      : commitCanvas(existing, nextCanvas);
  return { ...histories, [pageId]: next };
}

export function undoPageCanvas(
  histories: ArrangeCanvasHistories,
  pageId: string,
): ArrangeCanvasHistories {
  const existing = histories[pageId];
  if (existing === undefined) {
    return histories;
  }
  return { ...histories, [pageId]: undoCanvas(existing) };
}

export function redoPageCanvas(
  histories: ArrangeCanvasHistories,
  pageId: string,
): ArrangeCanvasHistories {
  const existing = histories[pageId];
  if (existing === undefined) {
    return histories;
  }
  return { ...histories, [pageId]: redoCanvas(existing) };
}

export function canUndo(histories: ArrangeCanvasHistories, pageId: string): boolean {
  const history = histories[pageId];
  return history !== undefined && canUndoCanvas(history);
}

export function canRedo(histories: ArrangeCanvasHistories, pageId: string): boolean {
  const history = histories[pageId];
  return history !== undefined && canRedoCanvas(history);
}

/**
 * Reconciles one page's history with the CURRENT canvas after a workspace
 * update (stage ack, another edit, remote pull).
 *
 * An identical canvas only rebases the present reference — past and future
 * survive. A canvas that differs resets the page history, so undo can never
 * resurrect items a structural edit removed.
 */
export function reconcilePageCanvasHistory(
  histories: ArrangeCanvasHistories,
  pageId: string,
  currentCanvas: CanvasLayout,
): ArrangeCanvasHistories {
  const existing = histories[pageId];
  if (existing === undefined) {
    return histories;
  }
  if (existing.present === currentCanvas) {
    return histories;
  }
  if (areCanvasLayoutsEqual(existing.present, currentCanvas)) {
    return { ...histories, [pageId]: { ...existing, present: currentCanvas } };
  }
  return { ...histories, [pageId]: createCanvasHistory(currentCanvas) };
}

/**
 * Resets a page's history to a fresh branch rooted at `canvas` — used by the
 * structural edits that are deliberately NOT undoable: placement-mode
 * switches, and any edit that changes the page's item set.
 */
export function resetPageCanvasHistory(
  histories: ArrangeCanvasHistories,
  pageId: string,
  canvas: CanvasLayout,
): ArrangeCanvasHistories {
  if (histories[pageId] === undefined) {
    return histories;
  }
  return { ...histories, [pageId]: createCanvasHistory(canvas) };
}

/**
 * Stage-failure rollback: restore the previous history map wholesale, so a
 * refused stage never leaves a phantom history entry behind.
 */
export function restoreHistories(
  previousHistories: ArrangeCanvasHistories,
): ArrangeCanvasHistories {
  return previousHistories;
}
