import { describe, expect, it } from "vitest";

import { enumerateCells, isRectWithinGrid, rectsOverlap, toGridRect } from "./geometry";
import type { GridDefinition, GridRect } from "./types";

const grid: GridDefinition = { columns: 6, rows: 4 };

describe("toGridRect", () => {
  it("flattens a layout item into a rect", () => {
    expect(
      toGridRect({ id: "a", position: { column: 2, row: 1 }, span: { columns: 3, rows: 2 } }),
    ).toEqual({ column: 2, row: 1, columns: 3, rows: 2 });
  });
});

describe("rectsOverlap", () => {
  it("detects partial overlap", () => {
    const a: GridRect = { column: 0, row: 0, columns: 2, rows: 2 };
    const b: GridRect = { column: 1, row: 1, columns: 2, rows: 2 };
    expect(rectsOverlap(a, b)).toBe(true);
  });

  it("detects containment", () => {
    const outer: GridRect = { column: 0, row: 0, columns: 4, rows: 4 };
    const inner: GridRect = { column: 1, row: 1, columns: 2, rows: 2 };
    expect(rectsOverlap(outer, inner)).toBe(true);
  });

  it("treats horizontal edge contact as non-overlap", () => {
    const a: GridRect = { column: 0, row: 0, columns: 1, rows: 1 };
    const b: GridRect = { column: 1, row: 0, columns: 1, rows: 1 };
    expect(rectsOverlap(a, b)).toBe(false);
  });

  it("treats vertical edge contact as non-overlap", () => {
    const a: GridRect = { column: 0, row: 0, columns: 1, rows: 1 };
    const b: GridRect = { column: 0, row: 1, columns: 1, rows: 1 };
    expect(rectsOverlap(a, b)).toBe(false);
  });

  it("treats corner contact as non-overlap", () => {
    const a: GridRect = { column: 0, row: 0, columns: 1, rows: 1 };
    const b: GridRect = { column: 1, row: 1, columns: 1, rows: 1 };
    expect(rectsOverlap(a, b)).toBe(false);
  });

  it("is symmetric for disjoint rects", () => {
    const a: GridRect = { column: 0, row: 0, columns: 2, rows: 2 };
    const b: GridRect = { column: 3, row: 3, columns: 1, rows: 1 };
    expect(rectsOverlap(a, b)).toBe(false);
    expect(rectsOverlap(b, a)).toBe(false);
  });

  it("is symmetric for overlapping multi-cell rects", () => {
    const a: GridRect = { column: 0, row: 0, columns: 2, rows: 3 };
    const b: GridRect = { column: 1, row: 2, columns: 2, rows: 2 };
    expect(rectsOverlap(a, b)).toBe(true);
    expect(rectsOverlap(b, a)).toBe(true);
  });
});

describe("isRectWithinGrid", () => {
  it("accepts the top-left corner", () => {
    expect(isRectWithinGrid(grid, { column: 0, row: 0, columns: 1, rows: 1 })).toBe(true);
  });

  it("accepts a rect flush against the bottom-right edge", () => {
    expect(isRectWithinGrid(grid, { column: 5, row: 3, columns: 1, rows: 1 })).toBe(true);
    expect(isRectWithinGrid(grid, { column: 4, row: 2, columns: 2, rows: 2 })).toBe(true);
  });

  it("rejects a negative column", () => {
    expect(isRectWithinGrid(grid, { column: -1, row: 0, columns: 1, rows: 1 })).toBe(false);
  });

  it("rejects a negative row", () => {
    expect(isRectWithinGrid(grid, { column: 0, row: -1, columns: 1, rows: 1 })).toBe(false);
  });

  it("rejects a rect extending beyond the right edge", () => {
    expect(isRectWithinGrid(grid, { column: 6, row: 0, columns: 1, rows: 1 })).toBe(false);
    expect(isRectWithinGrid(grid, { column: 5, row: 0, columns: 2, rows: 1 })).toBe(false);
  });

  it("rejects a rect extending beyond the bottom edge", () => {
    expect(isRectWithinGrid(grid, { column: 0, row: 4, columns: 1, rows: 1 })).toBe(false);
    expect(isRectWithinGrid(grid, { column: 0, row: 3, columns: 1, rows: 2 })).toBe(false);
  });

  it("rejects an invalid span", () => {
    expect(isRectWithinGrid(grid, { column: 0, row: 0, columns: 0, rows: 1 })).toBe(false);
    expect(isRectWithinGrid(grid, { column: 0, row: 0, columns: 1, rows: -1 })).toBe(false);
  });
});

describe("enumerateCells", () => {
  it("enumerates a 2 x 2 rect at (1, 1) in row-major order", () => {
    const cells = enumerateCells({ column: 1, row: 1, columns: 2, rows: 2 });
    expect(cells).toEqual([
      { column: 1, row: 1 },
      { column: 2, row: 1 },
      { column: 1, row: 2 },
      { column: 2, row: 2 },
    ]);
  });

  it("enumerates a single cell", () => {
    expect(enumerateCells({ column: 4, row: 2, columns: 1, rows: 1 })).toEqual([
      { column: 4, row: 2 },
    ]);
  });

  it("enumerates a wide rect row by row", () => {
    expect(enumerateCells({ column: 0, row: 2, columns: 3, rows: 1 })).toEqual([
      { column: 0, row: 2 },
      { column: 1, row: 2 },
      { column: 2, row: 2 },
    ]);
  });
});
