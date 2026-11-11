import { describe, expect, it } from "vitest";
import type { CanvasRect } from "@veladesk/canvas-engine";

import {
  CANVAS_RESIZE_HANDLES,
  GRID_SIZE_STEPS,
  canvasResizeCursor,
  canvasResizeRectAt,
  gridResizeGeometryAt,
  isCanvasResizeNoop,
  snapSpanToSizeStep,
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

  it("rounds pointer pixels to whole-cell deltas (t77 per-cell)", () => {
    // E handle: the span grows by the whole-cell delta. 140px at a 100px
    // pitch is +1 cell → 2 wide.
    const geometry = gridResizeGeometryAt(session("e", { column: 0, row: 0, columnSpan: 1, rowSpan: 1 }), 140, 0);
    expect(geometry.columnSpan).toBe(2);
    // +1.6 cells carries to 3 wide — every integer span is reachable,
    // never a size-step quantization (the t77 root cause).
    const three = gridResizeGeometryAt(session("e", { column: 0, row: 0, columnSpan: 1, rowSpan: 1 }), 160, 0);
    expect(three.columnSpan).toBe(3);
  });

  it("keeps e/w on columns, n/s on rows, corners on both", () => {
    const start = { column: 2, row: 2, columnSpan: 2, rowSpan: 2 };
    expect(gridResizeGeometryAt(session("e", start), 200, 200)).toMatchObject({
      column: 2,
      row: 2,
      columnSpan: 4,
      rowSpan: 2,
    });
    // A north drag grows upward freely (t77): pure vertical growth is no
    // longer snapped back; the anchored south edge keeps the tile in place.
    expect(gridResizeGeometryAt(session("n", start), 200, -200)).toMatchObject({
      row: 0,
      rowSpan: 4,
      columnSpan: 2,
    });
    // South-east desires 4×4 and gets 4×4 — per cell.
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
    // 300px at a 100px pitch is +3 cells → 4 wide, rows untouched.
    expect(geometry).toEqual({ column: 0, row: 0, columnSpan: 4, rowSpan: 1 });
  });

  it("every handle crosses a cell past half-pitch and is a no-op below it (t77)", () => {
    const start = { column: 2, row: 2, columnSpan: 1, rowSpan: 1 };
    const threshold = [
      ["e", 60, 0, { column: 2, row: 2, columnSpan: 2, rowSpan: 1 }],
      ["w", -60, 0, { column: 1, row: 2, columnSpan: 2, rowSpan: 1 }],
      // A pure south/north drag now grows rows — the t77 root cause fixed.
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

  it("clamps into the grid: west/north never leave the canvas, east never passes the last column", () => {
    const start = { column: 0, row: 0, columnSpan: 1, rowSpan: 1 };
    expect(gridResizeGeometryAt(session("w", start, 6), -500, 0)).toEqual(start);
    expect(gridResizeGeometryAt(session("n", start, 6), 0, -500)).toEqual(start);
    expect(
      gridResizeGeometryAt(session("e", { column: 4, row: 0, columnSpan: 1, rowSpan: 1 }, 6), 500, 0),
    ).toEqual({ column: 4, row: 0, columnSpan: 2, rowSpan: 1 });
  });

  it("the preview edge stays within half a pitch of the pointer (t77)", () => {
    // The handle center sits ON the moving edge, so the preview edge lands
    // within pitch/2 of the pointer whenever the span is not clamped by
    // the grid's minimum/maximum.
    const pitch = 160;
    const start = { column: 3, row: 2, columnSpan: 1, rowSpan: 1 };
    for (let d = -76; d <= 320; d += 4) {
      const geometry = gridResizeGeometryAt(session("se", start, 8, pitch), d, d);
      // Preview bottom-right edge offset from the pointer.
      const edgeDelta = (geometry.columnSpan - 1) * pitch - d;
      expect(Math.abs(edgeDelta)).toBeLessThanOrEqual(pitch / 2);
      const edgeDeltaY = (geometry.rowSpan - 1) * pitch - d;
      expect(Math.abs(edgeDeltaY)).toBeLessThanOrEqual(pitch / 2);
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


describe("GRID_SIZE_STEPS — the snap size system (P1)", () => {
  it("is exactly the designed ladder 1×1 / 2×1 / 2×2 / 4×2", () => {
    expect(GRID_SIZE_STEPS).toEqual([
      { w: 1, h: 1 },
      { w: 2, h: 1 },
      { w: 2, h: 2 },
      { w: 4, h: 2 },
    ]);
  });

  it("keeps an on-step desire and snaps near misses to the nearest step", () => {
    expect(snapSpanToSizeStep({ w: 2, h: 2 }, 12)).toEqual({ w: 2, h: 2 });
    expect(snapSpanToSizeStep({ w: 3, h: 1 }, 12)).toEqual({ w: 2, h: 1 });
    expect(snapSpanToSizeStep({ w: 5, h: 2 }, 12)).toEqual({ w: 4, h: 2 });
    expect(snapSpanToSizeStep({ w: 1, h: 2 }, 12)).toEqual({ w: 1, h: 1 });
  });

  it("clamps the 4-wide step into narrow grids", () => {
    expect(snapSpanToSizeStep({ w: 4, h: 2 }, 3)).toEqual({ w: 3, h: 2 });
    expect(snapSpanToSizeStep({ w: 4, h: 2 }, 1)).toEqual({ w: 1, h: 2 });
  });
});


describe("snap resize boundary closeout", () => {
  it.each(["e", "se", "w", "nw", "ne", "sw"] as const)("keeps %s step rounding inside the grid", (handle) => {
    const start = { column: handle.includes("w") ? 0 : 2, row: 0, columnSpan: 1, rowSpan: 1 };
    const result = gridResizeGeometryAt({ kind: "grid", handle, itemId: "a", startGeometry: start,
      startPointerX: 0, startPointerY: 0, pitchPx: 100, columns: 3 },
      handle.includes("w") ? -100 : 100, handle.includes("n") ? -100 : 100);
    expect(result.column).toBeGreaterThanOrEqual(0);
    expect(result.row).toBeGreaterThanOrEqual(0);
    expect(result.column + result.columnSpan).toBeLessThanOrEqual(3);
  });
});
