import { describe, expect, it } from "vitest";

import { dragDeltaToDesiredPosition } from "./drag";
import type { GridPixelMetrics } from "./types";

/** 100 px horizontal and vertical pitch (90 px cell + 10 px gap). */
const squareMetrics: GridPixelMetrics = {
  width: 600,
  height: 400,
  columnGap: 10,
  rowGap: 10,
  cellWidth: 90,
  cellHeight: 90,
};

describe("dragDeltaToDesiredPosition", () => {
  it("keeps the start position for a zero delta", () => {
    expect(
      dragDeltaToDesiredPosition({
        start: { column: 1, row: 2 },
        delta: { x: 0, y: 0 },
        metrics: squareMetrics,
      }),
    ).toEqual({ column: 1, row: 2 });
  });

  it("does not move for a delta below half a pitch", () => {
    expect(
      dragDeltaToDesiredPosition({
        start: { column: 2, row: 1 },
        delta: { x: 49, y: 49 },
        metrics: squareMetrics,
      }),
    ).toEqual({ column: 2, row: 1 });
  });

  it("moves one cell for a delta just past half a pitch", () => {
    expect(
      dragDeltaToDesiredPosition({
        start: { column: 2, row: 1 },
        delta: { x: 51, y: 51 },
        metrics: squareMetrics,
      }),
    ).toEqual({ column: 3, row: 2 });
  });

  it("moves one cell for exactly half a pitch", () => {
    expect(
      dragDeltaToDesiredPosition({
        start: { column: 0, row: 0 },
        delta: { x: 50, y: 50 },
        metrics: squareMetrics,
      }),
    ).toEqual({ column: 1, row: 1 });
  });

  it("moves backwards for negative deltas", () => {
    expect(
      dragDeltaToDesiredPosition({
        start: { column: 3, row: 3 },
        delta: { x: -60, y: -60 },
        metrics: squareMetrics,
      }),
    ).toEqual({ column: 2, row: 2 });
  });

  it("rounds each axis independently", () => {
    expect(
      dragDeltaToDesiredPosition({
        start: { column: 2, row: 2 },
        delta: { x: -40, y: -60 },
        metrics: squareMetrics,
      }),
    ).toEqual({ column: 2, row: 1 });
  });

  it("moves multiple cells for large deltas", () => {
    expect(
      dragDeltaToDesiredPosition({
        start: { column: 0, row: 0 },
        delta: { x: 260, y: 350 },
        metrics: squareMetrics,
      }),
    ).toEqual({ column: 3, row: 4 });
  });

  it("handles different horizontal and vertical pitches", () => {
    const metrics: GridPixelMetrics = {
      width: 600,
      height: 400,
      columnGap: 10,
      rowGap: 5,
      cellWidth: 90,
      cellHeight: 40,
    };

    expect(
      dragDeltaToDesiredPosition({
        start: { column: 1, row: 1 },
        delta: { x: 210, y: 130 },
        metrics,
      }),
    ).toEqual({ column: 3, row: 4 });
  });

  it("works with fractional metrics", () => {
    const metrics: GridPixelMetrics = {
      width: 600,
      height: 400,
      columnGap: 10,
      rowGap: 10,
      cellWidth: (600 - 10 * 5) / 6,
      cellHeight: (400 - 10 * 3) / 4,
    };

    expect(
      dragDeltaToDesiredPosition({
        start: { column: 0, row: 0 },
        delta: { x: 110, y: 110 },
        metrics,
      }),
    ).toEqual({ column: 1, row: 1 });
  });

  it("moves relative to a non-origin start position", () => {
    expect(
      dragDeltaToDesiredPosition({
        start: { column: 2, row: 1 },
        delta: { x: 100, y: -100 },
        metrics: squareMetrics,
      }),
    ).toEqual({ column: 3, row: 0 });
  });

  it("throws RangeError for NaN delta.x", () => {
    expect(() =>
      dragDeltaToDesiredPosition({
        start: { column: 0, row: 0 },
        delta: { x: Number.NaN, y: 0 },
        metrics: squareMetrics,
      }),
    ).toThrow(RangeError);
  });

  it("throws RangeError for infinite delta.y", () => {
    expect(() =>
      dragDeltaToDesiredPosition({
        start: { column: 0, row: 0 },
        delta: { x: 0, y: Number.POSITIVE_INFINITY },
        metrics: squareMetrics,
      }),
    ).toThrow(RangeError);
  });

  it("throws RangeError for invalid metrics", () => {
    expect(() =>
      dragDeltaToDesiredPosition({
        start: { column: 0, row: 0 },
        delta: { x: 10, y: 10 },
        metrics: { ...squareMetrics, cellWidth: 0 },
      }),
    ).toThrow(RangeError);
    expect(() =>
      dragDeltaToDesiredPosition({
        start: { column: 0, row: 0 },
        delta: { x: 10, y: 10 },
        metrics: { ...squareMetrics, columnGap: Number.NaN },
      }),
    ).toThrow(RangeError);
  });
});
