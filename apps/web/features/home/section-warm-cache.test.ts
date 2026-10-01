import { describe, expect, it } from "vitest";

import { resolveWarmSectionIds } from "./section-warm-cache";

const PAGES = ["a", "b", "c", "d", "e"] as const;

describe("resolveWarmSectionIds (020-A2 §7/§26)", () => {
  it("keeps the single section warm for a one-page workspace", () => {
    expect(resolveWarmSectionIds({ pageOrder: ["a"], activePageId: "a" })).toEqual(["a"]);
  });

  it("keeps both sections for a two-page workspace", () => {
    expect(resolveWarmSectionIds({ pageOrder: ["a", "b"], activePageId: "a" })).toEqual([
      "a",
      "b",
    ]);
    expect(resolveWarmSectionIds({ pageOrder: ["a", "b"], activePageId: "b" })).toEqual([
      "a",
      "b",
    ]);
  });

  it("keeps the whole workspace warm when it fits the ±1 window", () => {
    expect(resolveWarmSectionIds({ pageOrder: ["a", "b", "c"], activePageId: "b" })).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("widens to at most previous + active + next", () => {
    expect(resolveWarmSectionIds({ pageOrder: PAGES, activePageId: "b" })).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(resolveWarmSectionIds({ pageOrder: PAGES, activePageId: "c" })).toEqual([
      "b",
      "c",
      "d",
    ]);
  });

  it("clamps at both ends without wrapping", () => {
    expect(resolveWarmSectionIds({ pageOrder: PAGES, activePageId: "a" })).toEqual(["a", "b"]);
    expect(resolveWarmSectionIds({ pageOrder: PAGES, activePageId: "e" })).toEqual(["d", "e"]);
  });

  it("falls back deterministically for an unknown or null active id", () => {
    expect(resolveWarmSectionIds({ pageOrder: PAGES, activePageId: "nope" })).toEqual(["a"]);
    expect(resolveWarmSectionIds({ pageOrder: PAGES, activePageId: null })).toEqual(["a"]);
  });

  it("resolves to an empty set for an empty workspace", () => {
    expect(resolveWarmSectionIds({ pageOrder: [], activePageId: null })).toEqual([]);
  });

  it("never duplicates ids and preserves page ordering", () => {
    const warm = resolveWarmSectionIds({ pageOrder: PAGES, activePageId: "c" });
    expect(new Set(warm).size).toBe(warm.length);
    expect(warm).toEqual([...warm].sort());
  });
});
