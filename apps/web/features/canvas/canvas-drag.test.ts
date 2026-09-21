import { describe, expect, it } from "vitest";
import type { GridCanvasItem, CanvasLayoutItem } from "@veladesk/canvas-engine";
import type { PagePlacement } from "@veladesk/domain";

import { commitCanvasDrag, isCanvasDragNoop, previewCanvasDrag } from "./canvas-drag";
import type { CanvasPixelMetrics } from "./canvas-metrics";

/** Freeform: 10 units per pixel horizontally, 12.5 vertically. */
const metrics: CanvasPixelMetrics = { width: 1000, height: 800 };

function freeform(items: readonly CanvasLayoutItem[]): PagePlacement {
  return { version: 2, mode: "freeform", items };
}

function grid(items: readonly GridCanvasItem[], columns = 6): PagePlacement {
  return { version: 2, mode: "grid", columns, items };
}

const freeformPair = freeform([
  { id: "a", rect: { x: 0, y: 0, width: 1000, height: 1000 } },
  { id: "b", rect: { x: 2000, y: 0, width: 1000, height: 1000 } },
]);

const gridPair = grid([
  { id: "a", column: 1, row: 1, columnSpan: 2, rowSpan: 1 },
  { id: "b", column: 4, row: 2, columnSpan: 1, rowSpan: 2 },
  { id: "c", column: 0, row: 0, columnSpan: 1, rowSpan: 1 },
]);

describe("previewCanvasDrag — freeform", () => {
  it("translates continuously — the preview returns the applied pixel delta", () => {
    const preview = previewCanvasDrag({
      placement: freeformPair,
      itemIds: ["a"],
      deltaX: 13,
      deltaY: 11,
      metrics,
      pitchPx: 1,
    });
    // 13px → 130 logical units → clamped unchanged → back to 13px; the
    // y axis rounds to 138 units → 11.04px on the 800px-tall canvas.
    expect(preview.appliedX).toBeCloseTo(13, 2);
    expect(preview.appliedY).toBeCloseTo(11.04, 2);
  });

  it("clamps the whole group once at the canvas edge", () => {
    const preview = previewCanvasDrag({
      placement: freeformPair,
      itemIds: ["a", "b"],
      deltaX: 9000,
      deltaY: 0,
      metrics,
      pitchPx: 1,
    });
    // b's right edge (3000 + 1000) clamps the group to 7000 logical units
    // → 700px on a 1000px-wide canvas.
    expect(preview.appliedX).toBeCloseTo(700, 2);
    expect(preview.appliedY).toBe(0);
  });
});

describe("previewCanvasDrag — grid", () => {
  it("rounds pointer pixels to whole cells through the pitch", () => {
    // Pitch 88px: 100px → 1 cell; 150px → 2 cells; 40px → 0 cells. The item
    // sits mid-grid so no bound clamps the delta.
    const floating = grid([
      { id: "solo", column: 3, row: 4, columnSpan: 1, rowSpan: 1 },
    ]);
    for (const [deltaPx, cells] of [
      [100, 1],
      [150, 2],
      [40, 0],
      [-100, -1],
      [-140, -2],
    ] as const) {
      const preview = previewCanvasDrag({
        placement: floating,
        itemIds: ["solo"],
        deltaX: deltaPx,
        deltaY: 0,
        metrics,
        pitchPx: 88,
      });
      expect(preview.appliedX).toBe(cells * 88);
    }
  });

  it("applies one rigid cell delta to the whole selection", () => {
    const moved = commitCanvasDrag({
      placement: gridPair,
      itemIds: ["a", "b"],
      deltaX: 88,
      deltaY: 176,
      metrics,
      pitchPx: 88,
    });
    expect(moved).not.toBeNull();
    const items = moved?.items ?? [];
    expect(items[0]).toMatchObject({ id: "a", column: 2, row: 3 });
    expect(items[1]).toMatchObject({ id: "b", column: 5, row: 4 });
    expect(items[2]).toMatchObject({ id: "c", column: 0, row: 0 });
  });

  it("clamps horizontally inside the column count", () => {
    const moved = commitCanvasDrag({
      placement: gridPair,
      itemIds: ["a"],
      deltaX: 88 * 10,
      deltaY: 0,
      metrics,
      pitchPx: 88,
    });
    // a spans columns 1..3; rightmost legal start is 4 → delta clamps to 3.
    expect(moved?.items[0]).toMatchObject({ column: 4 });
  });

  it("clamps at row 0 and grows downward without bound", () => {
    const up = commitCanvasDrag({
      placement: gridPair,
      itemIds: ["a"],
      deltaX: 0,
      deltaY: -88 * 100,
      metrics,
      pitchPx: 88,
    });
    expect(up?.items[0]).toMatchObject({ row: 0 });

    const down = commitCanvasDrag({
      placement: gridPair,
      itemIds: ["a"],
      deltaX: 0,
      deltaY: 88 * 500,
      metrics,
      pitchPx: 88,
    });
    expect(down?.items[0]).toMatchObject({ row: 501 });
  });

  it("returns null for a sub-threshold (no-op) drag", () => {
    const args = {
      placement: gridPair,
      itemIds: ["a"],
      deltaX: 30,
      deltaY: 0,
      metrics,
      pitchPx: 88,
    } as const;
    expect(isCanvasDragNoop(args)).toBe(true);
    expect(commitCanvasDrag(args)).toBeNull();
  });
});

describe("commitCanvasDrag — freeform", () => {
  it("moves items by the clamped logical delta and returns null on no-op", () => {
    const moved = commitCanvasDrag({
      placement: freeformPair,
      itemIds: ["a", "b"],
      deltaX: 100,
      deltaY: -40,
      metrics,
      pitchPx: 1,
    });
    const items = moved?.items ?? [];
    const a = items[0];
    const b = items[1];
    if (a !== undefined && "rect" in a && b !== undefined && "rect" in b) {
      expect(a.rect.x).toBe(1000);
      expect(b.rect.x).toBe(3000);
      expect(a.rect.y).toBe(0);
    }

    const noop = commitCanvasDrag({
      placement: freeformPair,
      itemIds: ["a"],
      deltaX: 0,
      deltaY: 0,
      metrics,
      pitchPx: 1,
    });
    expect(noop).toBeNull();
  });
});
