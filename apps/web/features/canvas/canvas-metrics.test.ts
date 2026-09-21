import { describe, expect, it } from "vitest";

import {
  areCanvasPixelMetricsEqual,
  calculateCanvasPixelMetrics,
  pixelsToUnits,
  unitsToPixels,
} from "./canvas-metrics";

describe("calculateCanvasPixelMetrics", () => {
  it("measures a laid-out canvas box", () => {
    expect(calculateCanvasPixelMetrics({ clientWidth: 1200, clientHeight: 800 })).toEqual({
      width: 1200,
      height: 800,
    });
  });

  it("refuses a box that is not laid out yet", () => {
    expect(() => calculateCanvasPixelMetrics({ clientWidth: 0, clientHeight: 800 })).toThrow(
      RangeError,
    );
    expect(() => calculateCanvasPixelMetrics({ clientWidth: 1200, clientHeight: -1 })).toThrow(
      RangeError,
    );
    expect(() =>
      calculateCanvasPixelMetrics({ clientWidth: Number.NaN, clientHeight: 800 }),
    ).toThrow(RangeError);
  });
});

describe("areCanvasPixelMetricsEqual", () => {
  it("compares both axes", () => {
    expect(
      areCanvasPixelMetricsEqual({ width: 100, height: 50 }, { width: 100, height: 50 }),
    ).toBe(true);
    expect(
      areCanvasPixelMetricsEqual({ width: 100, height: 50 }, { width: 100, height: 51 }),
    ).toBe(false);
  });
});

describe("logical ↔ pixel conversion", () => {
  it("maps the full pixel extent onto the full logical axis", () => {
    expect(pixelsToUnits(1200, 1200)).toBe(10_000);
    expect(unitsToPixels(10_000, 1200)).toBe(1200);
  });

  it("keeps the two axes independent", () => {
    // A 1200×800 box has a different pitch per axis: the same 120px pointer
    // delta is 1000 logical units horizontally and 1500 vertically.
    expect(pixelsToUnits(120, 1200)).toBe(1000);
    expect(pixelsToUnits(120, 800)).toBe(1500);
  });

  it("stays continuous — rounding is the geometry engine's job", () => {
    expect(pixelsToUnits(1, 1200)).toBeCloseTo(8.3333, 3);
    expect(unitsToPixels(1, 1200)).toBeCloseTo(0.12, 6);
  });

  it("refuses a non-positive extent", () => {
    expect(() => pixelsToUnits(10, 0)).toThrow(RangeError);
    expect(() => unitsToPixels(10, -5)).toThrow(RangeError);
  });
});
