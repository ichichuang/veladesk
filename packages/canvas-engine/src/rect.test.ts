import { describe, expect, it } from "vitest";

import {
  canvasRectFromEdges,
  canvasRectsEqual,
  clampNumber,
  isSafeInteger,
  isValidCanvasRect,
  validateCanvasRect,
} from "./rect";
import { CANVAS_UNITS } from "./types";
import type { CanvasRect } from "./types";

function rect(x: number, y: number, width: number, height: number): CanvasRect {
  return { x, y, width, height };
}

describe("validateCanvasRect", () => {
  it("accepts the smallest legal rect", () => {
    expect(validateCanvasRect(rect(0, 0, 1, 1))).toEqual([]);
  });

  it("accepts a rect that fills the whole canvas", () => {
    expect(validateCanvasRect(rect(0, 0, CANVAS_UNITS, CANVAS_UNITS))).toEqual([]);
  });

  it("accepts extreme aspect ratios without a scale cap", () => {
    expect(validateCanvasRect(rect(0, 0, 9000, 3000))).toEqual([]);
    expect(validateCanvasRect(rect(1000, 1000, 1000, 4500))).toEqual([]);
  });

  it("accepts a nearly full-width rect and a very thin legal rect", () => {
    expect(validateCanvasRect(rect(0, 0, 9999, 4000))).toEqual([]);
    expect(validateCanvasRect(rect(0, 0, 1, 9000))).toEqual([]);
  });

  it("reports not-safe-integer for fractional fields", () => {
    expect(validateCanvasRect(rect(0.5, 0, 10, 10))).toEqual(["not-safe-integer"]);
    expect(validateCanvasRect(rect(0, 0, 10.25, 10))).toEqual(["not-safe-integer"]);
  });

  it("reports not-safe-integer for NaN and Infinity", () => {
    expect(validateCanvasRect(rect(Number.NaN, 0, 10, 10))).toEqual(["not-safe-integer"]);
    expect(validateCanvasRect(rect(0, 0, Number.POSITIVE_INFINITY, 10))).toEqual([
      "not-safe-integer",
    ]);
  });

  it("reports negative-origin for a negative x or y", () => {
    expect(validateCanvasRect(rect(-1, 0, 10, 10))).toEqual(["negative-origin"]);
    expect(validateCanvasRect(rect(0, -1, 10, 10))).toEqual(["negative-origin"]);
  });

  it("reports size-below-minimum for a zero extent", () => {
    expect(validateCanvasRect(rect(0, 0, 0, 10))).toEqual(["size-below-minimum"]);
    expect(validateCanvasRect(rect(0, 0, 10, 0))).toEqual(["size-below-minimum"]);
  });

  it("reports exceeds-canvas when an edge leaves the canvas", () => {
    expect(validateCanvasRect(rect(CANVAS_UNITS, 0, 1, 10))).toEqual(["exceeds-canvas"]);
    expect(validateCanvasRect(rect(0, 0, CANVAS_UNITS, CANVAS_UNITS + 1))).toEqual([
      "exceeds-canvas",
    ]);
  });

  it("reports several problems in a stable order", () => {
    expect(validateCanvasRect(rect(-5, 0, 0, CANVAS_UNITS + 10))).toEqual([
      "negative-origin",
      "size-below-minimum",
      "exceeds-canvas",
    ]);
  });
});

describe("isValidCanvasRect", () => {
  it("mirrors the problem list", () => {
    expect(isValidCanvasRect(rect(0, 0, 10000, 10000))).toBe(true);
    expect(isValidCanvasRect(rect(0, 0, 10000, 10001))).toBe(false);
  });
});

describe("canvasRectsEqual", () => {
  it("compares structurally", () => {
    expect(canvasRectsEqual(rect(1, 2, 3, 4), rect(1, 2, 3, 4))).toBe(true);
  });

  it("detects any field difference", () => {
    expect(canvasRectsEqual(rect(1, 2, 3, 4), rect(0, 2, 3, 4))).toBe(false);
    expect(canvasRectsEqual(rect(1, 2, 3, 4), rect(1, 2, 3, 5))).toBe(false);
    expect(canvasRectsEqual(rect(1, 2, 3, 4), rect(1, 2, 4, 4))).toBe(false);
  });
});

describe("canvasRectFromEdges", () => {
  it("derives width and height from the four edges", () => {
    expect(canvasRectFromEdges(1000, 3333, 5000, 6667)).toEqual(rect(1000, 3333, 4000, 3334));
  });
});

describe("isSafeInteger", () => {
  it("accepts integers only", () => {
    expect(isSafeInteger(0)).toBe(true);
    expect(isSafeInteger(-3)).toBe(true);
    expect(isSafeInteger(1.5)).toBe(false);
    expect(isSafeInteger(Number.NaN)).toBe(false);
  });
});

describe("clampNumber", () => {
  it("clamps into the inclusive range", () => {
    expect(clampNumber(-5, 0, 10)).toBe(0);
    expect(clampNumber(5, 0, 10)).toBe(5);
    expect(clampNumber(50, 0, 10)).toBe(10);
  });
});
