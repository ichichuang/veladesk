import { describe, expect, it } from "vitest";

import { clampPositionToGrid, findNearestFreePosition } from "./placement";
import type { GridDefinition, LayoutItem } from "./types";

const grid: GridDefinition = { columns: 4, rows: 3 };

function item(id: string, column: number, row: number, columns = 1, rows = 1): LayoutItem {
  return { id, position: { column, row }, span: { columns, rows } };
}

describe("clampPositionToGrid", () => {
  it("clamps an oversized position to the bottom-right-most anchor", () => {
    expect(
      clampPositionToGrid({ columns: 6, rows: 4 }, { column: 5, row: 3 }, { columns: 2, rows: 2 }),
    ).toEqual({ column: 4, row: 2 });
  });

  it("clamps negative coordinates to 0", () => {
    expect(
      clampPositionToGrid(grid, { column: -2, row: -1 }, { columns: 1, rows: 1 }),
    ).toEqual({ column: 0, row: 0 });
  });

  it("keeps an already-valid position unchanged", () => {
    expect(
      clampPositionToGrid(grid, { column: 2, row: 1 }, { columns: 2, rows: 2 }),
    ).toEqual({ column: 2, row: 1 });
  });

  it("clamps an exact-fit span to the origin", () => {
    expect(
      clampPositionToGrid(grid, { column: 3, row: 2 }, { columns: 4, rows: 3 }),
    ).toEqual({ column: 0, row: 0 });
  });

  it("throws RangeError when the span is larger than the grid", () => {
    expect(() =>
      clampPositionToGrid(grid, { column: 0, row: 0 }, { columns: 5, rows: 1 }),
    ).toThrow(RangeError);
  });

  it("throws RangeError for an invalid span", () => {
    expect(() =>
      clampPositionToGrid(grid, { column: 0, row: 0 }, { columns: 0, rows: 1 }),
    ).toThrow(RangeError);
  });

  it("throws RangeError for a fractional column", () => {
    expect(() =>
      clampPositionToGrid(grid, { column: 1.5, row: 0 }, { columns: 1, rows: 1 }),
    ).toThrow(RangeError);
  });

  it("throws RangeError for a fractional row", () => {
    expect(() =>
      clampPositionToGrid(grid, { column: 0, row: 0.5 }, { columns: 1, rows: 1 }),
    ).toThrow(RangeError);
  });

  it("throws RangeError for a NaN column", () => {
    expect(() =>
      clampPositionToGrid(grid, { column: Number.NaN, row: 0 }, { columns: 1, rows: 1 }),
    ).toThrow(RangeError);
  });

  it("throws RangeError for an Infinite row", () => {
    expect(() =>
      clampPositionToGrid(grid, { column: 0, row: Number.POSITIVE_INFINITY }, { columns: 1, rows: 1 }),
    ).toThrow(RangeError);
  });

  it("throws RangeError for a negative-Infinite column", () => {
    expect(() =>
      clampPositionToGrid(grid, { column: Number.NEGATIVE_INFINITY, row: 0 }, { columns: 1, rows: 1 }),
    ).toThrow(RangeError);
  });
});

describe("findNearestFreePosition", () => {
  it("returns the desired position when it is free", () => {
    expect(
      findNearestFreePosition({ grid, items: [], desired: { column: 1, row: 1 }, span: { columns: 1, rows: 1 } }),
    ).toEqual({ column: 1, row: 1 });
  });

  it("returns the nearest free position when desired is occupied", () => {
    const items = [item("a", 1, 1)];
    const result = findNearestFreePosition({ grid, items, desired: { column: 1, row: 1 }, span: { columns: 1, rows: 1 } });
    expect(result).toEqual({ column: 1, row: 0 });
  });

  it("prefers the strictly closest position", () => {
    const items = [item("a", 0, 0), item("b", 1, 0)];
    const result = findNearestFreePosition({ grid, items, desired: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } });
    expect(result).toEqual({ column: 0, row: 1 });
  });

  it("breaks symmetric-distance ties by smaller row, then smaller column", () => {
    // The desired cell and all four of its neighbours are occupied;
    // every diagonal is at the same squared distance 2.
    const items = [item("c", 1, 1), item("n", 1, 0), item("e", 2, 1), item("s", 1, 2), item("w", 0, 1)];
    const result = findNearestFreePosition({ grid, items, desired: { column: 1, row: 1 }, span: { columns: 1, rows: 1 } });
    expect(result).toEqual({ column: 0, row: 0 });
  });

  it("resolves ties towards smaller rows at the top-left edge", () => {
    const items = [item("a", 0, 0)];
    const result = findNearestFreePosition({ grid, items, desired: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } });
    expect(result).toEqual({ column: 1, row: 0 });
  });

  it("resolves ties towards smaller rows at the bottom-right edge", () => {
    const items = [item("a", 3, 2)];
    const result = findNearestFreePosition({ grid, items, desired: { column: 3, row: 2 }, span: { columns: 1, rows: 1 } });
    expect(result).toEqual({ column: 3, row: 1 });
  });

  it("clamps a desired position outside the grid before searching", () => {
    const items = [item("a", 0, 0)];
    const result = findNearestFreePosition({ grid, items, desired: { column: 10, row: 10 }, span: { columns: 1, rows: 1 } });
    expect(result).toEqual({ column: 3, row: 2 });
  });

  it("searches from the clamped anchor when it is occupied", () => {
    const items = [item("a", 3, 2)];
    const result = findNearestFreePosition({ grid, items, desired: { column: 9, row: 9 }, span: { columns: 1, rows: 1 } });
    expect(result).toEqual({ column: 3, row: 1 });
  });

  it("finds an anchor for a 2 x 2 span around an occupied corner", () => {
    const items = [item("a", 0, 0, 2, 2)];
    const result = findNearestFreePosition({ grid, items, desired: { column: 0, row: 0 }, span: { columns: 2, rows: 2 } });
    expect(result).toEqual({ column: 2, row: 0 });
  });

  it("ignores the item's own id when checking collisions", () => {
    const items = [item("self", 1, 1)];
    const result = findNearestFreePosition({
      grid,
      items,
      desired: { column: 1, row: 1 },
      span: { columns: 1, rows: 1 },
      ignoreItemIds: new Set(["self"]),
    });
    expect(result).toEqual({ column: 1, row: 1 });
  });

  it("returns null when the grid is completely full", () => {
    const full: GridDefinition = { columns: 2, rows: 2 };
    const items = [item("a", 0, 0), item("b", 1, 0), item("c", 0, 1), item("d", 1, 1)];
    const result = findNearestFreePosition({ grid: full, items, desired: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } });
    expect(result).toBeNull();
  });

  it("throws RangeError when the span cannot fit the grid at all", () => {
    expect(() =>
      findNearestFreePosition({ grid, items: [], desired: { column: 0, row: 0 }, span: { columns: 5, rows: 1 } }),
    ).toThrow(RangeError);
  });

  it("propagates the RangeError for a NaN desired coordinate", () => {
    expect(() =>
      findNearestFreePosition({ grid, items: [], desired: { column: Number.NaN, row: 0 }, span: { columns: 1, rows: 1 } }),
    ).toThrow(RangeError);
  });
});
