import { describe, expect, it } from "vitest";

import { ACCENT_SWATCH_HUES, hexFromHue, hueFromHex } from "./accent-color";

describe("ACCENT_SWATCH_HUES", () => {
  it("is a sorted, in-range curated palette", () => {
    expect(ACCENT_SWATCH_HUES.length).toBeGreaterThanOrEqual(6);
    for (const hue of ACCENT_SWATCH_HUES) {
      expect(Number.isInteger(hue)).toBe(true);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThanOrEqual(359);
    }
    const sorted = [...ACCENT_SWATCH_HUES].sort((a, b) => a - b);
    expect(ACCENT_SWATCH_HUES).toEqual(sorted);
    // The Task013 default hue is always offered.
    expect(ACCENT_SWATCH_HUES).toContain(205);
  });
});

describe("hueFromHex", () => {
  it("converts the primary hex families to their canonical hues", () => {
    expect(hueFromHex("#ff0000")).toBe(0);
    expect(hueFromHex("#00ff00")).toBe(120);
    expect(hueFromHex("#0000ff")).toBe(240);
    expect(hueFromHex("#ffff00")).toBe(60);
    expect(hueFromHex("#00ffff")).toBe(180);
    expect(hueFromHex("#ff00ff")).toBe(300);
  });

  it("accepts the short form", () => {
    expect(hueFromHex("#f00")).toBe(0);
    expect(hueFromHex("#0f0")).toBe(120);
  });

  it("maps achromatic grays to a stable canonical hue", () => {
    expect(hueFromHex("#808080")).toBe(0);
    expect(hueFromHex("#000000")).toBe(0);
  });

  it("rejects unparsable input instead of inventing a value", () => {
    expect(hueFromHex("")).toBeUndefined();
    expect(hueFromHex("blue")).toBeUndefined();
    expect(hueFromHex("#12345")).toBeUndefined();
    expect(hueFromHex("#1234567")).toBeUndefined();
  });

  it("always returns an integer inside 0–359 for accepted input", () => {
    for (const hex of ["#5b8def", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981"]) {
      const hue = hueFromHex(hex);
      expect(hue).toBeDefined();
      expect(Number.isInteger(hue)).toBe(true);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThanOrEqual(359);
    }
  });
});

describe("hexFromHue", () => {
  it("produces saturated mid-tone hex colors that round-trip the hue", () => {
    expect(hueFromHex(hexFromHue(0))).toBe(0);
    expect(hueFromHex(hexFromHue(120))).toBe(120);
    expect(hueFromHex(hexFromHue(205))).toBe(205);
    expect(hueFromHex(hexFromHue(359))).toBe(359);
  });

  it("wraps out-of-range hues into 0–359", () => {
    expect(hexFromHue(360)).toBe(hexFromHue(0));
    expect(hexFromHue(-15)).toBe(hexFromHue(345));
  });
});
