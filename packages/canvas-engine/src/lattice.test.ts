import { describe, expect, it } from "vitest";

import type { GridDefinition } from "@veladesk/desktop-engine";

import {
  canvasCellRect,
  canvasCellSize,
  canvasLattice,
  canvasRectToSnappedRect,
  gridPositionToCanvasRect,
  isCanvasRectSnapped,
  latticeEdges,
  nearestEdgeIndex,
  snapCanvasRect,
} from "./lattice";
import { isValidCanvasRect } from "./rect";
import { CANVAS_UNITS } from "./types";
import type { CanvasRect } from "./types";

const grid10x6: GridDefinition = { columns: 10, rows: 6 };

function rect(x: number, y: number, width: number, height: number): CanvasRect {
  return { x, y, width, height };
}

describe("latticeEdges", () => {
  it("halves the axis for two divisions", () => {
    expect(latticeEdges(2)).toEqual([0, 5000, CANVAS_UNITS]);
  });

  it("rounds each edge of three divisions independently", () => {
    expect(latticeEdges(3)).toEqual([0, 3333, 6667, CANVAS_UNITS]);
  });

  it("never accumulates drift over six divisions", () => {
    const edges = latticeEdges(6);
    expect(edges).toEqual([0, 1667, 3333, 5000, 6667, 8333, CANVAS_UNITS]);
    expect(edges.at(-1)).toBe(CANVAS_UNITS);
  });

  it("stays monotonic and gap-free for seven divisions", () => {
    const edges = latticeEdges(7);
    let previous = -1;
    for (const edge of edges) {
      expect(edge).toBeGreaterThan(previous);
      previous = edge;
    }
    expect(edges.at(0)).toBe(0);
    expect(edges.at(-1)).toBe(CANVAS_UNITS);
  });

  it("rejects a non-positive or fractional count", () => {
    expect(() => latticeEdges(0)).toThrow(RangeError);
    expect(() => latticeEdges(-2)).toThrow(RangeError);
    expect(() => latticeEdges(2.5)).toThrow(RangeError);
  });
});

describe("canvasLattice", () => {
  it("derives both axes from the page grid", () => {
    const lattice = canvasLattice(grid10x6);
    expect(lattice.columnEdges).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]);
    expect(lattice.rowEdges).toHaveLength(7);
  });
});

describe("gridPositionToCanvasRect", () => {
  it("converts the origin cell", () => {
    expect(gridPositionToCanvasRect({ column: 0, row: 0 }, { columns: 1, rows: 1 }, grid10x6)).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 1667,
    });
  });

  it("converts the last row without cumulative division error", () => {
    expect(gridPositionToCanvasRect({ column: 0, row: 5 }, { columns: 1, rows: 1 }, grid10x6)).toEqual({
      x: 0,
      y: 8333,
      width: 1000,
      height: 1667,
    });
  });

  it("converts a multi-cell span", () => {
    expect(gridPositionToCanvasRect({ column: 2, row: 1 }, { columns: 3, rows: 2 }, grid10x6)).toEqual({
      x: 2000,
      y: 1667,
      width: 3000,
      height: 3333,
    });
  });

  it("tiles the whole canvas without gaps", () => {
    let heightSum = 0;
    for (let row = 0; row < grid10x6.rows; row += 1) {
      const cell = gridPositionToCanvasRect({ column: 0, row }, { columns: 1, rows: 1 }, grid10x6);
      expect(cell.y).toBe(latticeEdges(grid10x6.rows)[row]);
      heightSum += cell.height;
    }
    expect(heightSum).toBe(CANVAS_UNITS);
  });

  it("clamps out-of-range indexes to the canvas edge", () => {
    expect(gridPositionToCanvasRect({ column: 99, row: 99 }, { columns: 1, rows: 1 }, grid10x6)).toEqual({
      x: CANVAS_UNITS,
      y: CANVAS_UNITS,
      width: 1,
      height: 1,
    });
  });
});

describe("canvasCellRect and canvasCellSize", () => {
  it("returns one lattice cell and its size", () => {
    expect(canvasCellRect(grid10x6, 1, 1)).toEqual({ x: 1000, y: 1667, width: 1000, height: 1666 });
    expect(canvasCellSize(grid10x6)).toEqual({ width: 1000, height: 1667 });
  });
});

describe("nearestEdgeIndex", () => {
  it("resolves ties to the lower edge", () => {
    const edges = [0, 1000, 2000];
    expect(nearestEdgeIndex(edges, 500)).toBe(0);
    expect(nearestEdgeIndex(edges, 600)).toBe(1);
    expect(nearestEdgeIndex(edges, 5000)).toBe(2);
  });
});

describe("snapCanvasRect", () => {
  it("snaps all four edges to their closest lattice lines", () => {
    const snapped = snapCanvasRect(rect(90, 100, 900, 1400), canvasLattice(grid10x6));
    expect(snapped).toEqual({ x: 0, y: 0, width: 1000, height: 1667 });
  });

  it("returns the same reference when the rect is already aligned", () => {
    const aligned = rect(1000, 1667, 2000, 1666);
    expect(snapCanvasRect(aligned, canvasLattice(grid10x6))).toBe(aligned);
  });

  it("expands a collapsed rect to one lattice interval", () => {
    expect(snapCanvasRect(rect(10, 10, 20, 20), canvasLattice(grid10x6))).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 1667,
    });
  });

  it("snaps a huge rect to the nearest lattice bounds inside the canvas", () => {
    expect(snapCanvasRect(rect(300, 200, 9500, 9600), canvasLattice(grid10x6))).toEqual({
      x: 0,
      y: 0,
      width: CANVAS_UNITS,
      height: CANVAS_UNITS,
    });
  });

  it("never shrinks a snapped rect below one lattice cell", () => {
    const lattice = canvasLattice(grid10x6);
    const snapped = snapCanvasRect(rect(999, 1666, 2, 2), lattice);
    expect(snapped).toEqual({ x: 1000, y: 1667, width: 1000, height: 1666 });
  });

  it("keeps overlapping rects overlapping instead of resolving them", () => {
    const lattice = canvasLattice(grid10x6);
    const first = rect(0, 0, 5000, 5000);
    const second = snapCanvasRect(rect(4000, 4000, 4000, 4000), lattice);

    expect(snapCanvasRect(first, lattice)).toBe(first);
    expect(second).toEqual({ x: 4000, y: 3333, width: 4000, height: 5000 });
    expect(second.x).toBeLessThan(first.x + first.width);
    expect(second.y).toBeLessThan(first.y + first.height);
  });

  it("always produces a rect inside the canvas", () => {
    const lattice = canvasLattice(grid10x6);
    for (const candidate of [rect(0, 0, 1, 1), rect(9999, 9999, 1, 1), rect(4000, 4000, 3000, 3000)]) {
      expect(isValidCanvasRect(snapCanvasRect(candidate, lattice))).toBe(true);
    }
  });
});

describe("canvasRectToSnappedRect", () => {
  it("matches the explicit lattice version", () => {
    const candidate = rect(137, 991, 1877, 913);
    expect(canvasRectToSnappedRect(candidate, grid10x6)).toEqual(
      snapCanvasRect(candidate, canvasLattice(grid10x6)),
    );
  });
});

describe("isCanvasRectSnapped", () => {
  it("distinguishes aligned from free rects", () => {
    const lattice = canvasLattice(grid10x6);
    expect(isCanvasRectSnapped(rect(0, 1667, 1000, 1666), lattice)).toBe(true);
    expect(isCanvasRectSnapped(rect(137, 991, 1000, 1667), lattice)).toBe(false);
  });
});
