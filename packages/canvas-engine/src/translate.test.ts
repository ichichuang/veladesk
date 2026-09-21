import { describe, expect, it } from "vitest";

import type { GridDefinition } from "@veladesk/desktop-engine";

import { clampCanvasTranslation, snapCanvasTranslation, translateCanvasItems } from "./translate";
import { findCanvasItem } from "./layout";
import type { CanvasLayoutItem, CanvasLayoutV1 } from "./types";

const grid10x6: GridDefinition = { columns: 10, rows: 6 };

function item(id: string, x: number, y: number, width = 1000, height = 1000): CanvasLayoutItem {
  return { id, rect: { x, y, width, height } };
}

function layout(items: readonly CanvasLayoutItem[], mode: "snap" | "freeform" = "freeform"): CanvasLayoutV1 {
  return { version: 1, mode, items };
}

const pair = layout([item("a", 0, 0), item("b", 2000, 2000)]);
const middle = layout([item("a", 2000, 2000), item("b", 4000, 3000)]);

describe("clampCanvasTranslation", () => {
  it("rounds a continuous delta to logical units", () => {
    expect(clampCanvasTranslation(middle, ["a"], 100.4, -50.6)).toEqual({ x: 100, y: -51 });
  });

  it("clamps the group at the canvas edges from the bounding box", () => {
    expect(clampCanvasTranslation(pair, ["a", "b"], -500, -500)).toEqual({ x: 0, y: 0 });
    expect(clampCanvasTranslation(pair, ["a", "b"], 5000, 5000)).toEqual({ x: 5000, y: 5000 });
    expect(clampCanvasTranslation(pair, ["a", "b"], 9000, 9000)).toEqual({ x: 7000, y: 7000 });
  });

  it("ignores unknown ids and an empty selection", () => {
    expect(clampCanvasTranslation(pair, ["ghost"], 100, 100)).toEqual({ x: 0, y: 0 });
    expect(clampCanvasTranslation(pair, [], 100, 100)).toEqual({ x: 0, y: 0 });
  });

  it("refuses non-finite deltas", () => {
    expect(clampCanvasTranslation(pair, ["a"], Number.NaN, 10)).toEqual({ x: 0, y: 0 });
    expect(clampCanvasTranslation(pair, ["a"], Number.POSITIVE_INFINITY, 10)).toEqual({ x: 0, y: 0 });
  });
});

describe("translateCanvasItems", () => {
  it("moves a single item by the rounded delta", () => {
    const next = translateCanvasItems(middle, ["a"], 500, 250);
    expect((findCanvasItem(next, "a") as CanvasLayoutItem | undefined)?.rect).toEqual({ x: 2500, y: 2250, width: 1000, height: 1000 });
  });

  it("keeps a group rigid", () => {
    const next = translateCanvasItems(middle, ["a", "b"], 500, -500);
    const first = findCanvasItem(next, "a") as CanvasLayoutItem | undefined;
    const second = findCanvasItem(next, "b") as CanvasLayoutItem | undefined;

    expect(first?.rect).toEqual({ x: 2500, y: 1500, width: 1000, height: 1000 });
    expect(second?.rect).toEqual({ x: 4500, y: 2500, width: 1000, height: 1000 });
    expect((second?.rect.y ?? 0) - (first?.rect.y ?? 0)).toBe(1000);
  });

  it("clamps the whole group once and never scatters it", () => {
    const ceiling = layout([item("a", 9000, 9000), item("b", 9500, 9500, 500, 500)]);
    const blocked = translateCanvasItems(ceiling, ["a", "b"], 800, 800);

    expect((findCanvasItem(blocked, "a") as CanvasLayoutItem | undefined)?.rect).toEqual({ x: 9000, y: 9000, width: 1000, height: 1000 });
    expect((findCanvasItem(blocked, "b") as CanvasLayoutItem | undefined)?.rect).toEqual({ x: 9500, y: 9500, width: 500, height: 500 });

    const pushed = translateCanvasItems(ceiling, ["a", "b"], -200, -200);
    expect((findCanvasItem(pushed, "a") as CanvasLayoutItem | undefined)?.rect.x).toBe(8800);
    expect((findCanvasItem(pushed, "b") as CanvasLayoutItem | undefined)?.rect.x).toBe(9300);
  });

  it("allows moving onto another item (overlap is legal)", () => {
    const overlapping = layout([item("a", 0, 0), item("b", 2000, 0)]);
    const next = translateCanvasItems(overlapping, ["a"], 1500, 0);

    expect((findCanvasItem(next, "a") as CanvasLayoutItem | undefined)?.rect.x).toBe(1500);
    expect(next.items).toHaveLength(2);
  });

  it("returns the input reference for a zero delta", () => {
    expect(translateCanvasItems(middle, ["a"], 0, 0)).toBe(middle);
  });

  it("returns the input reference for non-finite deltas", () => {
    expect(translateCanvasItems(middle, ["a"], Number.NaN, 0)).toBe(middle);
  });

  it("returns the input reference for an empty selection", () => {
    expect(translateCanvasItems(middle, [], 100, 100)).toBe(middle);
  });

  it("keeps unselected items by identity", () => {
    const next = translateCanvasItems(middle, ["a"], 100, 100);
    expect(next.items[1]).toBe(middle.items[1]);
    expect(next.mode).toBe(middle.mode);
  });

  it("never mutates the input", () => {
    const before = structuredClone(middle);
    translateCanvasItems(middle, ["a", "b"], 100, 100);
    expect(middle).toEqual(before);
  });
});

describe("snapCanvasTranslation", () => {
  it("snaps the group through its first selected anchor", () => {
    const drifting = layout([item("a", 90, 100), item("b", 3000, 1000)]);
    const delta = snapCanvasTranslation(drifting, ["a", "b"], 20, 20, grid10x6);

    expect(delta).toEqual({ x: -90, y: -100 });

    const next = translateCanvasItems(drifting, ["a", "b"], delta.x, delta.y);
    expect((findCanvasItem(next, "a") as CanvasLayoutItem | undefined)?.rect).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
    expect((findCanvasItem(next, "b") as CanvasLayoutItem | undefined)?.rect).toEqual({ x: 2910, y: 900, width: 1000, height: 1000 });
  });

  it("uses one delta for the whole group so relative geometry survives", () => {
    const group = layout([item("a", 120, 130), item("b", 4120, 2130)]);
    const delta = snapCanvasTranslation(group, ["a", "b"], 400, 400, grid10x6);
    const next = translateCanvasItems(group, ["a", "b"], delta.x, delta.y);
    const first = findCanvasItem(next, "a") as CanvasLayoutItem | undefined;
    const second = findCanvasItem(next, "b") as CanvasLayoutItem | undefined;

    expect((second?.rect.x ?? 0) - (first?.rect.x ?? 0)).toBe(4000);
    expect((second?.rect.y ?? 0) - (first?.rect.y ?? 0)).toBe(2000);
  });

  it("clamps the snapped delta inside the canvas", () => {
    const edge = layout([item("a", 8900, 8900)]);
    const delta = snapCanvasTranslation(edge, ["a"], 5000, 5000, grid10x6);

    // The candidate position is clamped into the canvas before snapping, so
    // the item lands in the last column and the last (1667-tall) row cell.
    expect(delta).toEqual({ x: 100, y: -567 });

    const next = translateCanvasItems(edge, ["a"], delta.x, delta.y);
    expect((findCanvasItem(next, "a") as CanvasLayoutItem | undefined)?.rect).toEqual({ x: 9000, y: 8333, width: 1000, height: 1000 });
  });

  it("returns a zero delta for an empty selection or non-finite delta", () => {
    expect(snapCanvasTranslation(pair, [], 100, 100, grid10x6)).toEqual({ x: 0, y: 0 });
    expect(snapCanvasTranslation(pair, ["a"], Number.NaN, 0, grid10x6)).toEqual({ x: 0, y: 0 });
  });
});
