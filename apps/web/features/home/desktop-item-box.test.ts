import { describe, expect, it } from "vitest";

import { elementBoxChanged } from "./element-box";

/**
 * Pure unit test for the DesktopItem measurement dedupe (task 020-A2
 * §19): a ResizeObserver callback reporting an identical (or sub-half-pixel
 * different) size must never update state — one identical observation must
 * not re-render every item of every mounted warm section.
 */
describe("elementBoxChanged", () => {
  it("treats the first real observation as a change", () => {
    expect(elementBoxChanged(null, { width: 90, height: 90 })).toBe(true);
  });

  it("ignores identical reports", () => {
    expect(elementBoxChanged({ width: 90, height: 90 }, { width: 90, height: 90 })).toBe(
      false
    );
  });

  it("ignores sub-half-pixel drift, in both dimensions", () => {
    expect(elementBoxChanged({ width: 90, height: 90 }, { width: 90.4, height: 89.7 })).toBe(
      false
    );
    expect(elementBoxChanged({ width: 90, height: 90 }, { width: 89.6, height: 90.3 })).toBe(
      false
    );
  });

  it("reports a half-pixel change or more", () => {
    expect(elementBoxChanged({ width: 90, height: 90 }, { width: 90.5, height: 90 })).toBe(
      true
    );
    expect(elementBoxChanged({ width: 90, height: 90 }, { width: 90, height: 89.5 })).toBe(
      true
    );
  });

  it("reports real resizes (span change, window resize, freeform rect)", () => {
    expect(elementBoxChanged({ width: 90, height: 90 }, { width: 186, height: 90 })).toBe(
      true
    );
    expect(elementBoxChanged({ width: 90, height: 90 }, { width: 90, height: 64 })).toBe(
      true
    );
  });
});
