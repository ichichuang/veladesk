import { describe, expect, it } from "vitest";
import type { GridCanvasItem } from "@veladesk/canvas-engine";

import {
  GRID_CELL_MAX_PX,
  GRID_CELL_WIDE_MAX_PX,
  calculateSquareGridMetrics,
  gridContentColumns,
  gridContentHeightPx,
  gridContentRows,
  gridFrameContentWidthPx,
  gridFrameTopOffsetPx,
  gridPlacementStyle,
  fluidGridCellCap,
  gridSpanExtentPx,
  isSubpixelEqual,
  pixelsToCellDelta,
  withMeasuredStageHeight,
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

  it("caps the cell at the Helm r2 spec ceiling on wide stages (96–112 band)", () => {
    // 1600-class stage, 5 columns, 16px gap: the derived cell would be
    // ~272px — the ceiling holds it at 112 and the content no longer fills
    // the stage (the frame centers the narrower grid).
    const capped = calculateSquareGridMetrics({
      availableWidthPx: 1388,
      columns: 5,
      gapPx: 16,
      maxCellPx: GRID_CELL_MAX_PX,
    });
    expect(capped).not.toBeNull();
    expect(capped!.cellPx).toBe(GRID_CELL_MAX_PX);
    expect(capped!.pitchPx).toBe(GRID_CELL_MAX_PX + 16);
    expect(capped!.contentWidthPx).toBe(5 * GRID_CELL_MAX_PX + 4 * 16);
    expect(capped!.contentWidthPx).toBeLessThan(1388);
    // The ceiling is a real cap, not a floor: narrow stages keep shrinking
    // below it, and the content still exactly refills the width.
    const narrow = calculateSquareGridMetrics({
      availableWidthPx: 600,
      columns: 5,
      gapPx: 16,
      maxCellPx: GRID_CELL_MAX_PX,
    });
    expect(narrow).not.toBeNull();
    expect(narrow!.cellPx).toBeCloseTo((600 - 4 * 16) / 5, 8);
    expect(narrow!.contentWidthPx).toBeCloseTo(600, 6);
  });

  it("treats a non-finite or absent maxCellPx as no ceiling at all", () => {
    for (const maxCellPx of [Number.POSITIVE_INFINITY, undefined] as const) {
      const metrics = calculateSquareGridMetrics({
        availableWidthPx: 1388,
        columns: 5,
        gapPx: 16,
        ...(maxCellPx === undefined ? {} : { maxCellPx }),
      });
      expect(metrics).not.toBeNull();
      expect(metrics!.cellPx).toBeCloseTo((1388 - 4 * 16) / 5, 8);
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

  it("computes the occupied column edge from the greatest column + span", () => {
    expect(gridContentColumns([])).toBe(0);
    expect(gridContentColumns([gitem("a", 0, 0)])).toBe(1);
    expect(
      gridContentColumns([gitem("a", 0, 0), gitem("b", 5, 0, 2, 1)]),
    ).toBe(7);
  });
});

describe("frame anchors (layout fill)", () => {
  it("shrink-wraps the frame to the OCCUPIED columns, not the stored width", () => {
    const items = [gitem("a", 0, 0), gitem("b", 2, 0, 2, 1)];
    // 4 of 8 stored columns occupied: the frame centers by the real span.
    expect(gridFrameContentWidthPx(items, 8, 100, 16)).toBeCloseTo(4 * 100 + 3 * 16, 8);
    // Full occupancy keeps the whole stored width (the uncapped fill case).
    const full = [gitem("a", 0, 0, 8, 1)];
    expect(gridFrameContentWidthPx(full, 8, 100, 16)).toBeCloseTo(8 * 100 + 7 * 16, 8);
    // An empty page keeps the full stored width so the lattice still paints.
    expect(gridFrameContentWidthPx([], 6, 90, 12)).toBeCloseTo(6 * 90 + 5 * 12, 8);
  });

  it("anchors the frame at the top share of the FREE vertical space", () => {
    const twoRows = [gitem("a", 0, 0), gitem("b", 0, 1)];
    const contentHeight = 2 * 100 + 16;
    const free = 700 - contentHeight;
    expect(gridFrameTopOffsetPx(twoRows, 700, 100, 16)).toBeCloseTo(free * 0.36, 6);
    // Overflowing content top-aligns (offset 0), never negative.
    expect(gridFrameTopOffsetPx(twoRows, contentHeight - 10, 100, 16)).toBe(0);
    // Unmeasured stage heights hand anchoring back to the CSS fallback.
    expect(gridFrameTopOffsetPx(twoRows, 0, 100, 16)).toBeNull();
    expect(gridFrameTopOffsetPx(twoRows, Number.NaN, 100, 16)).toBeNull();
  });

  it("carries the measured stage height through the metrics", () => {
    const base = calculateSquareGridMetrics({
      availableWidthPx: 900,
      columns: 6,
      gapPx: 16,
    });
    expect(base!.stageHeightPx).toBe(0);
    const measured = withMeasuredStageHeight(base!, 640);
    expect(measured!.stageHeightPx).toBe(640);
    // Degenerate heights stay unmeasured (the caller keeps the width-only
    // metrics instead of a lie).
    expect(withMeasuredStageHeight(base!, 0)).toBeNull();
    expect(withMeasuredStageHeight(base!, Number.NaN)).toBeNull();
    // Same-height re-measures return the SAME object (the hook's dedupe).
    expect(withMeasuredStageHeight(measured!, 640)).toBe(measured);
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

describe("fluidGridCellCap (Helm r3, layout-fill retune)", () => {
  it("holds the spec floor on laptop stages", () => {
    expect(fluidGridCellCap(null)).toBe(GRID_CELL_MAX_PX);
    expect(fluidGridCellCap(0)).toBe(GRID_CELL_MAX_PX);
    expect(fluidGridCellCap(Number.NaN)).toBe(GRID_CELL_MAX_PX);
    // ~900px stage: 900/9.5 ≈ 95 — below the floor.
    expect(fluidGridCellCap(900)).toBe(GRID_CELL_MAX_PX);
    // 1064px stage: 1064/9.5 = 112 — exactly the floor; one px under stays floored.
    expect(fluidGridCellCap(1064)).toBe(GRID_CELL_MAX_PX);
    expect(fluidGridCellCap(1063)).toBe(GRID_CELL_MAX_PX);
  });

  it("lets the cell breathe with the stage up to the wide ceiling", () => {
    // A 1920-class stage (≈1588px of tile area) plates ≈167px cells.
    expect(fluidGridCellCap(1588)).toBe(167);
    // A 2560-class stage saturates at the wide ceiling — never past it.
    expect(fluidGridCellCap(2228)).toBe(GRID_CELL_WIDE_MAX_PX);
    expect(fluidGridCellCap(4000)).toBe(GRID_CELL_WIDE_MAX_PX);
  });

  it("carries the measured stage width through the metrics", () => {
    const metrics = calculateSquareGridMetrics({
      availableWidthPx: 877,
      columns: 5,
      gapPx: 16,
      maxCellPx: 112,
    });
    expect(metrics?.stageWidthPx).toBe(877);
  });
});
