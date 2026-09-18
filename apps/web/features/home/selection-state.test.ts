import { describe, expect, it } from "vitest";

import {
  normalizeSelection,
  selectAllIds,
  toggleSelection,
} from "./selection-state";

describe("selection state helpers", () => {
  it("selects a single item", () => {
    expect(toggleSelection(new Set(), "a")).toEqual(new Set(["a"]));
  });

  it("toggles an unselected item into the selection", () => {
    expect(toggleSelection(new Set(["a"]), "b")).toEqual(new Set(["a", "b"]));
  });

  it("toggles a selected item out of the selection", () => {
    expect(toggleSelection(new Set(["a", "b"]), "a")).toEqual(new Set(["b"]));
  });

  it("normalizes away ids that no longer exist in the layout", () => {
    expect(normalizeSelection(new Set(["a", "ghost", "b"]), new Set(["a", "b", "c"]))).toEqual(
      new Set(["a", "b"]),
    );
  });

  it("keeps the same reference when normalization changes nothing", () => {
    const selection = new Set(["a"]);
    expect(normalizeSelection(selection, new Set(["a", "b"]))).toBe(selection);
  });

  it("select all covers every layout item id", () => {
    expect(selectAllIds(new Set(["b", "a", "c"]))).toEqual(new Set(["b", "a", "c"]));
  });
});
