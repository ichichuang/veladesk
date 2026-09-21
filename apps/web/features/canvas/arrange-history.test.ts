import { describe, expect, it } from "vitest";

import { areCanvasLayoutsEqual } from "@veladesk/canvas-engine";
import type { PagePlacement } from "@veladesk/domain";

import {
  canRedo,
  canUndo,
  commitPageCanvas,
  historyForPage,
  reconcilePageCanvasHistory,
  redoPageCanvas,
  resetPageCanvasHistory,
  restoreHistories,
  undoPageCanvas,
} from "./arrange-history";
import type { ArrangeCanvasHistories } from "./arrange-history";

const canvas = (itemX: number): PagePlacement => ({
  version: 2,
  mode: "freeform",
  items: [{ id: "a", rect: { x: itemX, y: 0, width: 1000, height: 1000 } }],
});

const otherCanvas = (itemX: number): PagePlacement => ({
  version: 2,
  mode: "freeform",
  items: [{ id: "d", rect: { x: itemX, y: 0, width: 1000, height: 1000 } }],
});

function freeformWith(
  items: readonly { id: string; rect: { x: number; y: number; width: number; height: number } }[],
): PagePlacement {
  return { version: 2, mode: "freeform", items };
}

function rectX(histories: ArrangeCanvasHistories, pageId: string): number | undefined {
  const item = historyForPage(histories, pageId)?.present.items[0];
  return item !== undefined && "rect" in item ? item.rect.x : undefined;
}

function rectWidth(histories: ArrangeCanvasHistories, pageId: string): number | undefined {
  const item = historyForPage(histories, pageId)?.present.items[0];
  return item !== undefined && "rect" in item ? item.rect.width : undefined;
}

describe("arrange canvas history", () => {
  it("starts empty and creates a page history on first commit", () => {
    const histories: ArrangeCanvasHistories = {};
    expect(historyForPage(histories, "page-1")).toBeUndefined();

    const committed = commitPageCanvas(histories, "page-1", canvas(1000));
    expect(rectX(committed, "page-1")).toBe(1000);
    expect(historyForPage(committed, "page-1")?.past).toHaveLength(0);
  });

  it("records moves and resizes and undoes/redoes them", () => {
    let histories = commitPageCanvas({}, "page-1", canvas(1000));
    // A resize is just another geometry edit for the history.
    histories = commitPageCanvas(
      histories,
      "page-1",
      freeformWith([{ id: "a", rect: { x: 1000, y: 0, width: 4000, height: 500 } }]),
    );
    expect(canUndo(histories, "page-1")).toBe(true);

    histories = undoPageCanvas(histories, "page-1");
    expect(rectWidth(histories, "page-1")).toBe(1000);
    expect(canRedo(histories, "page-1")).toBe(true);

    histories = redoPageCanvas(histories, "page-1");
    expect(rectWidth(histories, "page-1")).toBe(4000);
  });

  it("ignores a commit identical to the present", () => {
    const histories = commitPageCanvas({}, "page-1", canvas(1000));
    const again = commitPageCanvas(histories, "page-1", canvas(1000));
    // The page history is untouched: a no-op geometry edit adds no step.
    expect(historyForPage(again, "page-1")).toBe(historyForPage(histories, "page-1"));
    expect(historyForPage(again, "page-1")?.past).toHaveLength(0);
  });

  it("clears the redo branch on a new commit", () => {
    let histories = commitPageCanvas({}, "page-1", canvas(1000));
    histories = commitPageCanvas(histories, "page-1", canvas(2000));
    histories = undoPageCanvas(histories, "page-1");
    expect(canRedo(histories, "page-1")).toBe(true);

    histories = commitPageCanvas(histories, "page-1", canvas(3000));
    expect(canRedo(histories, "page-1")).toBe(false);
  });

  it("keeps histories for a semantically identical replacement canvas", () => {
    let histories = commitPageCanvas({}, "page-1", canvas(1000));
    histories = commitPageCanvas(histories, "page-1", canvas(2000));
    const before = historyForPage(histories, "page-1");

    // A stage ack / IndexedDB round-trip produces a fresh object with the
    // same content: past/future survive, only the present is rebased.
    const freshReference: PagePlacement = freeformWith([
      { id: "a", rect: { x: 2000, y: 0, width: 1000, height: 1000 } },
    ]);
    expect(areCanvasLayoutsEqual(before!.present, freshReference)).toBe(true);

    const reconciled = reconcilePageCanvasHistory(histories, "page-1", freshReference);
    expect(reconciled).not.toBe(histories);
    const after = historyForPage(reconciled, "page-1");
    expect(after?.past).toEqual(before?.past);
    expect(after?.future).toEqual(before?.future);
    expect(after?.present).toBe(freshReference);
  });

  it("returns the same reference when reconcile has nothing to change", () => {
    const histories = commitPageCanvas({}, "page-1", canvas(1000));
    expect(
      reconcilePageCanvasHistory(histories, "page-1", historyForPage(histories, "page-1")!.present),
    ).toBe(histories);
    expect(reconcilePageCanvasHistory({}, "page-1", canvas(1000))).toEqual({});
  });

  it("resets history when a structural edit diverged the canvas", () => {
    let histories = commitPageCanvas({}, "page-1", canvas(1000));
    histories = commitPageCanvas(histories, "page-1", canvas(2000));

    // An added/removed entity changes the item set: undo must not be able to
    // bring back a canvas referencing items that are gone.
    const external: PagePlacement = freeformWith([
      { id: "a", rect: { x: 3000, y: 0, width: 1000, height: 1000 } },
      { id: "b", rect: { x: 4000, y: 0, width: 1000, height: 1000 } },
    ]);
    const reconciled = reconcilePageCanvasHistory(histories, "page-1", external);
    const history = historyForPage(reconciled, "page-1");
    expect(history?.past).toHaveLength(0);
    expect(history?.present).toBe(external);
  });

  it("resets a recorded branch on a placement-mode switch", () => {
    let histories = commitPageCanvas({}, "page-1", canvas(1000));
    histories = commitPageCanvas(histories, "page-1", canvas(2000));
    expect(canUndo(histories, "page-1")).toBe(true);

    const switched: PagePlacement = {
      version: 2,
      mode: "grid",
      columns: 6,
      items: [{ id: "a", column: 0, row: 0, columnSpan: 1, rowSpan: 1 }],
    };
    const reset = resetPageCanvasHistory(histories, "page-1", switched);

    expect(canUndo(reset, "page-1")).toBe(false);
    expect(canRedo(reset, "page-1")).toBe(false);
    expect(historyForPage(reset, "page-1")?.present).toBe(switched);
  });

  it("leaves other pages untouched when resetting one", () => {
    let histories = commitPageCanvas({}, "page-1", canvas(1000));
    histories = commitPageCanvas(histories, "page-2", canvas(5000));
    const reset = resetPageCanvasHistory(histories, "page-1", canvas(2000));

    expect(rectX(reset, "page-2")).toBe(5000);
    expect(rectX(reset, "page-1")).toBe(2000);
    expect(canUndo(reset, "page-1")).toBe(false);
  });

  it("keeps per-page histories independent", () => {
    let histories = commitPageCanvas({}, "page-1", canvas(1000));
    histories = commitPageCanvas(histories, "page-2", otherCanvas(2000));
    histories = undoPageCanvas(histories, "page-2");
    histories = commitPageCanvas(histories, "page-1", canvas(3000));

    expect(rectX(histories, "page-1")).toBe(3000);
    expect(rectX(histories, "page-2")).toBe(2000);
    expect(canUndo(histories, "page-2")).toBe(false);
  });

  it("caps the past at the engine's 50-entry limit", () => {
    let histories: ArrangeCanvasHistories = {};
    for (let step = 0; step < 60; step += 1) {
      histories = commitPageCanvas(histories, "page-1", canvas(step * 10));
    }
    expect(historyForPage(histories, "page-1")?.past).toHaveLength(50);
  });

  it("reports availability only for pages with a recorded branch", () => {
    const empty: ArrangeCanvasHistories = {};
    expect(canUndo(empty, "page-1")).toBe(false);
    expect(canRedo(empty, "page-1")).toBe(false);
  });

  it("supports stage-failure rollback by restoring the previous map", () => {
    const before = commitPageCanvas({}, "page-1", canvas(1000));
    commitPageCanvas(before, "page-1", canvas(2000)); // refused candidate

    const rolledBack = restoreHistories(before);
    expect(rolledBack).toBe(before);
    expect(rectX(rolledBack, "page-1")).toBe(1000);
  });
});
