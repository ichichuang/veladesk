import { describe, expect, it } from "vitest";

import { buildOccupancyMap, canPlaceRect, cellKey, getCollidingItemIds } from "./occupancy";
import type { GridDefinition, LayoutItem } from "./types";

const grid: GridDefinition = { columns: 6, rows: 4 };

function item(id: string, column: number, row: number, columns = 1, rows = 1): LayoutItem {
  return { id, position: { column, row }, span: { columns, rows } };
}

describe("cellKey", () => {
  it("formats a position as column:row", () => {
    expect(cellKey({ column: 3, row: 2 })).toBe("3:2");
  });

  it("formats the origin as 0:0", () => {
    expect(cellKey({ column: 0, row: 0 })).toBe("0:0");
  });
});

describe("buildOccupancyMap", () => {
  it("maps a 1 x 1 item to a single cell", () => {
    const map = buildOccupancyMap([item("a", 0, 0)]);
    expect(map.size).toBe(1);
    expect(map.get("0:0")).toBe("a");
  });

  it("maps every cell of a 2 x 2 item", () => {
    const map = buildOccupancyMap([item("a", 1, 1, 2, 2)]);
    expect(map.size).toBe(4);
    expect(map.get("1:1")).toBe("a");
    expect(map.get("2:1")).toBe("a");
    expect(map.get("1:2")).toBe("a");
    expect(map.get("2:2")).toBe("a");
  });

  it("combines cells of multiple items", () => {
    const map = buildOccupancyMap([item("a", 0, 0), item("b", 0, 1, 2, 1)]);
    expect(map.size).toBe(3);
    expect(map.get("0:0")).toBe("a");
    expect(map.get("0:1")).toBe("b");
    expect(map.get("1:1")).toBe("b");
  });

  it("throws and names both item ids when items overlap on a cell", () => {
    expect(() => buildOccupancyMap([item("a", 0, 0, 2, 2), item("b", 1, 1)])).toThrowError(
      /"a".*"b"|"b".*"a"/,
    );
  });

  it("does not throw for items that only touch edges", () => {
    expect(() => buildOccupancyMap([item("a", 0, 0), item("b", 1, 0)])).not.toThrow();
  });

  it("skips ignored items entirely", () => {
    const map = buildOccupancyMap([item("a", 0, 0), item("b", 1, 0)], {
      ignoreItemIds: new Set(["a"]),
    });
    expect(map.size).toBe(1);
    expect(map.get("1:0")).toBe("b");
  });
});

describe("getCollidingItemIds", () => {
  it("returns ids of items overlapping the candidate rect", () => {
    const items = [item("a", 0, 0), item("b", 2, 2, 2, 2), item("c", 5, 3)];
    expect(getCollidingItemIds(items, { column: 3, row: 3, columns: 1, rows: 1 })).toEqual(["b"]);
  });

  it("reports partial overlap with multi-cell candidates", () => {
    const items = [item("a", 1, 1, 2, 2)];
    expect(getCollidingItemIds(items, { column: 2, row: 2, columns: 2, rows: 2 })).toEqual(["a"]);
  });

  it("returns an empty list when only edges touch", () => {
    const items = [item("a", 0, 0)];
    expect(getCollidingItemIds(items, { column: 1, row: 0, columns: 1, rows: 1 })).toEqual([]);
  });

  it("keeps items order and dedupes repeated ids", () => {
    const items = [item("a", 0, 0), item("dup", 1, 0), item("dup", 2, 0), item("z", 5, 3)];
    const candidate = { column: 0, row: 0, columns: 3, rows: 1 };
    expect(getCollidingItemIds(items, candidate)).toEqual(["a", "dup"]);
  });

  it("ignores ids listed in ignoreItemIds", () => {
    const items = [item("a", 0, 0), item("b", 1, 0)];
    const candidate = { column: 0, row: 0, columns: 2, rows: 1 };
    expect(getCollidingItemIds(items, candidate, { ignoreItemIds: new Set(["a"]) })).toEqual(["b"]);
  });
});

describe("canPlaceRect", () => {
  it("accepts a free rect inside the grid", () => {
    const items = [item("a", 0, 0)];
    expect(canPlaceRect(grid, items, { column: 2, row: 1, columns: 2, rows: 2 })).toBe(true);
  });

  it("accepts a rect flush against grid edges", () => {
    const items = [item("a", 0, 0)];
    expect(canPlaceRect(grid, items, { column: 5, row: 3, columns: 1, rows: 1 })).toBe(true);
  });

  it("rejects a rect outside the grid", () => {
    expect(canPlaceRect(grid, [], { column: 6, row: 0, columns: 1, rows: 1 })).toBe(false);
    expect(canPlaceRect(grid, [], { column: 0, row: 4, columns: 1, rows: 1 })).toBe(false);
  });

  it("rejects a rect colliding with an item", () => {
    const items = [item("a", 2, 2, 2, 2)];
    expect(canPlaceRect(grid, items, { column: 3, row: 3, columns: 1, rows: 1 })).toBe(false);
  });

  it("rejects an invalid rect", () => {
    expect(canPlaceRect(grid, [], { column: 0, row: 0, columns: 0, rows: 1 })).toBe(false);
    expect(canPlaceRect(grid, [], { column: -1, row: 0, columns: 1, rows: 1 })).toBe(false);
  });

  it("allows collisions with ignored items", () => {
    const items = [item("a", 0, 0)];
    const candidate = { column: 0, row: 0, columns: 1, rows: 1 };
    expect(canPlaceRect(grid, items, candidate, { ignoreItemIds: new Set(["a"]) })).toBe(true);
  });
});
