import { describe, expect, it } from "vitest";

import { isCornerHandle, resizeCanvasRect } from "./resize";
import { isValidCanvasRect } from "./rect";
import { CANVAS_UNITS } from "./types";
import type { CanvasRect, CanvasResizeHandle } from "./types";

const ALL_HANDLES: readonly CanvasResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function rect(x: number, y: number, width: number, height: number): CanvasRect {
  return { x, y, width, height };
}

const square = rect(1000, 1000, 1000, 1000);

function resize(
  start: CanvasRect,
  handle: CanvasResizeHandle,
  deltaX: number,
  deltaY: number,
  constrainAspect = false,
): CanvasRect {
  return resizeCanvasRect({ start, handle, deltaX, deltaY, constrainAspect });
}

describe("isCornerHandle", () => {
  it("separates corners from single-axis edges", () => {
    expect(isCornerHandle("nw")).toBe(true);
    expect(isCornerHandle("se")).toBe(true);
    expect(isCornerHandle("n")).toBe(false);
    expect(isCornerHandle("e")).toBe(false);
  });
});

describe("resizeCanvasRect — single-axis handles", () => {
  it("changes width only when dragging e", () => {
    expect(resize(square, "e", 500, 999)).toEqual(rect(1000, 1000, 1500, 1000));
  });

  it("moves the left edge and keeps the right edge fixed when dragging w", () => {
    expect(resize(square, "w", 500, 0)).toEqual(rect(1500, 1000, 500, 1000));
  });

  it("changes height only when dragging s", () => {
    expect(resize(square, "s", 999, 500)).toEqual(rect(1000, 1000, 1000, 1500));
  });

  it("moves the top edge and keeps the bottom edge fixed when dragging n", () => {
    expect(resize(square, "n", 0, 500)).toEqual(rect(1000, 1500, 1000, 500));
  });
});

describe("resizeCanvasRect — corner handles", () => {
  it("anchors the opposite corner when dragging nw", () => {
    expect(resize(square, "nw", -400, -400)).toEqual(rect(600, 600, 1400, 1400));
  });

  it("anchors the opposite corner when dragging ne", () => {
    expect(resize(square, "ne", 400, -400)).toEqual(rect(1000, 600, 1400, 1400));
  });

  it("anchors the opposite corner when dragging sw", () => {
    expect(resize(square, "sw", -400, 400)).toEqual(rect(600, 1000, 1400, 1400));
  });

  it("anchors the opposite corner when dragging se", () => {
    expect(resize(square, "se", 400, 400)).toEqual(rect(1000, 1000, 1400, 1400));
  });
});

describe("resizeCanvasRect — free rectangles", () => {
  it("produces a landscape and a portrait rectangle from one square", () => {
    const wide = resize(square, "e", 3000, 0);
    const tall = resize(square, "s", 0, 3000);

    expect(wide.width).toBe(4000);
    expect(wide.height).toBe(1000);
    expect(tall.width).toBe(1000);
    expect(tall.height).toBe(4000);
  });

  it("reaches nearly the whole canvas width without a scale cap", () => {
    const start = rect(0, 0, 100, 100);
    const grown = resize(start, "e", 9800, 0);

    expect(grown.width).toBe(9900);
    expect(isValidCanvasRect(grown)).toBe(true);
  });

  it("leaves a very thin rect legal", () => {
    const thin = resize(square, "e", -9000, 0);
    expect(thin).toEqual(rect(1000, 1000, 1, 1000));
  });

  it("does not snap free resize results to any lattice", () => {
    expect(resize(square, "e", 137, 0).width).toBe(1137);
  });
});

describe("resizeCanvasRect — bounds", () => {
  it("clamps both axes to the canvas", () => {
    expect(resize(rect(9000, 9000, 1000, 1000), "e", 5000, 5000)).toEqual(rect(9000, 9000, 1000, 1000));
  });

  it("clamps the top-left corner at zero", () => {
    expect(resize(rect(0, 0, 1000, 1000), "nw", -500, -500)).toEqual(rect(0, 0, 1000, 1000));
  });

  it("keeps a full-canvas rect at its size", () => {
    expect(resize(rect(0, 0, CANVAS_UNITS, CANVAS_UNITS), "se", 500, 500)).toEqual(
      rect(0, 0, CANVAS_UNITS, CANVAS_UNITS),
    );
  });

  it("collapses to the minimum size instead of inverting", () => {
    expect(resize(square, "e", -5000, 0)).toEqual(rect(1000, 1000, 1, 1000));
    expect(resize(square, "n", 0, 5000)).toEqual(rect(1000, 1999, 1000, 1));
  });

  it("keeps every handle inside the canvas with a legal size", () => {
    for (const handle of ALL_HANDLES) {
      const next = resize(square, handle, 4000, 4000);
      expect(isValidCanvasRect(next)).toBe(true);

      const back = resize(square, handle, -4000, -4000);
      expect(isValidCanvasRect(back)).toBe(true);
    }
  });
});

describe("resizeCanvasRect — Shift aspect lock", () => {
  const wide = rect(0, 0, 1000, 500);

  it("keeps the start ratio when the width drives the drag", () => {
    const next = resize(wide, "se", 200, 0, true);
    expect(next.width).toBe(1200);
    expect(next.height).toBe(600);
  });

  it("keeps the start ratio when the height drives the drag", () => {
    const next = resize(wide, "se", 0, -100, true);
    expect(next).toEqual(rect(0, 0, 800, 400));
  });

  it("keeps the start ratio when both axes move", () => {
    const next = resize(wide, "se", 100, 100, true);
    expect(next).toEqual(rect(0, 0, 1200, 600));
  });

  it("shares one ratio across all four corners", () => {
    const ratios = (["nw", "ne", "sw", "se"] as const).map((handle) => {
      const next = resize(square, handle, 500, 500, true);
      return next.width / next.height;
    });

    for (const ratio of ratios) {
      expect(ratio).toBeCloseTo(1, 2);
    }
  });

  it("keeps the ratio within one logical unit after rounding", () => {
    const start = rect(0, 0, 1000, 667);
    const next = resize(start, "se", 100, 100, true);
    const startAspect = start.width / start.height;

    expect(Math.abs(next.width / next.height - startAspect)).toBeLessThan(0.01);
  });

  it("keeps the ratio while respecting the canvas edge", () => {
    const next = resize(rect(9000, 0, 1000, 500), "se", 500, 500, true);

    expect(next.x + next.width).toBeLessThanOrEqual(CANVAS_UNITS);
    expect(next.width / next.height).toBeCloseTo(2, 2);
  });

  it("is ignored for edge handles", () => {
    expect(resize(wide, "e", 100, 300, true)).toEqual(rect(0, 0, 1100, 500));
    expect(resize(wide, "s", 300, 100, true)).toEqual(rect(0, 0, 1000, 600));
  });

  it("matches a free resize when the ratio is not locked", () => {
    expect(resize(wide, "se", 100, 100, false)).toEqual(rect(0, 0, 1100, 600));
  });
});

describe("resizeCanvasRect — purity", () => {
  it("never mutates the start rect", () => {
    const start = rect(1000, 1000, 1000, 1000);
    const before = structuredClone(start);

    resize(start, "se", 500, 500);
    resize(start, "nw", -500, -500, true);

    expect(start).toEqual(before);
  });

  it("returns the start rect unchanged for a non-finite delta", () => {
    expect(resizeCanvasRect({ start: square, handle: "se", deltaX: Number.NaN, deltaY: 0, constrainAspect: false })).toBe(
      square,
    );
    expect(
      resizeCanvasRect({ start: square, handle: "se", deltaX: 0, deltaY: Number.POSITIVE_INFINITY, constrainAspect: true }),
    ).toBe(square);
  });

  it("returns a rect equal to the start for a zero delta", () => {
    expect(resize(square, "se", 0, 0)).toEqual(square);
  });
});
