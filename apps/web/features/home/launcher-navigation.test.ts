import { describe, expect, it } from "vitest";

import { moveLauncherIndex } from "./launcher-navigation";

function move(
  direction: "next" | "previous" | "first" | "last",
  currentIndex: number,
  resultCount: number,
): number {
  return moveLauncherIndex({ currentIndex, resultCount, direction });
}

describe("moveLauncherIndex", () => {
  it("returns -1 for any direction when there are no results", () => {
    expect(move("next", -1, 0)).toBe(-1);
    expect(move("previous", -1, 0)).toBe(-1);
    expect(move("first", 0, 0)).toBe(-1);
    expect(move("last", 0, 0)).toBe(-1);
  });

  it("stays on the single result", () => {
    expect(move("next", 0, 1)).toBe(0);
    expect(move("previous", 0, 1)).toBe(0);
    expect(move("first", 0, 1)).toBe(0);
    expect(move("last", 0, 1)).toBe(0);
  });

  it("moves next and previous within bounds", () => {
    expect(move("next", 0, 4)).toBe(1);
    expect(move("next", 2, 4)).toBe(3);
    expect(move("previous", 3, 4)).toBe(2);
    expect(move("previous", 1, 4)).toBe(0);
  });

  it("wraps next past the end and previous before the start", () => {
    expect(move("next", 3, 4)).toBe(0);
    expect(move("previous", 0, 4)).toBe(3);
  });

  it("jumps to first and last", () => {
    expect(move("first", 2, 5)).toBe(0);
    expect(move("last", 2, 5)).toBe(4);
  });

  it("treats an invalid current index as none-selected for next (→ 0)", () => {
    expect(move("next", -1, 3)).toBe(0);
    expect(move("next", 3, 3)).toBe(0);
    expect(move("next", 99, 3)).toBe(0);
  });

  it("treats an invalid current index as none-selected for previous (→ last)", () => {
    expect(move("previous", -1, 3)).toBe(2);
    expect(move("previous", 3, 3)).toBe(2);
    expect(move("previous", 99, 3)).toBe(2);
  });
});
