import { describe, expect, it } from "vitest";

import { rehydrateIconPickerPages } from "./icon-picker-model";
import type { IconPickerEntry, IconPickerPage } from "./icon-picker-model";

function entry(id: string): IconPickerEntry {
  return {
    id,
    collection: "simple-icons",
    name: id,
    label: id,
    palette: "monochrome",
    category: "brand",
  };
}

function pageOf(ids: readonly string[], total: number, nextOffset: number | null): IconPickerPage {
  return { entries: ids.map(entry), total, nextOffset };
}

/**
 * task 029: a revisited query rebuilds the FULL loaded set from the page
 * cache — the walk follows nextOffset through cached pages, dedupes by id,
 * and stops cleanly at a missing page or the end of the chain.
 */
describe("rehydrateIconPickerPages (task 029)", () => {
  it("merges the whole cached chain behind the first page", () => {
    const pages: Readonly<Record<number, IconPickerPage>> = {
      2: pageOf(["c", "d"], 6, 4),
      4: pageOf(["e", "f"], 6, null),
    };
    const restored = rehydrateIconPickerPages(pageOf(["a", "b"], 6, 2), (offset) => pages[offset]);
    expect(restored.entries.map((e) => e.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(restored.total).toBe(6);
    expect(restored.nextOffset).toBeNull();
  });

  it("stops at the first missing page and reports that page's offset", () => {
    const restored = rehydrateIconPickerPages(pageOf(["a"], 9, 96), () => undefined);
    expect(restored.entries.map((e) => e.id)).toEqual(["a"]);
    expect(restored.nextOffset).toBe(96);
  });

  it("returns the first page as-is when its chain already ends", () => {
    const first = pageOf(["a"], 1, null);
    expect(rehydrateIconPickerPages(first, () => pageOf(["x"], 1, null))).toEqual(first);
  });

  it("dedupes a repeated id across the chain (server-side overlap)", () => {
    const pages: Readonly<Record<number, IconPickerPage>> = {
      2: pageOf(["a", "c"], 3, null),
    };
    const restored = rehydrateIconPickerPages(pageOf(["a", "b"], 3, 2), (offset) => pages[offset]);
    expect(restored.entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
});
