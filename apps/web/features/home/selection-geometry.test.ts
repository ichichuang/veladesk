import { describe, expect, it } from "vitest";

import {
  normalizeSelectionRect,
  rectsIntersect,
  selectIntersectingItemIds,
} from "./selection-geometry";

const rect = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});

describe("normalizeSelectionRect", () => {
  it("normalizes left-top to right-bottom drags unchanged", () => {
    expect(normalizeSelectionRect(rect(10, 10, 10, 10), rect(40, 30, 40, 30))).toEqual(
      rect(10, 10, 40, 30),
    );
  });

  it("normalizes reverse-direction drags", () => {
    expect(normalizeSelectionRect(rect(40, 30, 40, 30), rect(10, 10, 10, 10))).toEqual(
      rect(10, 10, 40, 30),
    );
  });
});

describe("rectsIntersect", () => {
  it("detects a real overlap", () => {
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(5, 5, 15, 15))).toBe(true);
  });

  it("rejects pure edge touching", () => {
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(10, 0, 20, 10))).toBe(false);
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(0, 10, 10, 20))).toBe(false);
  });

  it("rejects disjoint rects", () => {
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(20, 20, 30, 30))).toBe(false);
  });

  it("detects an item spanning the whole marquee", () => {
    expect(rectsIntersect(rect(4, 4, 6, 6), rect(0, 0, 100, 100))).toBe(true);
  });
});

describe("selectIntersectingItemIds", () => {
  const items = [
    { id: "a", rect: rect(0, 0, 50, 50) },
    { id: "b", rect: rect(60, 0, 110, 50) },
    { id: "c", rect: rect(0, 60, 50, 110) },
  ];

  it("selects items positively intersecting the marquee", () => {
    expect(selectIntersectingItemIds(items, rect(45, 45, 70, 70))).toEqual(["a", "b", "c"]);
  });

  it("excludes edge-touching items", () => {
    expect(selectIntersectingItemIds(items, rect(50, 0, 60, 110))).toEqual([]);
  });

  it("returns no ids for a zero-size marquee", () => {
    expect(selectIntersectingItemIds(items, rect(10, 10, 10, 10))).toEqual([]);
  });

  it("handles negative client coordinates", () => {
    const negative = [{ id: "n", rect: rect(-40, -40, -10, -10) }];
    expect(selectIntersectingItemIds(negative, rect(-50, -50, -20, -20))).toEqual(["n"]);
    expect(selectIntersectingItemIds(items, rect(-50, -50, -20, -20))).toEqual([]);
  });
});
