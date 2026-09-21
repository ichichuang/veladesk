import {
  arePageLayoutsEqual,
  commitLayout,
  createLayoutHistory,
  redoLayout,
  undoLayout,
} from "@veladesk/desktop-engine";
import type { LayoutHistory, PageLayout } from "@veladesk/desktop-engine";

/**
 * Per-page arrange history: one engine `LayoutHistory` per page id,
 * session-only.
 *
 * All transitions are immutable map replacements, so a staged workspace
 * update can be rolled back by simply not accepting the candidate map
 * (see `removePageHistory`).
 */
export type ArrangeHistories = Readonly<Record<string, LayoutHistory>>;

/** The history recorded for a page, if any movement was committed yet. */
export function historyForPage(
  histories: ArrangeHistories,
  pageId: string,
): LayoutHistory | undefined {
  return histories[pageId];
}

/** Commit a movement on a page (creating the page history on first use). */
export function commitPageLayout(
  histories: ArrangeHistories,
  pageId: string,
  nextLayout: PageLayout,
): ArrangeHistories {
  const existing = histories[pageId];
  const next =
    existing === undefined
      ? createLayoutHistory(nextLayout)
      : commitLayout(existing, nextLayout);
  return { ...histories, [pageId]: next };
}

export function undoPageLayout(histories: ArrangeHistories, pageId: string): ArrangeHistories {
  const existing = histories[pageId];
  if (existing === undefined) {
    return histories;
  }
  return { ...histories, [pageId]: undoLayout(existing) };
}

export function redoPageLayout(histories: ArrangeHistories, pageId: string): ArrangeHistories {
  const existing = histories[pageId];
  if (existing === undefined) {
    return histories;
  }
  return { ...histories, [pageId]: redoLayout(existing) };
}

export function canUndo(histories: ArrangeHistories, pageId: string): boolean {
  return (histories[pageId]?.past.length ?? 0) > 0;
}

export function canRedo(histories: ArrangeHistories, pageId: string): boolean {
  return (histories[pageId]?.future.length ?? 0) > 0;
}

/**
 * Reconciles one page's history with the CURRENT layout after an external
 * workspace update (server ack round-trip, another edit, remote pull).
 *
 * A layout that is semantically identical to `history.present` only
 * rebases the present reference — past and future survive. A semantically
 * different layout resets the page history, so undo can never resurrect a
 * dangling layout item. Pages without history are left untouched, and the
 * input map is returned untouched when there is nothing to do.
 */
export function reconcilePageHistory(
  histories: ArrangeHistories,
  pageId: string,
  currentLayout: PageLayout,
): ArrangeHistories {
  const existing = histories[pageId];
  if (existing === undefined) {
    return histories;
  }
  if (existing.present === currentLayout) {
    return histories;
  }
  if (arePageLayoutsEqual(existing.present, currentLayout)) {
    return { ...histories, [pageId]: { ...existing, present: currentLayout } };
  }
  return { ...histories, [pageId]: createLayoutHistory(currentLayout) };
}

/**
 * Stage-failure rollback: restore the previous history map wholesale. The
 * candidate map is dropped, so a refused stage never leaves a phantom
 * history entry behind.
 */
export function restoreHistories(previousHistories: ArrangeHistories): ArrangeHistories {
  return previousHistories;
}
