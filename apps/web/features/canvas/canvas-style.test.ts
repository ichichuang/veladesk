import { describe, expect, it } from "vitest";
import type { GridDefinition } from "@veladesk/desktop-engine";

import { canvasLatticeMarkers, canvasRectPercentages, canvasRectStyle } from "./canvas-style";

const grid10x8: GridDefinition = { columns: 10, rows: 8 };

describe("canvasRectPercentages", () => {
  it("converts the logical rect into percent space", () => {
    expect(canvasRectPercentages({ x: 0, y: 0, width: 10_000, height: 10_000 })).toEqual({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });
    expect(canvasRectPercentages({ x: 2500, y: 1000, width: 5000, height: 2000 })).toEqual({
      left: 25,
      top: 10,
      width: 50,
      height: 20,
    });
  });

  it("keeps extreme aspect ratios exact", () => {
    // A landscape and a portrait rect of the same area must not be rounded
    // into each other: percentages preserve them verbatim.
    expect(canvasRectPercentages({ x: 0, y: 0, width: 9000, height: 3000 })).toEqual({
      left: 0,
      top: 0,
      width: 90,
      height: 30,
    });
    expect(canvasRectPercentages({ x: 0, y: 0, width: 1000, height: 4500 })).toEqual({
      left: 0,
      top: 0,
      width: 10,
      height: 45,
    });
  });
});

describe("canvasRectStyle", () => {
  it("positions the item absolutely in percent space", () => {
    expect(canvasRectStyle({ x: 1000, y: 2000, width: 3000, height: 4000 })).toEqual({
      position: "absolute",
      left: "10%",
      top: "20%",
      width: "30%",
      height: "40%",
    });
  });

  it("never emits a grid placement", () => {
    const style = canvasRectStyle({ x: 0, y: 0, width: 10_000, height: 10_000 });
    expect(Object.keys(style)).toEqual(["position", "left", "top", "width", "height"]);
  });
});

describe("canvasLatticeMarkers", () => {
  it("emits one marker per lattice cell", () => {
    const markers = canvasLatticeMarkers(grid10x8);
    expect(markers).toHaveLength(80);
    expect(markers[0]?.key).toBe("0-0");
    expect(markers.at(-1)?.key).toBe("9-7");
  });

  it("places each marker at its cell center", () => {
    const markers = canvasLatticeMarkers(grid10x8);
    // 10 columns → cells of 1000 units (10%); 8 rows → edges rounded from
    // round(i/8*10000), so the first cell is 0..1250 (center 625 → 6.25%).
    expect(markers[0]?.left).toBeCloseTo(5, 6);
    expect(markers[0]?.top).toBeCloseTo(6.25, 6);

    const firstOfSecondRow = markers.find((marker) => marker.key === "0-1");
    expect(firstOfSecondRow?.left).toBeCloseTo(5, 6);
    expect(firstOfSecondRow?.top).toBeCloseTo(18.75, 6);
  });

  it("keeps every marker inside the canvas", () => {
    for (const marker of canvasLatticeMarkers(grid10x8)) {
      expect(marker.left).toBeGreaterThan(0);
      expect(marker.left).toBeLessThan(100);
      expect(marker.top).toBeGreaterThan(0);
      expect(marker.top).toBeLessThan(100);
    }
  });
});
