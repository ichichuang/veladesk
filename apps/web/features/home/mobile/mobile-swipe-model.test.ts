import { describe, expect, it } from "vitest";

import {
  SWIPE_COMMIT_RATIO,
  SWIPE_FLICK_VELOCITY,
  SWIPE_LOCK_PX,
  SWIPE_RUBBER_BAND_MAX_RATIO,
  adjacentSectionIndex,
  resolveSwipeAxis,
  resolveSwipeRelease,
  swipeOffset,
} from "./mobile-swipe-model";

describe("resolveSwipeAxis", () => {
  it("stays ambiguous until the lock distance is passed", () => {
    expect(resolveSwipeAxis(0, 0)).toBeNull();
    expect(resolveSwipeAxis(SWIPE_LOCK_PX - 1, 2)).toBeNull();
    expect(resolveSwipeAxis(3, SWIPE_LOCK_PX - 1)).toBeNull();
  });

  it("locks to the dominant axis", () => {
    expect(resolveSwipeAxis(30, 4)).toBe("horizontal");
    expect(resolveSwipeAxis(-30, 4)).toBe("horizontal");
    expect(resolveSwipeAxis(4, 30)).toBe("vertical");
    expect(resolveSwipeAxis(4, -30)).toBe("vertical");
  });

  it("treats a perfect diagonal as vertical (never steals the scroll)", () => {
    expect(resolveSwipeAxis(20, 20)).toBe("vertical");
  });
});

describe("swipeOffset", () => {
  it("is 1:1 while looping — the neighbour is always reachable", () => {
    expect(swipeOffset(0.37, true)).toBeCloseTo(0.37, 6);
    expect(swipeOffset(-0.8, true)).toBeCloseTo(-0.8, 6);
  });

  it("clamps at one viewport while looping (only one neighbour is mounted)", () => {
    // Dragging further would slide past the neighbour onto an empty strip.
    expect(swipeOffset(1.9, true)).toBe(1);
    expect(swipeOffset(-1.9, true)).toBe(-1);
    // Exactly one viewport is still fully reachable — no premature clamp.
    expect(swipeOffset(1, true)).toBe(1);
  });

  it("is damped and bounded without looping", () => {
    const small = swipeOffset(0.1, false);
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(0.1); // compressed

    // Repeated extra drag cannot run away: it never passes the ceiling.
    expect(swipeOffset(5, false)).toBeLessThanOrEqual(SWIPE_RUBBER_BAND_MAX_RATIO);
    expect(swipeOffset(-5, false)).toBeGreaterThanOrEqual(-SWIPE_RUBBER_BAND_MAX_RATIO);
  });

  it("is symmetric", () => {
    expect(swipeOffset(0.3, false)).toBeCloseTo(-swipeOffset(-0.3, false), 9);
  });

  it("is zero at rest", () => {
    expect(swipeOffset(0, false)).toBe(0);
    expect(swipeOffset(0, true)).toBe(0);
  });
});

describe("resolveSwipeRelease", () => {
  const base = { pageCount: 3 } as const;

  // The offset is the strip transform: negative = content slid LEFT = the
  // finger went left = the NEXT page arrives.

  it("commits to the next page on a long drag left (negative offset)", () => {
    expect(
      resolveSwipeRelease({ ...base, offset: -(SWIPE_COMMIT_RATIO + 0.01), velocity: 0 }),
    ).toEqual({ step: 1, springBack: false });
  });

  it("commits to the previous page on a long drag right (positive offset)", () => {
    expect(
      resolveSwipeRelease({ ...base, offset: SWIPE_COMMIT_RATIO + 0.01, velocity: 0 }),
    ).toEqual({ step: -1, springBack: false });
  });

  it("springs back on a short slow drag", () => {
    expect(resolveSwipeRelease({ ...base, offset: -0.05, velocity: 0 })).toEqual({
      step: 0,
      springBack: true,
    });
  });

  it("commits on a fast flick even when the drag was short", () => {
    expect(
      resolveSwipeRelease({ ...base, offset: -0.02, velocity: -(SWIPE_FLICK_VELOCITY + 0.1) }),
    ).toEqual({ step: 1, springBack: false });
    expect(
      resolveSwipeRelease({ ...base, offset: 0.02, velocity: SWIPE_FLICK_VELOCITY + 0.1 }),
    ).toEqual({ step: -1, springBack: false });
  });

  it("cancels when the release flicks back toward the start", () => {
    // Dragged left 30% but flung back right: a change of mind → spring back
    // (what native pagers do), even though the drag passed the threshold.
    expect(
      resolveSwipeRelease({ ...base, offset: -0.3, velocity: SWIPE_FLICK_VELOCITY + 0.2 }),
    ).toEqual({ step: 0, springBack: true });
  });

  it("always springs back with a single page", () => {
    expect(resolveSwipeRelease({ offset: -0.9, velocity: -2, pageCount: 1 })).toEqual({
      step: 0,
      springBack: true,
    });
  });

  it("returns the same step regardless of list length (ends are the caller's job)", () => {
    for (const pageCount of [2, 3, 9]) {
      expect(resolveSwipeRelease({ offset: -0.5, velocity: -1, pageCount })).toEqual({
        step: 1,
        springBack: false,
      });
    }
  });
});

describe("adjacentSectionIndex", () => {
  it("wraps in both directions when looping", () => {
    expect(adjacentSectionIndex(2, 1, 3, true)).toBe(0); // last → first
    expect(adjacentSectionIndex(0, -1, 3, true)).toBe(2); // first → last
    expect(adjacentSectionIndex(1, 1, 3, true)).toBe(2);
    expect(adjacentSectionIndex(1, -1, 3, true)).toBe(0);
  });

  it("clamps without looping", () => {
    expect(adjacentSectionIndex(2, 1, 3, false)).toBe(2);
    expect(adjacentSectionIndex(0, -1, 3, false)).toBe(0);
    expect(adjacentSectionIndex(0, 1, 3, false)).toBe(1);
  });

  it("is a no-op with a single section", () => {
    expect(adjacentSectionIndex(0, 1, 1, true)).toBe(0);
    expect(adjacentSectionIndex(0, -1, 1, false)).toBe(0);
  });

  it("wraps a two-section list cleanly", () => {
    expect(adjacentSectionIndex(1, 1, 2, true)).toBe(0);
    expect(adjacentSectionIndex(0, -1, 2, true)).toBe(1);
  });
});
