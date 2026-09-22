import { describe, expect, it } from "vitest";
import type { CanvasRect } from "@veladesk/canvas-engine";

import {
  CANVAS_RESIZE_HANDLES,
  canvasResizeCursor,
  canvasResizeRectAt,
  gridResizeGeometryAt,
  isCanvasResizeNoop,
} from "./canvas-resize";
import type { FreeformResizeSession, GridResizeSession } from "./canvas-resize";
import type { CanvasPixelMetrics } from "./canvas-metrics";

const metrics: CanvasPixelMetrics = { width: 1000, height: 800 };

describe("CANVAS_RESIZE_HANDLES", () => {
  it("offers all eight handles in DOM order", () => {
    expect(CANVAS_RESIZE_HANDLES).toEqual(["nw", "n", "ne", "e", "se", "s", "sw", "w"]);
  });

  it("maps each handle to its cursor", () => {
    expect(canvasResizeCursor("nw")).toBe("nwse-resize");
    expect(canvasResizeCursor("n")).toBe("ns-resize");
    expect(canvasResizeCursor("e")).toBe("ew-resize");
  });
});

describe("canvasResizeRectAt — freeform", () => {
  const session: FreeformResizeSession = {
    kind: "freeform",
    handle: "se",
    startRect: { x: 1000, y: 1000, width: 2000, height: 1600 },
    startPointerX: 0,
    startPointerY: 0,
    metrics,
  };

  it("changes width only through e, height only through s", () => {
    const e = canvasResizeRectAt({ ...session, handle: "e" }, 100, 0, false);
    expect(e.width).toBe(3000);
    expect(e.height).toBe(1600);

    const s = canvasResizeRectAt({ ...session, handle: "s" }, 100, 0, false);
    expect(s.width).toBe(2000);
  });

  it("honours the Shift aspect lock on corners only", () => {
    const locked = canvasResizeRectAt(session, 500, 0, true);
    // 50px → 500 logical wide → height follows the start aspect 2000/1600.
    expect(locked.width / locked.height).toBeCloseTo(2000 / 1600, 5);
  });
});

describe("gridResizeGeometryAt — grid", () => {
  function session(
    handle: GridResizeSession["handle"],
    start: { column: number; row: number; columnSpan: number; rowSpan: number },
    columns = 6,
    pitchPx = 100,
  ): GridResizeSession {
    return {
      kind: "grid",
      handle,
      itemId: "a",
      startGeometry: start,
      startPointerX: 0,
      startPointerY: 0,
      pitchPx,
      columns,
    };
  }

  it("rounds pointer pixels to whole cell deltas", () => {
    // E handle: the span grows by the whole-cell delta. 140px at a 100px
    // pitch is +1 cell; 160px is +2.
    const geometry = gridResizeGeometryAt(session("e", { column: 0, row: 0, columnSpan: 1, rowSpan: 1 }), 140, 0);
    expect(geometry.columnSpan).toBe(2);
    const two = gridResizeGeometryAt(session("e", { column: 0, row: 0, columnSpan: 1, rowSpan: 1 }), 160, 0);
    expect(two.columnSpan).toBe(3);
  });

  it("keeps e/w on columns, n/s on rows, corners on both", () => {
    const start = { column: 2, row: 2, columnSpan: 2, rowSpan: 2 };
    expect(gridResizeGeometryAt(session("e", start), 200, 200)).toMatchObject({
      column: 2,
      row: 2,
      columnSpan: 4,
      rowSpan: 2,
    });
    expect(gridResizeGeometryAt(session("n", start), 200, -200)).toMatchObject({
      row: 0,
      rowSpan: 4,
      columnSpan: 2,
    });
    expect(gridResizeGeometryAt(session("se", start), 200, 200)).toMatchObject({
      columnSpan: 4,
      rowSpan: 4,
    });
  });

  it("ignores Shift — aspect locking never applies to grid spans", () => {
    const geometry = gridResizeGeometryAt(
      session("se", { column: 0, row: 0, columnSpan: 1, rowSpan: 1 }),
      300,
      0,
    );
    expect(geometry).toEqual({ column: 0, row: 0, columnSpan: 4, rowSpan: 1 });
  });

  it("every one of the eight handles crosses exactly one cell at half-pitch and is a no-op below it (017-B)", () => {
    const start = { column: 2, row: 2, columnSpan: 1, rowSpan: 1 };
    const threshold = [
      ["e", 60, 0, { column: 2, row: 2, columnSpan: 2, rowSpan: 1 }],
      ["w", -60, 0, { column: 1, row: 2, columnSpan: 2, rowSpan: 1 }],
      ["s", 0, 60, { column: 2, row: 2, columnSpan: 1, rowSpan: 2 }],
      ["n", 0, -60, { column: 2, row: 1, columnSpan: 1, rowSpan: 2 }],
      ["se", 60, 60, { column: 2, row: 2, columnSpan: 2, rowSpan: 2 }],
      ["nw", -60, -60, { column: 1, row: 1, columnSpan: 2, rowSpan: 2 }],
      ["ne", 60, -60, { column: 2, row: 1, columnSpan: 2, rowSpan: 2 }],
      ["sw", -60, 60, { column: 1, row: 2, columnSpan: 2, rowSpan: 2 }],
    ] as const;
    for (const [handle, dx, dy, expected] of threshold) {
      expect(gridResizeGeometryAt(session(handle, start, 8, 100), dx, dy), handle).toEqual(expected);
    }
    // Below the half-pitch threshold every handle leaves the geometry
    // untouched — integer previews only, no fractional spans.
    const below = [
      ["e", 40, 0],
      ["w", -40, 0],
      ["s", 0, 40],
      ["n", 0, -40],
      ["se", 40, 40],
      ["nw", -40, -40],
      ["ne", 40, -40],
      ["sw", -40, 40],
    ] as const;
    for (const [handle, dx, dy] of below) {
      expect(gridResizeGeometryAt(session(handle, start, 8, 100), dx, dy), handle).toEqual(start);
    }
  });
});

describe("isCanvasResizeNoop", () => {
  it("compares rects in freeform and cell geometry in grid", () => {
    const rect = (x: number): CanvasRect => ({ x, y: 0, width: 100, height: 100 });
    expect(isCanvasResizeNoop({ kind: "freeform", rect: rect(0) }, { kind: "freeform", rect: rect(0) })).toBe(true);
    expect(isCanvasResizeNoop({ kind: "freeform", rect: rect(0) }, { kind: "freeform", rect: rect(1) })).toBe(false);

    const g = (column: number) => ({ column, row: 0, columnSpan: 1, rowSpan: 1 });
    expect(isCanvasResizeNoop({ kind: "grid", geometry: g(0) }, { kind: "grid", geometry: g(0) })).toBe(true);
    expect(isCanvasResizeNoop({ kind: "grid", geometry: g(0) }, { kind: "grid", geometry: g(1) })).toBe(false);
    // Mixed kinds never compare equal.
    expect(isCanvasResizeNoop({ kind: "grid", geometry: g(0) }, { kind: "freeform", rect: rect(0) })).toBe(true);
  });
});
