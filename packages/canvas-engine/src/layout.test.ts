import { describe, expect, it } from "vitest";

import {
  appendCanvasItem,
  areCanvasLayoutsEqual,
  canvasItemIds,
  findCanvasItem,
  isCanvasPlacementMode,
  removeCanvasItem,
  replaceCanvasItem,
  validateCanvasLayout,
  withCanvasItems,
  withCanvasMode,
} from "./layout";
import type { CanvasLayout, CanvasLayoutItem } from "./types";

function item(id: string, x: number, y: number, width = 1000, height = 1000): CanvasLayoutItem {
  return { id, rect: { x, y, width, height } };
}

function layout(
  items: readonly CanvasLayoutItem[],
  mode: CanvasLayout["mode"] = "snap",
): CanvasLayout {
  return { version: 1, mode, items };
}

const sample = layout([item("a", 0, 0), item("b", 3000, 0, 2000, 1000)]);

describe("validateCanvasLayout", () => {
  it("accepts a snap layout", () => {
    expect(validateCanvasLayout(sample)).toEqual([]);
  });

  it("accepts a freeform layout with unaligned rects", () => {
    expect(validateCanvasLayout(layout([item("a", 137, 991)], "freeform"))).toEqual([]);
  });

  it("does not treat overlapping rects as a problem", () => {
    const overlapping = layout([item("a", 0, 0, 5000, 5000), item("b", 100, 100, 5000, 5000)]);
    expect(validateCanvasLayout(overlapping)).toEqual([]);
  });

  it("reports an unsupported version", () => {
    const broken = { ...sample, version: 2 } as unknown as CanvasLayout;
    expect(validateCanvasLayout(broken)).toEqual([{ type: "invalid-version", version: 2 }]);
  });

  it("reports an unknown mode", () => {
    const broken = { ...sample, mode: "grid" } as unknown as CanvasLayout;
    expect(validateCanvasLayout(broken)).toEqual([{ type: "invalid-mode", mode: "grid" }]);
  });

  it("reports a duplicate item id once", () => {
    const duplicated = layout([item("a", 0, 0), item("a", 2000, 0), item("a", 4000, 0)]);
    expect(validateCanvasLayout(duplicated)).toEqual([
      { type: "duplicate-item-id", itemId: "a" },
      { type: "duplicate-item-id", itemId: "a" },
    ]);
  });

  it("reports invalid rects with their problems", () => {
    const broken = layout([{ id: "a", rect: { x: -1, y: 0, width: 0, height: 10 } }]);
    expect(validateCanvasLayout(broken)).toEqual([
      {
        type: "invalid-rect",
        itemId: "a",
        problems: ["negative-origin", "size-below-minimum"],
      },
    ]);
  });

  it("reports issues in a deterministic order", () => {
    const broken = {
      version: 3,
      mode: "lattice",
      items: [
        item("a", 0, 0),
        item("a", 0, 0),
        { id: "b", rect: { x: 0, y: 0, width: 0, height: 1 } },
      ],
    } as unknown as CanvasLayout;

    expect(validateCanvasLayout(broken)).toEqual([
      { type: "invalid-version", version: 3 },
      { type: "invalid-mode", mode: "lattice" },
      { type: "duplicate-item-id", itemId: "a" },
      { type: "invalid-rect", itemId: "b", problems: ["size-below-minimum"] },
    ]);
  });
});

describe("areCanvasLayoutsEqual", () => {
  it("returns true for the same reference", () => {
    expect(areCanvasLayoutsEqual(sample, sample)).toBe(true);
  });

  it("compares mode, order and geometry", () => {
    expect(areCanvasLayoutsEqual(sample, layout([item("a", 0, 0), item("b", 3000, 0, 2000, 1000)]))).toBe(
      true,
    );
    expect(areCanvasLayoutsEqual(sample, layout(sample.items, "freeform"))).toBe(false);
    expect(areCanvasLayoutsEqual(sample, layout([item("b", 3000, 0, 2000, 1000), item("a", 0, 0)]))).toBe(
      false,
    );
    expect(areCanvasLayoutsEqual(sample, layout([item("a", 0, 0), item("b", 3000, 0, 2000, 2000)]))).toBe(
      false,
    );
    expect(areCanvasLayoutsEqual(sample, layout([item("a", 0, 0)]))).toBe(false);
  });
});

describe("canvasItemIds", () => {
  it("keeps canvas order", () => {
    expect(canvasItemIds(sample)).toEqual(["a", "b"]);
    expect(canvasItemIds(layout([]))).toEqual([]);
  });
});

describe("findCanvasItem", () => {
  it("finds by id or returns undefined", () => {
    expect(findCanvasItem(sample, "b")).toEqual(item("b", 3000, 0, 2000, 1000));
    expect(findCanvasItem(sample, "ghost")).toBeUndefined();
  });
});

describe("replaceCanvasItem", () => {
  it("replaces the matching item in place", () => {
    const next = replaceCanvasItem(sample, item("b", 4000, 1000, 500, 500));
    expect(canvasItemIds(next)).toEqual(["a", "b"]);
    expect(findCanvasItem(next, "b")?.rect).toEqual({ x: 4000, y: 1000, width: 500, height: 500 });
  });

  it("returns the input reference for an unknown id", () => {
    expect(replaceCanvasItem(sample, item("ghost", 0, 0))).toBe(sample);
  });

  it("returns the input reference when the rect is unchanged", () => {
    expect(replaceCanvasItem(sample, item("a", 0, 0))).toBe(sample);
  });

  it("never mutates the input layout", () => {
    const before = structuredClone(sample);
    replaceCanvasItem(sample, item("a", 500, 500));
    expect(sample).toEqual(before);
  });
});

describe("removeCanvasItem", () => {
  it("removes the item and keeps the rest", () => {
    const next = removeCanvasItem(sample, "a");
    expect(canvasItemIds(next)).toEqual(["b"]);
  });

  it("returns the input reference for an unknown id", () => {
    expect(removeCanvasItem(sample, "ghost")).toBe(sample);
  });
});

describe("appendCanvasItem", () => {
  it("appends at the end without mutating", () => {
    const next = appendCanvasItem(sample, item("c", 100, 100));
    expect(canvasItemIds(next)).toEqual(["a", "b", "c"]);
    expect(canvasItemIds(sample)).toEqual(["a", "b"]);
  });
});

describe("withCanvasMode", () => {
  it("switches the mode and keeps geometry identical", () => {
    const next = withCanvasMode(sample, "freeform");
    expect(next.mode).toBe("freeform");
    expect(next.items).toBe(sample.items);
  });

  it("returns the input reference when the mode already matches", () => {
    expect(withCanvasMode(sample, "snap")).toBe(sample);
  });
});

describe("withCanvasItems", () => {
  it("replaces the item list verbatim", () => {
    const items = [item("z", 10, 20)];
    const next = withCanvasItems(sample, items);
    expect(next.items).toBe(items);
    expect(next.mode).toBe("snap");
  });
});

describe("isCanvasPlacementMode", () => {
  it("accepts the two documented modes only", () => {
    expect(isCanvasPlacementMode("snap")).toBe(true);
    expect(isCanvasPlacementMode("freeform")).toBe(true);
    expect(isCanvasPlacementMode("grid")).toBe(false);
    expect(isCanvasPlacementMode(undefined)).toBe(false);
  });
});
