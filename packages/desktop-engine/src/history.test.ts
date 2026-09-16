import { describe, expect, it } from "vitest";

import {
  arePageLayoutsEqual,
  commitLayout,
  createLayoutHistory,
  redoLayout,
  undoLayout,
} from "./history";
import type { LayoutItem, PageLayout } from "./types";

function item(id: string, column: number, row: number, columns = 1, rows = 1): LayoutItem {
  return { id, position: { column, row }, span: { columns, rows } };
}

function layout(items: readonly LayoutItem[], id = "page-1"): PageLayout {
  return { id, grid: { columns: 4, rows: 4 }, items };
}

describe("createLayoutHistory", () => {
  it("defaults the snapshot limit to 50", () => {
    const history = createLayoutHistory(layout([item("a", 0, 0)]));
    expect(history.limit).toBe(50);
    expect(history.past).toEqual([]);
    expect(history.future).toEqual([]);
    expect(history.present).toEqual(layout([item("a", 0, 0)]));
  });

  it("accepts a custom positive integer limit", () => {
    expect(createLayoutHistory(layout([]), 3).limit).toBe(3);
  });

  it("throws RangeError for a zero limit", () => {
    expect(() => createLayoutHistory(layout([]), 0)).toThrow(RangeError);
  });

  it("throws RangeError for a negative limit", () => {
    expect(() => createLayoutHistory(layout([]), -1)).toThrow(RangeError);
  });

  it("throws RangeError for a fractional limit", () => {
    expect(() => createLayoutHistory(layout([]), 1.5)).toThrow(RangeError);
  });

  it("throws RangeError for NaN limit", () => {
    expect(() => createLayoutHistory(layout([]), Number.NaN)).toThrow(RangeError);
  });
});

describe("arePageLayoutsEqual", () => {
  it("treats the same reference as equal", () => {
    const source = layout([item("a", 0, 0)]);
    expect(arePageLayoutsEqual(source, source)).toBe(true);
  });

  it("compares layouts structurally", () => {
    expect(arePageLayoutsEqual(layout([item("a", 0, 0)]), layout([item("a", 0, 0)]))).toBe(true);
  });

  it("detects different page ids", () => {
    expect(arePageLayoutsEqual(layout([], "one"), layout([], "two"))).toBe(false);
  });

  it("detects different grids", () => {
    const small: PageLayout = { id: "page-1", grid: { columns: 2, rows: 2 }, items: [] };
    const big: PageLayout = { id: "page-1", grid: { columns: 3, rows: 2 }, items: [] };
    expect(arePageLayoutsEqual(small, big)).toBe(false);
  });

  it("detects different item counts", () => {
    expect(arePageLayoutsEqual(layout([]), layout([item("a", 0, 0)]))).toBe(false);
  });

  it("detects different item order", () => {
    const first = layout([item("a", 0, 0), item("b", 1, 0)]);
    const second = layout([item("b", 1, 0), item("a", 0, 0)]);
    expect(arePageLayoutsEqual(first, second)).toBe(false);
  });

  it("detects different positions", () => {
    expect(arePageLayoutsEqual(layout([item("a", 0, 0)]), layout([item("a", 1, 0)]))).toBe(false);
  });

  it("detects different spans", () => {
    expect(arePageLayoutsEqual(layout([item("a", 0, 0)]), layout([item("a", 0, 0, 2, 1)]))).toBe(
      false,
    );
  });

  it("detects different item ids", () => {
    expect(arePageLayoutsEqual(layout([item("a", 0, 0)]), layout([item("b", 0, 0)]))).toBe(false);
  });
});

describe("commitLayout", () => {
  it("pushes the present into past and installs the next layout", () => {
    const first = layout([item("a", 0, 0)]);
    const second = layout([item("a", 1, 0)]);
    const history = createLayoutHistory(first, 10);
    const committed = commitLayout(history, second);

    expect(committed.present).toBe(second);
    expect(committed.past).toEqual([first]);
    expect(committed.future).toEqual([]);
    // Input history is untouched.
    expect(history.past).toEqual([]);
    expect(history.present).toBe(first);
  });

  it("ignores commits that are semantically equal to the present", () => {
    const first = layout([item("a", 0, 0)]);
    const history = createLayoutHistory(first, 10);
    const movedAndBack = commitLayout(history, layout([item("a", 1, 0)]));
    const duplicate = commitLayout(movedAndBack, layout([item("a", 1, 0)]));

    expect(duplicate).toBe(movedAndBack);
    expect(duplicate.past).toEqual([first]);
  });

  it("clears the future on every real commit", () => {
    const first = layout([item("a", 0, 0)]);
    const second = layout([item("a", 1, 0)]);
    const third = layout([item("a", 2, 0)]);
    const history = createLayoutHistory(first, 10);
    const undone = undoLayout(commitLayout(history, second));
    expect(undone.future.length).toBe(1);

    const committed = commitLayout(undone, third);
    expect(committed.future).toEqual([]);
  });

  it("truncates the past to the limit", () => {
    const history = createLayoutHistory(layout([]), 1);
    const first = commitLayout(history, layout([item("a", 0, 0)]));
    const second = commitLayout(first, layout([item("a", 1, 0)]));

    expect(second.past.length).toBe(1);
    expect(second.past[0]).toEqual(layout([item("a", 0, 0)]));
    expect(second.present).toEqual(layout([item("a", 1, 0)]));
  });

  it("keeps the most recent snapshots under limit 3", () => {
    const history = createLayoutHistory(layout([]), 3);
    const steps = commitLayout(
      commitLayout(commitLayout(commitLayout(history, layout([item("a", 0, 0)])), layout([item("a", 1, 0)])), layout([item("a", 2, 0)])),
      layout([item("a", 3, 0)]),
    );
    expect(steps.past.length).toBe(3);
    expect(steps.past[0]).toEqual(layout([item("a", 0, 0)]));
    expect(steps.past[2]).toEqual(layout([item("a", 2, 0)]));
  });
});

describe("undoLayout", () => {
  it("restores the previous present and queues the current one for redo", () => {
    const first = layout([item("a", 0, 0)]);
    const second = layout([item("a", 1, 0)]);
    const history = commitLayout(createLayoutHistory(first, 10), second);
    const undone = undoLayout(history);

    expect(undone.present).toBe(first);
    expect(undone.past).toEqual([]);
    expect(undone.future).toEqual([second]);
    expect(history.past).toEqual([first]);
  });

  it("returns the same reference when past is empty", () => {
    const history = createLayoutHistory(layout([]), 10);
    expect(undoLayout(history)).toBe(history);
  });
});

describe("redoLayout", () => {
  it("restores a undone layout and pushes the present back into past", () => {
    const first = layout([item("a", 0, 0)]);
    const second = layout([item("a", 1, 0)]);
    const undone = undoLayout(commitLayout(createLayoutHistory(first, 10), second));
    const redone = redoLayout(undone);

    expect(redone.present).toBe(second);
    expect(redone.past).toEqual([first]);
    expect(redone.future).toEqual([]);
  });

  it("returns the same reference when future is empty", () => {
    const history = createLayoutHistory(layout([]), 10);
    expect(redoLayout(history)).toBe(history);
  });
});

describe("history branching", () => {
  it("loses the redo branch after a new commit follows an undo", () => {
    const first = layout([item("a", 0, 0)]);
    const second = layout([item("a", 1, 0)]);
    const third = layout([item("a", 2, 0)]);

    const history = commitLayout(createLayoutHistory(first, 10), second);
    const undone = undoLayout(history);
    const branched = commitLayout(undone, third);

    expect(branched.present).toBe(third);
    expect(branched.past).toEqual([first]);
    expect(branched.future).toEqual([]);
    expect(redoLayout(branched)).toBe(branched);
  });

  it("round-trips a layout through undo and redo", () => {
    const first = layout([item("a", 0, 0)]);
    const second = layout([item("a", 1, 0)]);
    const history = commitLayout(createLayoutHistory(first, 10), second);

    expect(redoLayout(undoLayout(history)).present).toBe(second);
  });
});
