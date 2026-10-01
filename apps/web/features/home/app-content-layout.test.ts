import { describe, expect, it } from "vitest";

import type { AppShortcut } from "@veladesk/domain";

import {
  INLINE_ASPECT_THRESHOLD,
  buildAppContentStyleVars,
  generatedIconOpticalScale,
  resolveAppContentLayout,
  resolveAppContentLayoutForApp,
  type AppContentLayout,
} from "./app-content-layout";

/**
 * Pure tests for the adaptive app content layout (task 019-B §18–§20).
 *
 * The resolver is the single sizing authority for icon + title INSIDE a
 * user-owned outer box. These tests fix the contract: modes, positivity,
 * no available-space overflow, visible responsive growth across the
 * normal resize range, generated-text optical sizing, geometry-var
 * invariance, and legacy-scale equivalence.
 */

function resolve(width: number, height: number, labelVisible = true): AppContentLayout {
  return resolveAppContentLayout({
    width,
    height,
    labelVisible,
    iconKind: "library",
  });
}

function generated(width: number, height: number, codePoints: number): AppContentLayout {
  return resolveAppContentLayout({
    width,
    height,
    labelVisible: true,
    iconKind: "generated",
    generatedTextLength: codePoints,
  });
}

function expectFiniteNumbers(layout: AppContentLayout): void {
  for (const [name, value] of Object.entries(layout)) {
    if (typeof value === "number") {
      expect(Number.isFinite(value), `${name} finite (${value})`).toBe(true);
    }
  }
}

/** No available-space overflow for a titled layout. */
function expectFitsBox(layout: AppContentLayout, width: number, height: number): void {
  expect(layout.padding, "positive padding").toBeGreaterThan(0);
  expect(layout.iconBoxSize, "positive icon size").toBeGreaterThan(0);
  expect(layout.labelFontSize, "positive label font").toBeGreaterThan(0);
  expect(layout.iconBoxSize, "icon within width").toBeLessThanOrEqual(width - 2 * layout.padding + 0.51);
  expect(layout.iconBoxSize, "icon within height").toBeLessThanOrEqual(height - 2 * layout.padding + 0.51);
  if (layout.mode === "stack") {
    const used =
      2 * layout.padding + layout.iconBoxSize + layout.gap + layout.labelLineHeight;
    expect(used, `stack group fits height (used ${used.toFixed(2)} of ${height})`).toBeLessThanOrEqual(
      height + 0.51,
    );
  }
  if (layout.mode === "inline") {
    const used = 2 * layout.padding + layout.iconBoxSize + layout.gap;
    expect(used, `inline icon+gap fit width (used ${used.toFixed(2)} of ${width})`).toBeLessThanOrEqual(
      width + 0.51,
    );
    expect(
      layout.labelMaxWidth + used,
      "inline group + label budget within width",
    ).toBeLessThanOrEqual(width + 0.51);
  }
}

describe("adaptive app content layout (019-B)", () => {
  it("composes square and near-square boxes as stack", () => {
    for (const [width, height] of [
      [80, 80],
      [120, 120],
      [240, 240],
      [360, 360],
      [240, 160], // ratio 1.5 — moderately wide stays stack
    ] as const) {
      const layout = resolve(width, height);
      expect(layout.mode, `${width}×${height}`).toBe("stack");
      expectFiniteNumbers(layout);
      expectFitsBox(layout, width, height);
    }
  });

  it("composes portrait boxes as stack and stays balanced", () => {
    const layout = resolve(100, 240);
    expect(layout.mode).toBe("stack");
    expectFiniteNumbers(layout);
    expectFitsBox(layout, 100, 240);
    // The icon stays proportional to the narrow side, not drowned by the
    // tall box.
    expect(layout.iconBoxSize).toBeGreaterThan(50);
    expect(layout.iconBoxSize).toBeLessThan(100);
  });

  it("activates inline mode for clearly landscape boxes", () => {
    for (const [width, height] of [
      [240, 100], // 2.4
      [360, 120], // 3.0 — a 3×1 strip must not center a tiny icon
      [400, 200], // 2.0
    ] as const) {
      const layout = resolve(width, height);
      expect(layout.mode, `${width}×${height}`).toBe("inline");
      expectFiniteNumbers(layout);
      expectFitsBox(layout, width, height);
    }
    // A 3×1 strip fills its height with the icon, not a floating dot.
    const strip = resolve(360, 120);
    expect(strip.iconBoxSize).toBeGreaterThanOrEqual(0.7 * 120);
    // The title gets the remaining horizontal budget.
    expect(strip.labelMaxWidth).toBeGreaterThanOrEqual(120);
  });

  it("switches to solo mode exactly when the label is hidden", () => {
    for (const [width, height] of [
      [120, 120],
      [360, 360],
      [240, 100],
      [100, 240],
    ] as const) {
      const layout = resolveAppContentLayout({
        width,
        height,
        labelVisible: false,
        iconKind: "library",
      });
      expect(layout.mode, `${width}×${height} hidden`).toBe("solo");
      expectFiniteNumbers(layout);
      expect(layout.iconBoxSize).toBeLessThanOrEqual(width - 2 * layout.padding + 0.51);
      expect(layout.iconBoxSize).toBeLessThanOrEqual(height - 2 * layout.padding + 0.51);
    }
    // Solo uses the freed title strip: a bigger icon than the titled
    // square composition on the same box.
    const solo = resolveAppContentLayout({ width: 120, height: 120, labelVisible: false, iconKind: "library" });
    const stack = resolve(120, 120);
    expect(solo.iconBoxSize).toBeGreaterThan(stack.iconBoxSize);
  });

  it("grows icon and label visibly across the square resize range", () => {
    const small = resolve(80, 80);
    const medium = resolve(120, 120);
    const large = resolve(240, 240);
    const huge = resolve(360, 360);

    // 1×1 compact but readable, growing with every meaningful step.
    expect(small.iconBoxSize).toBeGreaterThan(30);
    expect(medium.iconBoxSize).toBeGreaterThan(small.iconBoxSize);
    expect(large.iconBoxSize).toBeGreaterThan(medium.iconBoxSize);
    expect(huge.iconBoxSize).toBeGreaterThan(large.iconBoxSize);

    expect(small.labelFontSize).toBeGreaterThanOrEqual(10);
    expect(medium.labelFontSize).toBeGreaterThan(small.labelFontSize);
    expect(large.labelFontSize).toBeGreaterThan(medium.labelFontSize);
    // The cap may flatten the last step — 3×3 stays "larger but
    // restrained", never poster typography.
    expect(large.labelFontSize).toBeLessThanOrEqual(30);
    expect(huge.labelFontSize).toBeLessThanOrEqual(30);
  });

  it("uses horizontal space efficiently in inline mode", () => {
    const twoByOne = resolve(240, 100);
    const threeByOne = resolve(360, 120);
    expect(twoByOne.iconBoxSize).toBeGreaterThan(60);
    expect(threeByOne.iconBoxSize).toBeGreaterThan(twoByOne.iconBoxSize);
    expect(threeByOne.labelMaxWidth).toBeGreaterThan(twoByOne.labelMaxWidth);
  });

  it("keeps every value finite and usable for degenerate boxes", () => {
    for (const [width, height] of [
      [0, 0],
      [NaN, 100],
      [100, Infinity],
      [8, 8],
    ] as const) {
      const layout = resolveAppContentLayout({
        width,
        height,
        labelVisible: true,
        iconKind: "library",
      });
      expectFiniteNumbers(layout);
      expect(layout.padding).toBeGreaterThan(0);
      expect(layout.iconBoxSize).toBeGreaterThanOrEqual(12);
    }
  });

  it("honors the documented inline aspect threshold", () => {
    const justBelow = resolve(155, 100); // 1.55 exactly at threshold is inline
    const below = resolve(154, 100);
    expect(justBelow.mode).toBe("inline");
    expect(below.mode).toBe("stack");
    expect(INLINE_ASPECT_THRESHOLD).toBeCloseTo(1.55, 2);
  });

  it("derives the layout from the smaller side, not the larger", () => {
    // Same smaller side ⇒ same composition scale, wide vs tall.
    const wide = resolve(240, 100);
    const tall = resolve(100, 240);
    expect(wide.iconBoxSize).toBeGreaterThan(0);
    expect(tall.iconBoxSize).toBeGreaterThan(0);
    expect(wide.mode).toBe("inline");
    expect(tall.mode).toBe("stack");
  });
});

describe("generated-text optical sizing (019-B §7)", () => {
  it("decreases monotonically with code-point count, floored beyond 4", () => {
    const scales = [1, 2, 3, 4, 5, 9].map((count) => generatedIconOpticalScale(count));
    // Strict decrease across the supported 1–4 range…
    for (let index = 1; index <= 4; index += 1) {
      expect(scales[index]!).toBeLessThan(scales[index - 1]!);
    }
    // …and a readable floor for longer custom text (never keeps shrinking).
    expect(scales[4]!).toBe(scales[5]!);
    expect(generatedIconOpticalScale(1)).toBe(1);
  });

  it("sizes generated text from the icon box and stays inside it", () => {
    const box = 240;
    const one = generated(box, box, 1);
    const four = generated(box, box, 4);
    expect(one.generatedTextSize).toBeDefined();
    expect(four.generatedTextSize).toBeDefined();
    expect(one.generatedTextSize!).toBeGreaterThan(four.generatedTextSize!);
    for (const layout of [one, four]) {
      expect(layout.generatedTextSize!).toBeLessThanOrEqual(layout.iconBoxSize);
      expect(layout.generatedTextSize!).toBeGreaterThan(0);
    }
  });

  it("grows generated text with the container", () => {
    const small = generated(80, 80, 2);
    const large = generated(240, 240, 2);
    expect(large.generatedTextSize!).toBeGreaterThan(small.generatedTextSize!);
  });

  it("emits no generated-text size for library and image icons", () => {
    for (const iconKind of ["library", "image"] as const) {
      const layout = resolveAppContentLayout({
        width: 120,
        height: 120,
        labelVisible: true,
        iconKind,
      });
      expect(layout.generatedTextSize).toBeUndefined();
    }
  });
});

describe("presentation var invariance (019-B §19)", () => {
  it("writes only --vd-app-* presentation vars, never geometry", () => {
    const layout = resolve(240, 120);
    const vars = buildAppContentStyleVars(layout);
    const keys = Object.keys(vars);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key.startsWith("--vd-app-"), `var namespace: ${key}`).toBe(true);
    }
    // Geometry keys that must NEVER appear in a presentation var bag.
    for (const forbidden of [
      "width",
      "height",
      "left",
      "top",
      "gridColumn",
      "gridRow",
      "position",
    ]) {
      expect(keys, `no geometry key ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("emits the documented variable set", () => {
    const vars = buildAppContentStyleVars(resolve(120, 120));
    for (const name of [
      "--vd-app-content-padding",
      "--vd-app-content-gap",
      "--vd-app-icon-box",
      "--vd-app-label-size",
      "--vd-app-label-line-height",
      "--vd-app-label-max-width",
    ]) {
      expect(vars[name], name).toMatch(/^-?\d+(\.\d+)?px$/);
    }
  });
});

describe("legacy scale compatibility (019-B §20)", () => {
  const baseApp = {
    kind: "app",
    id: "app-compat",
    name: "Portal",
    url: "https://portal.example",
    icon: { kind: "generated", text: "P", source: "auto" },
    openMode: "new-tab",
    tags: [],
  } as unknown as AppShortcut;

  it("legacy iconScale/labelScale differences resolve to the SAME layout", () => {
    const legacyMin = { ...baseApp, visual: { iconScale: 0.5, labelScale: 0.75, decorationStyle: "gradient" } } as AppShortcut;
    const legacyMax = { ...baseApp, visual: { iconScale: 2, labelScale: 1.75, decorationStyle: "gradient" } } as AppShortcut;
    const modern = { ...baseApp, visual: { decorationStyle: "gradient" } } as AppShortcut;
    const noVisual = baseApp;

    const layouts = [legacyMin, legacyMax, modern, noVisual].map((app) =>
      resolveAppContentLayoutForApp(app, 180, 180),
    );
    for (const layout of layouts) {
      expect(layout).toEqual(layouts[0]);
    }
  });

  it("labelVisible remains the only title preference that matters", () => {
    const shown = resolveAppContentLayoutForApp(baseApp, 120, 120);
    const hidden = resolveAppContentLayoutForApp(
      { ...baseApp, visual: { decorationStyle: "gradient", labelVisible: false } } as AppShortcut,
      120,
      120,
    );
    expect(shown.mode).not.toBe("solo");
    expect(hidden.mode).toBe("solo");
  });

  it("reads the generated text length for generated icons only", () => {
    const oneChar = resolveAppContentLayoutForApp(baseApp, 120, 120);
    const fourChar = resolveAppContentLayoutForApp(
      { ...baseApp, icon: { kind: "generated", text: "ABCD", source: "custom" } } as unknown as AppShortcut,
      120,
      120,
    );
    expect(oneChar.generatedTextSize!).toBeGreaterThan(fourChar.generatedTextSize!);
  });
});
