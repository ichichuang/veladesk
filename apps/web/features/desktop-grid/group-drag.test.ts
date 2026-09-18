import { describe, expect, it } from "vitest";

import { resolveDragItemIds, translationFromDesired } from "./group-drag";

describe("group drag resolution", () => {
  it("uses the whole selection when the source is selected", () => {
    const selection = new Set(["b", "a"]);
    expect(resolveDragItemIds("a", selection)).toEqual(["b", "a"]);
  });

  it("falls back to the source alone when it is not selected", () => {
    const selection = new Set(["b", "c"]);
    expect(resolveDragItemIds("a", selection)).toEqual(["a"]);
  });

  it("falls back to the source alone on an empty selection", () => {
    expect(resolveDragItemIds("a", new Set())).toEqual(["a"]);
  });
});

describe("drag translation", () => {
  it("converts the desired source cell into a rigid translation", () => {
    expect(translationFromDesired({ column: 2, row: 1 }, { column: 5, row: 4 })).toEqual({
      columnDelta: 3,
      rowDelta: 3,
    });
  });

  it("yields a zero translation when the source returns to its start cell", () => {
    expect(translationFromDesired({ column: 2, row: 1 }, { column: 2, row: 1 })).toEqual({
      columnDelta: 0,
      rowDelta: 0,
    });
  });

  it("stays single-selection compatible (same math for one item)", () => {
    const start = { column: 3, row: 0 };
    const desired = { column: 1, row: 2 };
    // Moving a single item from start to desired equals applying the
    // translation to that item's position.
    const translation = translationFromDesired(start, desired);
    expect({
      column: start.column + translation.columnDelta,
      row: start.row + translation.rowDelta,
    }).toEqual(desired);
  });
});
