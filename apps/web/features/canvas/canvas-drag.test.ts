import { describe, expect, it } from "vitest";
import type { CanvasLayout } from "@veladesk/canvas-engine";
import type { GridDefinition } from "@veladesk/desktop-engine";

import { commitCanvasDrag, previewCanvasDrag } from "./canvas-drag";
import type { CanvasPixelMetrics } from "./canvas-metrics";

/** 10 units per pixel horizontally, 12.5 vertically. */
const metrics: CanvasPixelMetrics = { width: 1000, height: 800 };
const grid: GridDefinition = { columns: 10, rows: 8 };

function canvas(mode: CanvasLayout["mode"], items: CanvasLayout["items"]): CanvasLayout {
  return { version: 1, mode, items };
}

const freeform = canvas("freeform", [
  { id: "a", rect: { x: 0, y: 0, width: 1000, height: 1000 } },
  { id: "b", rect: { x: 2000, y: 0, width: 1000, height: 1000 } },
]);

const snap = canvas("snap", [
  { id: "a", rect: { x: 0, y: 0, width: 1000, height: 1250 } },
  { id: "b", rect: { x: 3000, y: 0, width: 1000, height: 1250 } },
]);

describe("previewCanvasDrag — freeform", () => {
  it("translates continuously in logical units", () => {
    const preview = previewCanvasDrag({
      canvas: freeform,
      itemIds: ["a"],
      deltaX: 30,
      deltaY: 40,
      metrics,
      grid,
    });
    expect(preview.translation).toEqual({ x: 300, y: 500 });
    // The pixel form is what the preview transform uses, so the rendered
    // translation matches the committed one exactly.
    expect(preview.appliedX).toBeCloseTo(30, 6);
    expect(preview.appliedY).toBeCloseTo(40, 6);
  });

  it("moves a group rigidly with one delta", () => {
    const preview = previewCanvasDrag({
      canvas: freeform,
      itemIds: ["a", "b"],
      deltaX: 30,
      deltaY: 0,
      metrics,
      grid,
    });
    expect(preview.translation).toEqual({ x: 300, y: 0 });
  });

  it("lands on non-lattice coordinates", () => {
    const moved = commitCanvasDrag({
      canvas: freeform,
      itemIds: ["a"],
      deltaX: 13,
      deltaY: 7,
      metrics,
      grid,
    });
    expect(moved?.items[0]?.rect).toEqual({ x: 130, y: 88, width: 1000, height: 1000 });
  });

  it("clamps the whole selection once, at the canvas edge", () => {
    const atEdge = canvas("freeform", [
      { id: "a", rect: { x: 9000, y: 0, width: 1000, height: 1000 } },
    ]);
    const preview = previewCanvasDrag({
      canvas: atEdge,
      itemIds: ["a"],
      deltaX: 50,
      deltaY: 0,
      metrics,
      grid,
    });
    expect(preview.translation).toEqual({ x: 0, y: 0 });
    expect(
      commitCanvasDrag({ canvas: atEdge, itemIds: ["a"], deltaX: 50, deltaY: 0, metrics, grid }),
    ).toBeNull();
  });

  it("allows dragging an item onto another one", () => {
    const moved = commitCanvasDrag({
      canvas: freeform,
      itemIds: ["a"],
      deltaX: 150,
      deltaY: 0,
      metrics,
      grid,
    });
    expect(moved?.items.map((item) => item.rect.x)).toEqual([1500, 2000]);
  });
});

describe("previewCanvasDrag — snap", () => {
  it("resolves one snapped delta from the group anchor", () => {
    const preview = previewCanvasDrag({
      canvas: snap,
      itemIds: ["a", "b"],
      deltaX: 60,
      deltaY: 60,
      metrics,
      grid,
    });
    // 60px = 600 units → the anchor snaps to the next column line (1000) and
    // to the next row line (1250); ONE delta moves the whole group.
    expect(preview.translation).toEqual({ x: 1000, y: 1250 });
    expect(preview.appliedX).toBeCloseTo(100, 6);
    expect(preview.appliedY).toBeCloseTo(100, 6);
  });

  it("keeps relative geometry of a mixed group", () => {
    const mixed = canvas("snap", [
      { id: "a", rect: { x: 0, y: 0, width: 1000, height: 1250 } },
      { id: "b", rect: { x: 4000, y: 2500, width: 3000, height: 1250 } },
    ]);
    const moved = commitCanvasDrag({
      canvas: mixed,
      itemIds: ["a", "b"],
      deltaX: 60,
      deltaY: 0,
      metrics,
      grid,
    });

    expect(moved?.items[0]?.rect.x).toBe(1000);
    expect(moved?.items[1]?.rect.x).toBe(5000);
    expect((moved?.items[1]?.rect.y ?? 0) - (moved?.items[0]?.rect.y ?? 0)).toBe(2500);
  });

  it("stays put when the pointer has not crossed a lattice line", () => {
    const preview = previewCanvasDrag({
      canvas: snap,
      itemIds: ["a"],
      deltaX: 30,
      deltaY: 30,
      metrics,
      grid,
    });
    expect(preview.translation).toEqual({ x: 0, y: 0 });
    expect(
      commitCanvasDrag({ canvas: snap, itemIds: ["a"], deltaX: 30, deltaY: 30, metrics, grid }),
    ).toBeNull();
  });

  it("never rejects a drop onto an occupied lattice cell", () => {
    const overlapping = canvas("snap", [
      { id: "a", rect: { x: 0, y: 0, width: 1000, height: 1250 } },
      { id: "b", rect: { x: 1000, y: 0, width: 1000, height: 1250 } },
    ]);
    const moved = commitCanvasDrag({
      canvas: overlapping,
      itemIds: ["a"],
      deltaX: 60,
      deltaY: 0,
      metrics,
      grid,
    });
    expect(moved?.items.map((item) => item.rect.x)).toEqual([1000, 1000]);
  });
});

describe("commitCanvasDrag", () => {
  it("returns null for a selection that resolves back to where it was", () => {
    expect(
      commitCanvasDrag({ canvas: freeform, itemIds: ["a"], deltaX: 0, deltaY: 0, metrics, grid }),
    ).toBeNull();
  });

  it("returns null for an unknown selection", () => {
    expect(
      commitCanvasDrag({ canvas: freeform, itemIds: ["ghost"], deltaX: 30, deltaY: 0, metrics, grid }),
    ).toBeNull();
  });

  it("leaves unselected items and the mode untouched", () => {
    const moved = commitCanvasDrag({
      canvas: freeform,
      itemIds: ["a"],
      deltaX: 30,
      deltaY: 0,
      metrics,
      grid,
    });
    expect(moved?.items[1]).toBe(freeform.items[1]);
    expect(moved?.mode).toBe("freeform");
  });
});
