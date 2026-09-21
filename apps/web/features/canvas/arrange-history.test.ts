import { describe, expect, it } from "vitest";

import { arePageLayoutsEqual } from "@veladesk/desktop-engine";
import type { LayoutHistory, PageLayout } from "@veladesk/desktop-engine";

import {
  commitPageLayout,
  historyForPage,
  reconcilePageHistory,
  undoPageLayout,
  redoPageLayout,
  canUndo,
  canRedo,
  restoreHistories,
} from "./arrange-history";

const layout = (itemColumn: number): PageLayout => ({
  id: "page-1",
  grid: { columns: 4, rows: 4 },
  items: [{ id: "a", position: { column: itemColumn, row: 0 }, span: { columns: 1, rows: 1 } }],
});

const layoutOther = (itemColumn: number): PageLayout => ({
  id: "page-2",
  grid: { columns: 4, rows: 4 },
  items: [{ id: "d", position: { column: itemColumn, row: 0 }, span: { columns: 1, rows: 1 } }],
});

describe("arrange history", () => {
  it("starts empty and creates a page history on first commit", () => {
    let histories: Record<string, LayoutHistory> = {};
    expect(historyForPage(histories, "page-1")).toBeUndefined();

    histories = commitPageLayout(histories, "page-1", layout(1));
    const history = historyForPage(histories, "page-1");
    expect(history?.present.items[0]?.position.column).toBe(1);
    expect(history?.past).toHaveLength(0);
  });

  it("commits movements and undoes/redoes them", () => {
    let histories = commitPageLayout({}, "page-1", layout(1));
    histories = commitPageLayout(histories, "page-1", layout(2));
    expect(canUndo(histories, "page-1")).toBe(true);

    histories = undoPageLayout(histories, "page-1");
    expect(historyForPage(histories, "page-1")?.present.items[0]?.position.column).toBe(1);
    expect(canRedo(histories, "page-1")).toBe(true);

    histories = redoPageLayout(histories, "page-1");
    expect(historyForPage(histories, "page-1")?.present.items[0]?.position.column).toBe(2);
  });

  it("clears the redo branch on a new commit", () => {
    let histories = commitPageLayout({}, "page-1", layout(1));
    histories = commitPageLayout(histories, "page-1", layout(2));
    histories = undoPageLayout(histories, "page-1");
    expect(canRedo(histories, "page-1")).toBe(true);

    histories = commitPageLayout(histories, "page-1", layout(3));
    expect(canRedo(histories, "page-1")).toBe(false);
  });

  it("keeps histories for a semantically identical replacement layout", () => {
    let histories = commitPageLayout({}, "page-1", layout(1));
    histories = commitPageLayout(histories, "page-1", layout(2));
    const before = historyForPage(histories, "page-1");

    // A server ack / IndexedDB round-trip produces a fresh object with the
    // same content: past/future must survive, only the present is rebased.
    const freshReference: PageLayout = {
      ...layout(2),
      items: [{ id: "a", position: { column: 2, row: 0 }, span: { columns: 1, rows: 1 } }],
    };
    expect(arePageLayoutsEqual(before!.present, freshReference)).toBe(true);

    const reconciled = reconcilePageHistory(histories, "page-1", freshReference);
    expect(reconciled).not.toBe(histories);
    const after = historyForPage(reconciled, "page-1");
    expect(after?.past).toEqual(before?.past);
    expect(after?.future).toEqual(before?.future);
    expect(after?.present).toBe(freshReference);
  });

  it("returns the same reference when reconcile has nothing to change", () => {
    const histories = commitPageLayout({}, "page-1", layout(1));
    expect(
      reconcilePageHistory(histories, "page-1", historyForPage(histories, "page-1")!.present),
    ).toBe(histories);
    // No history for the page: nothing to reconcile.
    expect(reconcilePageHistory({}, "page-1", layout(1))).toEqual({});
  });

  it("resets history on a semantically different external layout", () => {
    let histories = commitPageLayout({}, "page-1", layout(1));
    histories = commitPageLayout(histories, "page-1", layout(2));

    const external = layout(3);
    // Simulate an added/removed entity changing the item list too.
    const externalWithItems: PageLayout = {
      ...external,
      items: [
        ...external.items,
        { id: "b", position: { column: 1, row: 0 }, span: { columns: 1, rows: 1 } },
      ],
    };
    const reconciled = reconcilePageHistory(histories, "page-1", externalWithItems);
    const history = historyForPage(reconciled, "page-1");
    expect(history?.past).toHaveLength(0);
    expect(history?.present).toBe(externalWithItems);
  });

  it("keeps per-page histories independent", () => {
    let histories = commitPageLayout({}, "page-1", layout(1));
    histories = commitPageLayout(histories, "page-2", layoutOther(2));
    histories = undoPageLayout(histories, "page-2");
    histories = commitPageLayout(histories, "page-1", layout(3));

    expect(historyForPage(histories, "page-1")?.present.items[0]?.position.column).toBe(3);
    expect(historyForPage(histories, "page-2")?.present.items[0]?.position.column).toBe(2);
    expect(canUndo(histories, "page-2")).toBe(false);
  });

  it("caps the past at the engine's 50-entry limit", () => {
    let histories: Record<string, LayoutHistory> = {};
    for (let column = 0; column < 60; column += 1) {
      histories = commitPageLayout(histories, "page-1", layout(column));
    }
    expect(historyForPage(histories, "page-1")?.past).toHaveLength(50);
  });

  it("supports stage-failure rollback by restoring the previous map", () => {
    const before = commitPageLayout({}, "page-1", layout(1));
    commitPageLayout(before, "page-1", layout(2)); // refused candidate

    // Stage refused: drop the candidate map entirely.
    const rolledBack = restoreHistories(before);
    expect(rolledBack).toBe(before);
    expect(historyForPage(rolledBack, "page-1")?.present.items[0]?.position.column).toBe(1);
  });
});
