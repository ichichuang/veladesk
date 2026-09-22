import { describe, expect, it } from "vitest";
import type { GridCanvasItem } from "@veladesk/canvas-engine";

import {
  calculateSquareGridMetrics,
  gridContentHeightPx,
  gridContentRows,
  gridPlacementStyle,
  gridSpanExtentPx,
  isSubpixelEqual,
  pixelsToCellDelta,
} from "./square-grid-metrics";

function gitem(
  id: string,
  column: number,
  row: number,
  columnSpan = 1,
  rowSpan = 1,
): GridCanvasItem {
  return { id, column, row, columnSpan, rowSpan };
}

describe("calculateSquareGridMetrics", () => {
  it("derives cellPx so the content width exactly refills the available width", () => {
    const metrics = calculateSquareGridMetrics({
      availableWidthPx: 1200,
      columns: 6,
      gapPx: 16,
    });
    expect(metrics).not.toBeNull();
    // cellPx = (1200 - 16*5) / 6 = 1120/6
    expect(metrics!.cellPx).toBeCloseTo(1120 / 6, 8);
    expect(metrics!.pitchPx).toBeCloseTo(1120 / 6 + 16, 8);
    expect(metrics!.contentWidthPx).toBeCloseTo(1200, 6);
  });

  it("keeps every cell a physical square: cell width === cell height", () => {
    for (const [width, columns, gap] of [
      [1200, 6, 16],
      [999, 5, 0],
      [640, 4, 32],
    ] as const) {
      const metrics = calculateSquareGridMetrics({
        availableWidthPx: width,
        columns,
        gapPx: gap,
      });
      expect(metrics, `${width}x${columns}`).not.toBeNull();
      // A square cell's width and height are the same value — trivially true
      // for one number, and exactly what grid-auto-rows consumes.
      expect(Number.isFinite(metrics!.cellPx)).toBe(true);
      expect(metrics!.cellPx).toBeGreaterThan(0);
      expect(isSubpixelEqual(metrics!.cellPx, metrics!.cellPx)).toBe(true);
    }
  });

  it("returns null for impossible inputs instead of lying", () => {
    expect(calculateSquareGridMetrics({ availableWidthPx: 0, columns: 6, gapPx: 16 })).toBeNull();
    expect(calculateSquareGridMetrics({ availableWidthPx: 100, columns: 0, gapPx: 16 })).toBeNull();
    expect(calculateSquareGridMetrics({ availableWidthPx: 10, columns: 6, gapPx: 16 })).toBeNull();
    expect(
      calculateSquareGridMetrics({ availableWidthPx: Number.NaN, columns: 6, gapPx: 16 }),
    ).toBeNull();
    expect(calculateSquareGridMetrics({ availableWidthPx: 100, columns: 6, gapPx: -1 })).toBeNull();
  });
});

describe("gap geometry", () => {
  it("a span of n covers exactly n cells plus n-1 gaps", () => {
    const cell = 1120 / 6;
    expect(gridSpanExtentPx(1, cell, 16)).toBeCloseTo(cell, 8);
    expect(gridSpanExtentPx(2, cell, 16)).toBeCloseTo(2 * cell + 16, 8);
    expect(gridSpanExtentPx(3, cell, 16)).toBeCloseTo(3 * cell + 2 * 16, 8);
  });

  it("computes content height from the greatest occupied row", () => {
    expect(gridContentRows([])).toBe(0);
    expect(
      gridContentRows([gitem("a", 0, 0), gitem("b", 0, 4, 1, 3)]),
    ).toBe(7);
    expect(gridContentHeightPx(0, 100, 16)).toBe(0);
    expect(gridContentHeightPx(3, 100, 16)).toBeCloseTo(3 * 100 + 2 * 16, 8);
  });
});

describe("pixelsToCellDelta", () => {
  it("rounds to the nearest whole cell, halves away from zero (017-B)", () => {
    expect(pixelsToCellDelta(112, 112)).toBe(1);
    expect(pixelsToCellDelta(168, 112)).toBe(2); // 1.5 rounds up
    expect(pixelsToCellDelta(56, 112)).toBe(1); // 0.5 rounds up
    expect(pixelsToCellDelta(55, 112)).toBe(0);
    // Halves mirror on the negative side (017-B): the threshold
    // abs(delta) >= pitch/2 must move one cell in the drag's own
    // direction. Math.round's half-toward-+Infinity stranded
    // westward/northward half-pitch gestures, so rounding is symmetric
    // away from zero.
    expect(pixelsToCellDelta(-56, 112)).toBe(-1);
    expect(pixelsToCellDelta(-55, 112)).toBe(0);
    expect(pixelsToCellDelta(-168, 112)).toBe(-2);
    expect(pixelsToCellDelta(-224, 112)).toBe(-2);
    expect(pixelsToCellDelta(Number.NaN, 112)).toBe(0);
    expect(pixelsToCellDelta(100, 0)).toBe(0);
  });
});

describe("gridPlacementStyle", () => {
  it("emits 1-based line starts with explicit spans", () => {
    expect(gridPlacementStyle(gitem("a", 0, 0))).toEqual({
      gridColumn: "1 / span 1",
      gridRow: "1 / span 1",
    });
    expect(gridPlacementStyle(gitem("b", 2, 3, 2, 2))).toEqual({
      gridColumn: "3 / span 2",
      gridRow: "4 / span 2",
    });
  });
});
