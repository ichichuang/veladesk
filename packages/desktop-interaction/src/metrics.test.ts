import { describe, expect, it } from "vitest";

import { calculateGridPixelMetrics } from "./metrics";
import type { GridPixelMeasurementInput } from "./types";

function measurementInput(
  overrides: Partial<GridPixelMeasurementInput> = {},
): GridPixelMeasurementInput {
  return {
    width: 600,
    height: 400,
    columnGap: 10,
    rowGap: 10,
    grid: { columns: 6, rows: 4 },
    ...overrides,
  };
}

describe("calculateGridPixelMetrics", () => {
  it("computes cell size from container size, grid and gaps", () => {
    const metrics = calculateGridPixelMetrics(measurementInput());

    expect(metrics.cellWidth).toBe((600 - 10 * 5) / 6);
    expect(metrics.cellHeight).toBe((400 - 10 * 3) / 4);
  });

  it("keeps horizontal and vertical gaps independent", () => {
    const metrics = calculateGridPixelMetrics(measurementInput({ columnGap: 20, rowGap: 4 }));

    expect(metrics.cellWidth).toBe((600 - 20 * 5) / 6);
    expect(metrics.cellHeight).toBe((400 - 4 * 3) / 4);
  });

  it("supports zero gaps", () => {
    const metrics = calculateGridPixelMetrics(measurementInput({ columnGap: 0, rowGap: 0 }));

    expect(metrics.cellWidth).toBe(100);
    expect(metrics.cellHeight).toBe(100);
  });

  it("preserves fractional pixel precision without rounding", () => {
    const metrics = calculateGridPixelMetrics(measurementInput({ width: 601, height: 401, columnGap: 1, rowGap: 1 }));

    expect(metrics.cellWidth).toBe((601 - 1 * 5) / 6);
    expect(metrics.cellHeight).toBe((401 - 1 * 3) / 4);
    expect(metrics.cellWidth).not.toBe(Math.round(metrics.cellWidth));
  });

  it("returns width, height and gaps unchanged", () => {
    const metrics = calculateGridPixelMetrics(measurementInput({ width: 321.5, height: 123.25, columnGap: 7, rowGap: 9 }));

    expect(metrics.width).toBe(321.5);
    expect(metrics.height).toBe(123.25);
    expect(metrics.columnGap).toBe(7);
    expect(metrics.rowGap).toBe(9);
  });

  it("throws RangeError for a negative column gap", () => {
    expect(() => calculateGridPixelMetrics(measurementInput({ columnGap: -1 }))).toThrow(RangeError);
  });

  it("throws RangeError for a negative row gap", () => {
    expect(() => calculateGridPixelMetrics(measurementInput({ rowGap: -2 }))).toThrow(RangeError);
  });

  it("throws RangeError for NaN width", () => {
    expect(() => calculateGridPixelMetrics(measurementInput({ width: Number.NaN }))).toThrow(RangeError);
  });

  it("throws RangeError for infinite height", () => {
    expect(() =>
      calculateGridPixelMetrics(measurementInput({ height: Number.POSITIVE_INFINITY })),
    ).toThrow(RangeError);
  });

  it("throws RangeError for zero width", () => {
    expect(() => calculateGridPixelMetrics(measurementInput({ width: 0 }))).toThrow(RangeError);
  });

  it("throws RangeError when the container is too small for the gaps", () => {
    expect(() =>
      calculateGridPixelMetrics(measurementInput({ width: 50, columnGap: 10 })),
    ).toThrow(RangeError);
  });

  it("throws RangeError when the row space is too small", () => {
    expect(() =>
      calculateGridPixelMetrics(measurementInput({ height: 10, rowGap: 10 })),
    ).toThrow(RangeError);
  });

  it("throws RangeError for an invalid grid", () => {
    expect(() =>
      calculateGridPixelMetrics(measurementInput({ grid: { columns: 0, rows: 4 } })),
    ).toThrow(RangeError);
    expect(() =>
      calculateGridPixelMetrics(measurementInput({ grid: { columns: 6, rows: 1.5 } })),
    ).toThrow(RangeError);
  });
});
