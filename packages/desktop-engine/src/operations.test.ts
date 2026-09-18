import { describe, expect, it } from "vitest";

import { moveItem, moveItems, swapItems } from "./operations";
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

  it("fails with invalid-layout when any other entry duplicates an id, even a unique target", () => {
    const source = layout([item("a", 0, 0), item("dup", 1, 0), item("dup", 2, 0)]);
    const result = moveItem(source, "a", { column: 0, row: 1 });
    expect(result).toEqual({ ok: false, reason: "invalid-layout", layout: source });
  });

  it("fails with invalid-layout when moving an id that appears more than once", () => {
    const source = layout([item("a", 0, 0), item("dup", 1, 0), item("dup", 2, 0)]);
    const result = moveItem(source, "dup", { column: 2, row: 0 });
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

  it("fails with invalid-layout when any entry duplicates an id", () => {
    const source = layout([item("dup", 0, 0), item("dup", 1, 0), item("b", 2, 0)]);
    const result = swapItems(source, "dup", "b");
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

describe("moveItems", () => {
  const translation = { columnDelta: 1, rowDelta: 0 };

  it("fails with invalid-selection for an empty selection", () => {
    const source = layout([item("a", 0, 0)]);
    const result = moveItems(source, [], translation);
    expect(result).toEqual({ ok: false, reason: "invalid-selection", layout: source });
  });

  it("fails with invalid-selection for duplicate requested ids", () => {
    const source = layout([item("a", 0, 0), item("b", 2, 0)]);
    const result = moveItems(source, ["a", "a"], translation);
    expect(result).toEqual({ ok: false, reason: "invalid-selection", layout: source });
  });

  it("fails with item-not-found when any requested id is missing", () => {
    const source = layout([item("a", 0, 0)]);
    const result = moveItems(source, ["a", "ghost"], translation);
    expect(result).toEqual({ ok: false, reason: "item-not-found", layout: source });
  });

  it("fails with invalid-translation for fractional deltas", () => {
    const source = layout([item("a", 0, 0)]);
    const result = moveItems(source, ["a"], { columnDelta: 1.5, rowDelta: 0 });
    expect(result).toEqual({ ok: false, reason: "invalid-translation", layout: source });
  });

  it("fails with invalid-translation for NaN and Infinity deltas", () => {
    const source = layout([item("a", 0, 0)]);
    expect(moveItems(source, ["a"], { columnDelta: Number.NaN, rowDelta: 0 })).toEqual({
      ok: false,
      reason: "invalid-translation",
      layout: source,
    });
    expect(moveItems(source, ["a"], { columnDelta: 1, rowDelta: Number.POSITIVE_INFINITY })).toEqual({
      ok: false,
      reason: "invalid-translation",
      layout: source,
    });
  });

  it("fails with invalid-layout when the layout itself has duplicate ids", () => {
    const source = layout([item("a", 0, 0), item("a", 2, 2)]);
    const result = moveItems(source, ["a"], translation);
    expect(result).toEqual({ ok: false, reason: "invalid-layout", layout: source });
  });

  it("matches moveItem exactly for a single selected item", () => {
    const source = layout([item("a", 0, 0), item("b", 2, 2)]);
    const groupResult = moveItems(source, ["a"], translation);
    const singleResult = moveItem(source, "a", { column: 1, row: 0 });
    expect(groupResult).toEqual(singleResult);
  });

  it("matches moveItem nearest-free for a single selected item", () => {
    const source = layout([item("a", 0, 0), item("b", 1, 0)]);
    const groupResult = moveItems(source, ["a"], translation, { placement: "nearest-free" });
    const singleResult = moveItem(source, "a", { column: 1, row: 0 }, { placement: "nearest-free" });
    expect(groupResult).toEqual(singleResult);
  });

  it("moves two items rigidly and preserves their relative offset", () => {
    const a = item("a", 0, 0);
    const b = item("b", 1, 2);
    const c = item("c", 0, 3);
    const source = layout([a, b, c]);
    const result = moveItems(source, ["a", "b"], { columnDelta: 2, rowDelta: 1 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.layout.items.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
      expect(result.layout.items[0]).toEqual(item("a", 2, 1));
      expect(result.layout.items[1]).toEqual(item("b", 3, 3));
      expect(result.layout.items[2]).toBe(c);
    }
  });

  it("keeps mixed spans and never mutates the input", () => {
    const big = item("big", 0, 0, 2, 2);
    const small = item("small", 0, 2);
    const source = layout([big, small, item("c", 3, 0)]);
    const frozen = JSON.parse(JSON.stringify(source));

    const result = moveItems(source, ["big", "small"], { columnDelta: 1, rowDelta: 1 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.layout.items[0]).toEqual(item("big", 1, 1, 2, 2));
      expect(result.layout.items[1]).toEqual(item("small", 1, 3));
    }
    expect(JSON.parse(JSON.stringify(source))).toEqual(frozen);
  });

  it("returns the original layout reference for a zero translation", () => {
    const source = layout([item("a", 0, 0), item("b", 2, 2)]);
    const result = moveItems(source, ["a", "b"], { columnDelta: 0, rowDelta: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.layout).toBe(source);
    }
  });

  it("fails with out-of-bounds when any selected rect leaves the grid", () => {
    const source = layout([item("a", 3, 3), item("b", 0, 0)]);
    const result = moveItems(source, ["a", "b"], { columnDelta: 1, rowDelta: 0 });
    expect(result).toEqual({ ok: false, reason: "out-of-bounds", layout: source });
  });

  it("fails with collision against unselected items and reports them deterministically", () => {
    const source = layout([
      item("a", 0, 0),
      item("b", 0, 1),
      item("x", 2, 0),
      item("y", 2, 1),
    ]);
    // Moving a and b by +2 columns lands each on x's and y's cells.
    const result = moveItems(source, ["a", "b"], { columnDelta: 2, rowDelta: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("collision");
      expect(result.collidingItemIds).toEqual(["x", "y"]);
    }
  });

  it("rejects internally overlapping selected groups as invalid-layout", () => {
    // a and b overlap each other in the source layout. A rigid translation
    // preserves relative positions, so that overlap is a source defect no
    // delta can repair — even a zero translation must not fake success.
    const source = layout([item("a", 0, 0, 2, 2), item("b", 1, 1), item("c", 3, 3)]);
    const result = moveItems(source, ["a", "b"], { columnDelta: 0, rowDelta: 0 });
    expect(result).toEqual({ ok: false, reason: "invalid-layout", layout: source });
  });

  it("rejects internally overlapping selected groups for non-zero exact translations too", () => {
    const source = layout([item("a", 0, 0, 2, 2), item("b", 1, 1), item("c", 3, 3)]);
    const result = moveItems(source, ["a", "b"], { columnDelta: 1, rowDelta: 0 });
    expect(result).toEqual({ ok: false, reason: "invalid-layout", layout: source });
  });

  it("rejects fractional selected positions as invalid-layout", () => {
    const fractionalColumn = { ...item("a", 0, 0), position: { column: 0.5, row: 0 } };
    const fractionalRow = { ...item("b", 2, 2), position: { column: 2, row: 2.5 } };
    const source = layout([fractionalColumn, fractionalRow]);
    expect(moveItems(source, ["a", "b"], { columnDelta: 0, rowDelta: 0 })).toEqual({
      ok: false,
      reason: "invalid-layout",
      layout: source,
    });
    expect(moveItems(source, ["a", "b"], { columnDelta: 1, rowDelta: 1 })).toEqual({
      ok: false,
      reason: "invalid-layout",
      layout: source,
    });
  });

  it("reports collision for a legal group whose zero translation overlaps an unselected item", () => {
    // The selected pair is internally sound, but b sits on unselected x in
    // the source; a zero translation is still a placement that must be legal.
    const source = layout([item("a", 0, 0), item("b", 2, 2), item("x", 2, 2)]);
    const result = moveItems(source, ["a", "b"], { columnDelta: 0, rowDelta: 0 });
    expect(result).toEqual({
      ok: false,
      reason: "collision",
      layout: source,
      collidingItemIds: ["x"],
    });
  });

  it("reports out-of-bounds for a selected item already outside the grid under a zero translation", () => {
    const source = layout([item("a", 0, 0), item("b", 3, 3, 2, 2)]);
    const result = moveItems(source, ["a", "b"], { columnDelta: 0, rowDelta: 0 });
    expect(result).toEqual({ ok: false, reason: "out-of-bounds", layout: source });
  });

  it("finds the nearest rigid translation for a group around a blocker", () => {
    // Group a(0,0) b(1,0) wants +2 columns; the whole row ahead is walled
    // off, so the nearest legal rigid translation is +2/+1 (below the wall).
    const source = layout([
      item("a", 0, 0),
      item("b", 1, 0),
      item("x", 2, 0),
      item("y", 3, 0),
    ]);
    const result = moveItems(source, ["a", "b"], { columnDelta: 2, rowDelta: 0 }, {
      placement: "nearest-free",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const positions = new Map(result.layout.items.map((entry) => [entry.id, entry.position]));
      expect(positions.get("a")).toEqual({ column: 2, row: 1 });
      expect(positions.get("b")).toEqual({ column: 3, row: 1 });
      // Offsets preserved: a->b stays (+1, 0).
      expect(positions.get("b")!.column - positions.get("a")!.column).toBe(1);
      expect(positions.get("b")!.row - positions.get("a")!.row).toBe(0);
    }
  });

  it("resolves a walled-off diagonal desired deterministically", () => {
    // The whole column ahead of the a/b group is walled off, so the desired
    // diagonal (1,1) cannot be honored; the deterministic nearest outcome
    // is one row down inside column 0.
    const source = layout([
      item("a", 0, 1),
      item("b", 0, 2),
      item("x", 1, 0),
      item("y", 1, 1),
      item("z", 1, 2),
    ]);
    const result = moveItems(source, ["a", "b"], { columnDelta: 1, rowDelta: 1 }, {
      placement: "nearest-free",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const positions = new Map(result.layout.items.map((entry) => [entry.id, entry.position]));
      expect(positions.get("a")).toEqual({ column: 0, row: 2 });
      expect(positions.get("b")).toEqual({ column: 0, row: 3 });
    }
  });

  it("breaks full distance ties by smaller group left column", () => {
    // Repair scenario: the group overlaps wall items y/z, so staying put is
    // illegal, up is blocked by w and down is blocked by the grid edge. The
    // two surviving candidates (-1,-1) and (1,-1) tie on distance AND top
    // row; the smaller left column wins.
    const source = layout([
      item("a", 1, 1),
      item("b", 1, 2),
      item("w", 1, 0),
      item("y", 1, 1),
      item("z", 1, 2),
    ]);
    const result = moveItems(source, ["a", "b"], { columnDelta: 0, rowDelta: 0 }, {
      placement: "nearest-free",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const positions = new Map(result.layout.items.map((entry) => [entry.id, entry.position]));
      expect(positions.get("a")).toEqual({ column: 0, row: 1 });
      expect(positions.get("b")).toEqual({ column: 0, row: 2 });
    }
  });

  it("fails with no-space when the group cannot fit the grid at all", () => {
    // Repair scenario: the group's bounding box (2 columns) exceeds this
    // 1-column grid, so no rigid translation is even bounded.
    const source = { id: "page-1", grid: { columns: 1, rows: 2 }, items: [item("a", 0, 0), item("b", 1, 0)] };
    const result = moveItems(source, ["a", "b"], { columnDelta: 0, rowDelta: 1 }, {
      placement: "nearest-free",
    });
    expect(result).toEqual({ ok: false, reason: "no-space", layout: source });
  });

  it("does not count the grid-boundary-locked group as no-space when it already sits at its best spot", () => {
    const source = layout([item("a", 0, 0), item("b", 1, 0), item("c", 3, 3)]);
    const result = moveItems(source, ["a", "b"], { columnDelta: 0, rowDelta: 0 }, {
      placement: "nearest-free",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.layout).toBe(source);
    }
  });

  it("repairs a selected group that overlaps an unselected item via nearest-free", () => {
    // Repair capability: b sits on unselected x in the source, so staying
    // put is illegal; the nearest legal rigid translation moves the whole
    // group past x on the same row (distance tie with one row down is broken
    // by the smaller top row).
    const source = layout([item("a", 0, 0), item("b", 1, 0), item("x", 1, 0)]);
    const result = moveItems(source, ["a", "b"], { columnDelta: 1, rowDelta: 0 }, {
      placement: "nearest-free",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const positions = new Map(result.layout.items.map((entry) => [entry.id, entry.position]));
      expect(positions.get("a")).toEqual({ column: 2, row: 0 });
      expect(positions.get("b")).toEqual({ column: 3, row: 0 });
    }
  });

  it("rejects internally overlapping selected groups for nearest-free as invalid-layout", () => {
    // Selected-selected overlap cannot be repaired by ANY rigid translation,
    // so nearest-free must not go hunting for one either.
    const source = layout([item("a", 0, 0, 2, 2), item("b", 1, 1), item("c", 3, 3)]);
    const result = moveItems(source, ["a", "b"], { columnDelta: 1, rowDelta: 0 }, {
      placement: "nearest-free",
    });
    expect(result).toEqual({ ok: false, reason: "invalid-layout", layout: source });
  });
});
