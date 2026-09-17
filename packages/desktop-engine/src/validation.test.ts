import { describe, expect, it } from "vitest";

import { validatePageLayout } from "./validation";
import type { GridDefinition, LayoutItem, PageLayout } from "./types";

const grid: GridDefinition = { columns: 4, rows: 4 };

function item(id: string, column: number, row: number, columns = 1, rows = 1): LayoutItem {
  return { id, position: { column, row }, span: { columns, rows } };
}

function layout(items: readonly LayoutItem[]): PageLayout {
  return { id: "page-1", grid, items };
}

describe("validatePageLayout", () => {
  it("returns no issues for a valid layout", () => {
    expect(validatePageLayout(layout([item("a", 0, 0), item("b", 1, 0, 2, 2)]))).toEqual([]);
  });

  it("returns no issues for items that only touch edges", () => {
    expect(validatePageLayout(layout([item("a", 0, 0, 2, 2), item("b", 2, 0, 2, 2)]))).toEqual([]);
  });

  it("reports duplicate ids", () => {
    const issues = validatePageLayout(layout([item("dup", 0, 0), item("dup", 1, 0)]));
    expect(issues).toContainEqual({ type: "duplicate-id", itemId: "dup" });
    expect(issues.length).toBe(1);
  });

  it("reports invalid positions", () => {
    expect(validatePageLayout(layout([item("a", -1, 0)]))).toEqual([
      { type: "invalid-position", itemId: "a" },
    ]);
    expect(validatePageLayout(layout([item("a", 0, 1.5)]))).toEqual([
      { type: "invalid-position", itemId: "a" },
    ]);
  });

  it("reports invalid spans", () => {
    expect(validatePageLayout(layout([item("a", 0, 0, 0, 1)]))).toEqual([
      { type: "invalid-span", itemId: "a" },
    ]);
  });

  it("reports out-of-bounds items", () => {
    expect(validatePageLayout(layout([item("a", 3, 0, 2, 1)]))).toEqual([
      { type: "out-of-bounds", itemId: "a" },
    ]);
    expect(validatePageLayout(layout([item("a", 0, 4)]))).toEqual([
      { type: "out-of-bounds", itemId: "a" },
    ]);
  });

  it("reports an overlap pair once, ordered by item array position", () => {
    const issues = validatePageLayout(layout([item("first", 0, 0), item("second", 0, 0)]));
    expect(issues).toEqual([{ type: "overlap", itemIds: ["first", "second"] }]);
  });

  it("does not flag items whose rects merely share an edge", () => {
    expect(validatePageLayout(layout([item("a", 0, 0), item("b", 0, 1)]))).toEqual([]);
  });

  it("collects every issue in deterministic order without stopping early", () => {
    const issues = validatePageLayout(
      layout([
        item("dup", 0, 0),
        item("dup", 1, 0),
        item("neg", -1, 2),
        item("zero", 2, 0, 0, 1),
        item("oob", 3, 3, 2, 1),
        item("ov1", 0, 2),
        item("ov2", 0, 2),
      ]),
    );
    expect(issues).toEqual([
      { type: "duplicate-id", itemId: "dup" },
      { type: "invalid-position", itemId: "neg" },
      { type: "invalid-span", itemId: "zero" },
      { type: "out-of-bounds", itemId: "oob" },
      { type: "overlap", itemIds: ["ov1", "ov2"] },
    ]);
  });

  it("reports multiple overlap pairs in scan order", () => {
    const issues = validatePageLayout(
      layout([item("a", 0, 0), item("b", 0, 0), item("c", 1, 0), item("d", 1, 0)]),
    );
    expect(issues).toEqual([
      { type: "overlap", itemIds: ["a", "b"] },
      { type: "overlap", itemIds: ["c", "d"] },
    ]);
  });
});

describe("validatePageLayout: grid definition", () => {
  const invalidGrid: GridDefinition = { columns: 0, rows: 4 };

  function layoutOn(grid: GridDefinition, items: readonly LayoutItem[]): PageLayout {
    return { id: "page-1", grid, items };
  }

  it("reports invalid-grid for a raw layout with a zero-column grid and no items", () => {
    expect(validatePageLayout(layoutOn(invalidGrid, []))).toEqual([{ type: "invalid-grid" }]);
  });

  it("reports invalid-grid at most once, before per-item issues", () => {
    const issues = validatePageLayout(
      layoutOn(invalidGrid, [item("bad-pos", -1, 0), item("bad-span", 0, 0, 0, 1)]),
    );
    expect(issues).toEqual([
      { type: "invalid-grid" },
      { type: "invalid-position", itemId: "bad-pos" },
      { type: "invalid-span", itemId: "bad-span" },
    ]);
  });

  it("still reports overlaps among valid geometry under an invalid grid", () => {
    const issues = validatePageLayout(
      layoutOn(invalidGrid, [item("a", 0, 0), item("b", 0, 0)]),
    );
    expect(issues).toEqual([
      { type: "invalid-grid" },
      { type: "overlap", itemIds: ["a", "b"] },
    ]);
  });

  it("never derives out-of-bounds from an invalid grid", () => {
    const issues = validatePageLayout(
      layoutOn({ columns: 0, rows: 4 }, [item("a", 3, 0, 2, 1)]),
    );
    expect(issues).toEqual([{ type: "invalid-grid" }]);
  });
});
