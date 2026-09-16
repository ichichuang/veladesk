import { describe, expect, it } from "vitest";

import { moveItem, swapItems } from "./operations";
import type { LayoutItem, PageLayout } from "./types";

const grid = { columns: 4, rows: 4 };

function item(id: string, column: number, row: number, columns = 1, rows = 1): LayoutItem {
  return { id, position: { column, row }, span: { columns, rows } };
}

function layout(items: readonly LayoutItem[]): PageLayout {
  return { id: "page-1", grid, items };
}

describe("moveItem", () => {
  it("moves an item to a free position immutably", () => {
    const a = item("a", 0, 0);
    const b = item("b", 2, 2);
    const source = layout([a, b]);
    const result = moveItem(source, "a", { column: 1, row: 0 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.layout).not.toBe(source);
      expect(result.layout.items[0]).toEqual(item("a", 1, 0));
      // Untouched items keep their references.
      expect(result.layout.items[1]).toBe(b);
    }
    expect(source).toEqual(layout([a, b]));
  });

  it("returns the original layout reference when the target equals the current position", () => {
    const source = layout([item("a", 1, 1)]);
    const result = moveItem(source, "a", { column: 1, row: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.layout).toBe(source);
    }
  });

  it("fails with item-not-found for an unknown id", () => {
    const source = layout([item("a", 0, 0)]);
    const result = moveItem(source, "ghost", { column: 1, row: 0 });
    expect(result).toEqual({ ok: false, reason: "item-not-found", layout: source });
  });

  it("fails with out-of-bounds for a desired rect extending past the grid", () => {
    const bigSource = layout([item("a", 0, 0, 2, 2)]);
    const result = moveItem(bigSource, "a", { column: 3, row: 0 });
    expect(result).toEqual({ ok: false, reason: "out-of-bounds", layout: bigSource });
  });

  it("fails with collision and reports colliding ids", () => {
    const source = layout([item("a", 0, 0), item("b", 2, 0, 2, 2)]);
    const result = moveItem(source, "a", { column: 2, row: 0 });
    expect(result).toEqual({
      ok: false,
      reason: "collision",
      layout: source,
      collidingItemIds: ["b"],
    });
  });

  it("succeeds when the moved rect only touches another item's edge", () => {
    const source = layout([item("a", 0, 0), item("b", 1, 0)]);
    const result = moveItem(source, "a", { column: 2, row: 0 });
    expect(result.ok).toBe(true);
  });

  it("fails with invalid-layout when other items overlap each other", () => {
    const source = layout([item("a", 0, 0), item("b", 2, 2), item("c", 2, 2)]);
    const result = moveItem(source, "a", { column: 3, row: 3 });
    expect(result).toEqual({ ok: false, reason: "invalid-layout", layout: source });
  });

  it("fails with invalid-layout when another item is out of bounds", () => {
    const source = layout([item("a", 0, 0), item("b", 3, 3, 2, 2)]);
    const result = moveItem(source, "a", { column: 1, row: 1 });
    expect(result).toEqual({ ok: false, reason: "invalid-layout", layout: source });
  });

  it("fails with invalid-layout when the moved item itself has an invalid span", () => {
    const source = layout([item("a", 0, 0, 0, 1)]);
    const result = moveItem(source, "a", { column: 1, row: 1 });
    expect(result).toEqual({ ok: false, reason: "invalid-layout", layout: source });
  });

  it("can rescue an item that currently sits out of bounds", () => {
    const source = layout([item("a", 3, 3, 2, 2), item("b", 0, 0)]);
    const result = moveItem(source, "a", { column: 0, row: 2 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.layout.items[0]).toEqual(item("a", 0, 2, 2, 2));
    }
  });

  it("defaults to exact placement", () => {
    const source = layout([item("a", 0, 0), item("b", 1, 0)]);
    const result = moveItem(source, "a", { column: 1, row: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("collision");
    }
  });

  it("resolves nearest-free placement around occupied cells", () => {
    const source = layout([item("a", 3, 3), item("b", 1, 0)]);
    const result = moveItem(source, "a", { column: 1, row: 0 }, { placement: "nearest-free" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.layout.items[0]).toEqual(item("a", 0, 0));
    }
  });

  it("clamps nearest-free desired positions outside the grid", () => {
    const source = layout([item("a", 0, 0)]);
    const result = moveItem(source, "a", { column: 9, row: 9 }, { placement: "nearest-free" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.layout.items[0]).toEqual(item("a", 3, 3));
    }
  });

  it("fails with no-space when no anchor is free even ignoring the moved item", () => {
    // "a" currently overlaps "b"; excluding "a", every 1x1 anchor is taken.
    const packed: PageLayout = {
      id: "page-1",
      grid: { columns: 1, rows: 2 },
      items: [item("a", 0, 0), item("b", 0, 0), item("c", 0, 1)],
    };
    const result = moveItem(packed, "a", { column: 0, row: 0 }, { placement: "nearest-free" });
    expect(result).toEqual({ ok: false, reason: "no-space", layout: packed });
  });

  it("fails with no-space instead of throwing when the span cannot fit the grid", () => {
    const wide: PageLayout = {
      id: "page-1",
      grid: { columns: 2, rows: 2 },
      items: [item("a", 0, 0, 3, 1)],
    };
    const result = moveItem(wide, "a", { column: 0, row: 0 }, { placement: "nearest-free" });
    expect(result).toEqual({ ok: false, reason: "no-space", layout: wide });
  });

  it("keeps nearest-free results at the current position when nothing is closer", () => {
    const source = layout([item("a", 3, 3)]);
    const result = moveItem(source, "a", { column: 3, row: 3 }, { placement: "nearest-free" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.layout).toBe(source);
    }
  });
});

describe("swapItems", () => {
  it("exchanges the top-left positions of two items", () => {
    const a = item("a", 0, 0);
    const b = item("b", 2, 2);
    const other = item("c", 3, 0);
    const source = layout([a, b, other]);
    const result = swapItems(source, "a", "b");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.layout.items[0]).toEqual(item("a", 2, 2));
      expect(result.layout.items[1]).toEqual(item("b", 0, 0));
      expect(result.layout.items[2]).toBe(other);
      expect(source).toEqual(layout([a, b, other]));
    }
  });

  it("swaps items with different spans when both result rects are legal", () => {
    const source = layout([item("a", 0, 0, 2, 2), item("b", 2, 0)]);
    const result = swapItems(source, "a", "b");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.layout.items[0]).toEqual(item("a", 2, 0, 2, 2));
      expect(result.layout.items[1]).toEqual(item("b", 0, 0));
    }
  });

  it("returns the original layout for identical ids without a new snapshot", () => {
    const source = layout([item("a", 0, 0)]);
    const result = swapItems(source, "a", "a");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.layout).toBe(source);
    }
  });

  it("fails with item-not-found when an id is unknown", () => {
    const source = layout([item("a", 0, 0)]);
    expect(swapItems(source, "a", "ghost")).toEqual({
      ok: false,
      reason: "item-not-found",
      layout: source,
    });
  });

  it("fails with item-not-found when both ids are unknown and equal", () => {
    const source = layout([item("a", 0, 0)]);
    expect(swapItems(source, "ghost", "ghost")).toEqual({
      ok: false,
      reason: "item-not-found",
      layout: source,
    });
  });

  it("fails with collision when the swapped rects would overlap each other", () => {
    const source = layout([item("a", 0, 0), item("b", 1, 1, 2, 2)]);
    const result = swapItems(source, "a", "b");
    expect(result).toEqual({
      ok: false,
      reason: "collision",
      layout: source,
      collidingItemIds: ["a", "b"],
    });
  });

  it("fails with out-of-bounds when a swapped rect leaves the grid", () => {
    const source = layout([item("a", 3, 3), item("b", 0, 0, 2, 2)]);
    const result = swapItems(source, "a", "b");
    expect(result).toEqual({ ok: false, reason: "out-of-bounds", layout: source });
  });

  it("fails with collision when a swapped rect hits a third item", () => {
    const source = layout([item("a", 0, 0, 2, 2), item("b", 2, 0), item("c", 3, 1)]);
    const result = swapItems(source, "a", "b");
    expect(result).toEqual({
      ok: false,
      reason: "collision",
      layout: source,
      collidingItemIds: ["c"],
    });
  });

  it("fails with invalid-layout when other items overlap each other", () => {
    const source = layout([item("a", 0, 0), item("b", 1, 0), item("x", 2, 2), item("y", 2, 2)]);
    const result = swapItems(source, "a", "b");
    expect(result).toEqual({ ok: false, reason: "invalid-layout", layout: source });
  });

  it("fails with invalid-layout when a swapped item has an invalid span", () => {
    const source = layout([item("a", 0, 0), item("b", 2, 0, 0, 1)]);
    const result = swapItems(source, "a", "b");
    expect(result).toEqual({ ok: false, reason: "invalid-layout", layout: source });
  });

  it("can swap two items that currently overlap each other into legal spots", () => {
    // a (2x2 at origin) and b (1x1 inside a) overlap today; swapping anchors
    // moves b to the origin and a's 2x2 to (1,1), which resolves the overlap.
    const source = layout([item("a", 0, 0, 2, 2), item("b", 1, 1)]);
    const result = swapItems(source, "a", "b");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.layout.items[0]).toEqual(item("a", 1, 1, 2, 2));
      expect(result.layout.items[1]).toEqual(item("b", 0, 0));
    }
  });
});
