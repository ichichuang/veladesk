import { describe, expect, it } from "vitest";
import type { CanvasPlacementMode, CanvasRect } from "@veladesk/canvas-engine";
import type { GridDefinition } from "@veladesk/desktop-engine";

import {
  CANVAS_RESIZE_HANDLES,
  canvasResizeCursor,
  canvasResizeRectAt,
  isCanvasResizeNoop,
} from "./canvas-resize";
import type { CanvasResizeSession } from "./canvas-resize";
import type { CanvasPixelMetrics } from "./canvas-metrics";

/** 10 units per pixel on both axes. */
const metrics: CanvasPixelMetrics = { width: 1000, height: 1000 };
const grid: GridDefinition = { columns: 10, rows: 8 };

function rect(x: number, y: number, width: number, height: number): CanvasRect {
  return { x, y, width, height };
}

function session(
  handle: CanvasResizeSession["handle"],
  startRect: CanvasRect,
  mode: CanvasPlacementMode = "freeform",
): CanvasResizeSession {
  return { handle, startRect, startPointerX: 500, startPointerY: 500, metrics, grid, mode };
}

const square = rect(1000, 1000, 1000, 1000);

describe("CANVAS_RESIZE_HANDLES", () => {
  it("exposes all eight handles in DOM order", () => {
    expect(CANVAS_RESIZE_HANDLES).toEqual(["nw", "n", "ne", "e", "se", "s", "sw", "w"]);
  });

  it("maps each handle to its cursor", () => {
    expect(canvasResizeCursor("nw")).toBe("nwse-resize");
    expect(canvasResizeCursor("se")).toBe("nwse-resize");
    expect(canvasResizeCursor("ne")).toBe("nesw-resize");
    expect(canvasResizeCursor("sw")).toBe("nesw-resize");
    expect(canvasResizeCursor("n")).toBe("ns-resize");
    expect(canvasResizeCursor("s")).toBe("ns-resize");
    expect(canvasResizeCursor("e")).toBe("ew-resize");
    expect(canvasResizeCursor("w")).toBe("ew-resize");
  });
});

describe("canvasResizeRectAt — freeform", () => {
  it("changes only the width when dragging e", () => {
    expect(canvasResizeRectAt(session("e", square), 550, 500, false)).toEqual(
      rect(1000, 1000, 1500, 1000),
    );
  });

  it("changes only the height when dragging s", () => {
    expect(canvasResizeRectAt(session("s", square), 500, 550, false)).toEqual(
      rect(1000, 1000, 1000, 1500),
    );
  });

  it("moves position as well when dragging nw", () => {
    expect(canvasResizeRectAt(session("nw", square), 460, 460, false)).toEqual(
      rect(600, 600, 1400, 1400),
    );
  });

  it("produces arbitrary rectangles from one square", () => {
    const wide = canvasResizeRectAt(session("e", square), 700, 500, false);
    const tall = canvasResizeRectAt(session("s", square), 500, 700, false);

    expect(wide).toEqual(rect(1000, 1000, 3000, 1000));
    expect(tall).toEqual(rect(1000, 1000, 1000, 3000));
  });

  it("reaches nearly the full canvas width without a scale cap", () => {
    const grown = canvasResizeRectAt(session("w", rect(9500, 0, 500, 1000)), -450, 500, false);
    expect(grown.x).toBe(0);
    expect(grown.width).toBe(10_000);
  });

  it("clamps to the canvas bounds", () => {
    expect(canvasResizeRectAt(session("se", rect(9000, 9000, 1000, 1000)), 9900, 9900, false)).toEqual(
      rect(9000, 9000, 1000, 1000),
    );
    expect(canvasResizeRectAt(session("nw", rect(0, 0, 1000, 1000)), 100, 100, false)).toEqual(
      rect(0, 0, 1000, 1000),
    );
  });

  it("keeps a rectangle at least one logical unit thick", () => {
    expect(canvasResizeRectAt(session("e", square), 100, 500, false)).toEqual(
      rect(1000, 1000, 1, 1000),
    );
    expect(canvasResizeRectAt(session("s", square), 500, 100, false)).toEqual(
      rect(1000, 1000, 1000, 1),
    );
  });
});

describe("canvasResizeRectAt — snap", () => {
  // A snap section starts from lattice-aligned rects: column 1 / row 1 of a
  // 10×8 grid, i.e. one 1000 × 1250 cell.
  const aligned = rect(1000, 1250, 1000, 1250);

  it("snaps the preview to the lattice while dragging", () => {
    // Dragging e by 60px (600 units) reaches the next column line exactly.
    const snapped = canvasResizeRectAt(session("e", aligned, "snap"), 560, 500, false);
    expect(snapped).toEqual(rect(1000, 1250, 2000, 1250));
  });

  it("snaps both axes of a corner drag", () => {
    const snapped = canvasResizeRectAt(session("se", aligned, "snap"), 620, 700, false);
    expect(snapped).toEqual(rect(1000, 1250, 2000, 3750));
  });

  it("snaps a row edge to the row lattice, not to the column pitch", () => {
    // 1500 units below the row line: the nearest row line is +1250 (250 away)
    // rather than +2500 (1000 away), and columns must not leak into it.
    const snapped = canvasResizeRectAt(session("s", aligned, "snap"), 500, 650, false);
    expect(snapped).toEqual(rect(1000, 1250, 1000, 2500));
  });

  it("never leaves the canvas", () => {
    const snapped = canvasResizeRectAt(session("se", aligned, "snap"), 5000, 5000, false);
    expect(snapped.x + snapped.width).toBeLessThanOrEqual(10_000);
    expect(snapped.y + snapped.height).toBeLessThanOrEqual(10_000);
  });
});

describe("canvasResizeRectAt — Shift aspect lock", () => {
  const wide = rect(0, 0, 1000, 500);

  it("keeps the start ratio when the height drives the drag", () => {
    expect(canvasResizeRectAt(session("se", wide), 520, 520, true)).toEqual(rect(0, 0, 1400, 700));
  });

  it("ignores Shift for edge handles", () => {
    expect(canvasResizeRectAt(session("e", wide), 520, 700, true)).toEqual(rect(0, 0, 1200, 500));
  });

  it("does not constrain without Shift", () => {
    expect(canvasResizeRectAt(session("se", wide), 520, 500, false)).toEqual(rect(0, 0, 1200, 500));
  });
});

describe("isCanvasResizeNoop", () => {
  it("detects an unchanged rect", () => {
    expect(isCanvasResizeNoop(square, rect(1000, 1000, 1000, 1000))).toBe(true);
    expect(isCanvasResizeNoop(square, rect(1000, 1000, 1001, 1000))).toBe(false);
  });
});
