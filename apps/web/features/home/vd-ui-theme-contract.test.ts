/*
 * Task 021-R1 Part A — the canonical theme-boundary token contract.
 *
 * Two layers of pure coverage:
 *
 * 1. Source contract: `vd-ui.css` must bridge EVERY semantic variable the
 *    installed @heroui/styles components consume (Select/ListBox, Button,
 *    ToggleButton, Slider, Switch, Input) on the `[data-vd-ui]` boundary,
 *    including the derived field-border mixes and the scrollbar aliases.
 *    An unbridged alias silently inherits the library's light-theme
 *    `:root` layer-base value regardless of the resolved mode — the same
 *    producer-to-consumer break that left the Select popup unreadable.
 *    The consumed-alias list below was extracted from the installed
 *    `@heroui/styles@3.2.6` component CSS (see the task report).
 *
 * 2. Color pairs: the DECLARED oklch pairs are evaluated numerically —
 *    oklch → sRGB (chroma-clamped as the css-color-4 gamut-mapping
 *    approximation), CSS alpha compositing of the popup surface over a
 *    worst-case backdrop, then the WCAG 2.x contrast ratio. jsdom cannot
 *    compute browser colors, so this is where the 4.5:1 target is
 *    actually checked — for normal option labels on the popup surface and
 *    for primary-button text against EVERY supported accent hue (the
 *    accent hue is user-choosable across the full 0–359° wheel).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import { ACCENT_SWATCH_HUES } from "./accent-color";
import {
  resolveEffectiveColorMode,
} from "./appearance-theme";

const CSS_PATH = fileURLToPath(new URL("../../app/vd-ui.css", import.meta.url));
const css = readFileSync(CSS_PATH, "utf8");

/** The body of a top-level CSS block whose selector list contains `needle`. */
function blockFor(needle: string): string {
  const selectorStart = css.indexOf(needle);
  expect(selectorStart, `vd-ui.css must contain a block matching ${needle}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", selectorStart);
  let depth = 1;
  let i = open + 1;
  while (depth > 0 && i < css.length) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
    i += 1;
  }
  return css.slice(open + 1, i - 1);
}

const baseBlock = blockFor("[data-vd-ui] {");
const lightBlock = blockFor('[data-vd-ui][data-vd-color-mode="light"]');

/** Extracts the raw value of `--name` (or plain `name`) from a block body. */
function declaredVar(block: string, name: string): string {
  const match =
    new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(block) ??
    new RegExp(`(?:^|[\\s;])${name}\\s*:\\s*([^;]+);`).exec(block);
  expect(match, `--${name} must be declared in the block`).not.toBeNull();
  return match![1]!.trim();
}

// --- 1. The bridge covers everything the installed components consume -----

/**
 * Every semantic `--var` the installed @heroui/styles@3.2.6 CSS reads for
 * the components this product uses (verified against the installed source;
 * component-local aliases such as `--button-*` or `--select-trigger-bg`
 * are defined by the library itself from these semantic values and resolve
 * at the component element).
 */
const CONSUMED_HEROUI_ALIASES: readonly string[] = [
  // Surfaces + text
  "background",
  "background-secondary",
  "foreground",
  "surface",
  "surface-foreground",
  "surface-hover",
  "surface-secondary",
  "surface-secondary-foreground",
  "surface-tertiary",
  "surface-tertiary-foreground",
  "overlay",
  "overlay-foreground",
  "muted",
  // Fills
  "default",
  "default-foreground",
  "default-hover",
  // Accent
  "accent",
  "accent-hover",
  "accent-foreground",
  "accent-soft",
  "accent-soft-hover",
  "accent-soft-foreground",
  // Danger
  "danger",
  "danger-hover",
  "danger-foreground",
  "danger-soft",
  "danger-soft-foreground",
  // Segments (ToggleButtonGroup)
  "segment",
  "segment-foreground",
  // Lines
  "border",
  "border-secondary",
  "border-tertiary",
  "separator",
  "separator-secondary",
  "separator-tertiary",
  // Focus + links
  "focus",
  "link",
  // Fields (Select trigger, inputs)
  "field-background",
  "field-foreground",
  "field-placeholder",
  "field-border",
  "field-border-hover",
  "field-border-focus",
  "field-hover",
  "field-focus",
  "field-radius",
  // Geometry + shadows
  "radius",
  "overlay-shadow",
  "surface-shadow",
  "field-shadow",
  // Scrollbar (the Select listbox scroller)
  "scrollbar-width",
  "scrollbar-gutter",
  "scrollbar-track",
  "scrollbar-thumb",
  "scrollbar-color",
];

describe("vd-ui theme boundary contract (021-R1)", () => {
  it("bridges every semantic variable the installed HeroUI components consume", () => {
    for (const alias of CONSUMED_HEROUI_ALIASES) {
      expect(declaredVar(baseBlock, alias), `--${alias} bridged on [data-vd-ui]`).toBeTruthy();
    }
  });

  it("keeps the popup surface and its foreground a paired, sufficiently opaque pair", () => {
    // The popup surface (--overlay) must be its own floored token, not the
    // raw translucent window: option text stays readable over any wallpaper
    // or busy window content. --overlay is declared ONCE at the boundary;
    // the mode blocks only re-declare the underlying --vdu-* palette it
    // derives from.
    expect(declaredVar(baseBlock, "overlay")).toBe("var(--vdu-overlay)");
    expect(declaredVar(baseBlock, "vdu-overlay")).toMatch(/clamp\(0\.96\b/);
    expect(declaredVar(lightBlock, "vdu-overlay")).toMatch(/clamp\(0\.96\b/);
    // Paired foreground: the overlay foreground rides the same boundary.
    expect(declaredVar(baseBlock, "overlay-foreground")).toBe("var(--vdu-fg)");
  });

  it("declares color-scheme for both effective modes", () => {
    expect(declaredVar(baseBlock, "color-scheme")).toBe("dark");
    expect(declaredVar(lightBlock, "color-scheme")).toBe("light");
  });
});

// --- 2. Numeric evaluation of the declared color pairs ---------------------

/** oklch → linear-light sRGB (css-color-4 matrices). */
function oklchToLinearSrgb(l: number, c: number, hueDeg: number): [number, number, number] {
  const h = (hueDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

function inGamut(rgb: readonly number[]): boolean {
  return rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
}

/**
 * oklch → linear sRGB, clamped into the sRGB gamut by scaling chroma down
 * at constant lightness/hue — the css-color-4 gamut-mapping approximation
 * browsers apply to out-of-gamut oklch values.
 */
function oklchToClampedLinearSrgb(l: number, c: number, hueDeg: number): [number, number, number] {
  if (inGamut(oklchToLinearSrgb(l, c, hueDeg))) {
    const [r, g, b] = oklchToLinearSrgb(l, c, hueDeg);
    return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b))];
  }
  let lo = 0;
  let hi = c;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinearSrgb(l, mid, hueDeg))) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const [r, g, b] = oklchToLinearSrgb(l, lo, hueDeg);
  return [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
}

/** WCAG 2.x relative luminance from LINEAR sRGB. */
function luminance(linear: readonly number[]): number {
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

/**
 * Parses an `oklch(L C H / alpha)` declaration. `H` may be
 * `var(--vd-accent-hue, fallback)` — the caller supplies the actual hue.
 */
function parseOklch(raw: string, accentHue: number): {
  l: number;
  c: number;
  h: number;
  alpha: number;
} {
  const body = raw.slice(raw.indexOf("oklch(") + 6, raw.lastIndexOf(")"));
  const [main, alphaPart] = body.split("/");
  const parts = main!.trim().split(/\s+/);
  const l = Number.parseFloat(parts[0]!);
  const c = Number.parseFloat(parts[1]!);
  const hueRaw = parts[2]!.trim();
  const fallback = /var\(--vd-accent-hue,\s*(\d+)\)/.exec(hueRaw);
  const h = accentHue ?? (fallback ? Number.parseFloat(fallback[1]!) : Number.parseFloat(hueRaw));
  return { l, c, h, alpha: alphaPart ? Number.parseFloat(alphaPart.trim()) : 1 };
}

/** L (lightness) of a declared oklch var. */
function lightnessOf(block: string, name: string, accentHue = 205): number {
  return parseOklch(declaredVar(block, name), accentHue).l;
}

/**
 * Composites the declared overlay color at its WORST legal alpha (the
 * 0.9 floor of the clamp) over an extreme backdrop, gamma-encoded sRGB
 * component interpolation as CSS does it.
 */
function compositedOverlayLuminance(block: string, accentHue: number, backdrop: 0 | 1): number {
  const raw = declaredVar(block, "vdu-overlay");
  const parsed = parseOklch(raw, accentHue);
  const floor = 0.96; // the clamp() lower bound the source must declare
  const linear = oklchToClampedLinearSrgb(parsed.l, parsed.c, parsed.h);
  // gamma-encode, composite, back to linear for luminance
  const toSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const channels = linear.map((v) => {
    const srgb = toSrgb(v);
    const composited = srgb * floor + backdrop * (1 - floor);
    return toLinear(composited);
  });
  return luminance(channels);
}

function contrast(l1: number, l2: number): number {
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

describe("declared popup color pairs (021-R1)", () => {
  it("gives normal option labels ≥ 4.5:1 on the popup surface in dark mode", () => {
    const fg = lightnessOf(baseBlock, "vdu-fg");
    const fgLinear = oklchToClampedLinearSrgb(fg, 0.01, 260);
    // Worst case: the translucent floor composited over a pure white wallpaper.
    const surface = compositedOverlayLuminance(baseBlock, 205, 1);
    expect(contrast(luminance(fgLinear), surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("gives normal option labels ≥ 4.5:1 on the popup surface in light mode", () => {
    const fg = lightnessOf(lightBlock, "vdu-fg");
    const fgLinear = oklchToClampedLinearSrgb(fg, 0.02, 264);
    // Worst case: composited over a pure black backdrop.
    const surface = compositedOverlayLuminance(lightBlock, 205, 0);
    expect(contrast(luminance(fgLinear), surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("gives primary-button text ≥ 4.5:1 against EVERY supported accent hue (dark)", () => {
    const fgL = lightnessOf(baseBlock, "vdu-accent-fg");
    const fgLinear = oklchToClampedLinearSrgb(fgL, 0.02, 264);
    const fgLum = luminance(fgLinear);
    const accentRaw = declaredVar(baseBlock, "vdu-accent");
    const parsed = parseOklch(accentRaw, 205);
    const worst = Math.min(
      ...Array.from({ length: 360 }, (_, hue) =>
        contrast(fgLum, luminance(oklchToClampedLinearSrgb(parsed.l, parsed.c, hue))),
      ),
    );
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });

  it("gives primary-button text ≥ 4.5:1 against EVERY supported accent hue (light)", () => {
    const fgL = lightnessOf(lightBlock, "vdu-accent-fg");
    const fgLinear = oklchToClampedLinearSrgb(fgL, 0.005, 264);
    const fgLum = luminance(fgLinear);
    const accentRaw = declaredVar(lightBlock, "vdu-accent");
    const parsed = parseOklch(accentRaw, 205);
    const worst = Math.min(
      ...Array.from({ length: 360 }, (_, hue) =>
        contrast(fgLum, luminance(oklchToClampedLinearSrgb(parsed.l, parsed.c, hue))),
      ),
    );
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });

  it("covers the curated accent swatches exactly (hue set unchanged)", () => {
    // The swatch picker offers these hues; the full-wheel checks above
    // subsume them, but a regression on the curated set must stay visible.
    expect(ACCENT_SWATCH_HUES).toEqual([25, 145, 195, 205, 245, 262, 300, 340]);
  });
});

describe("resolveEffectiveColorMode (021-R1)", () => {
  it("resolves the system choice against the OS preference", () => {
    expect(resolveEffectiveColorMode("system", false)).toBe("dark");
    expect(resolveEffectiveColorMode("system", true)).toBe("light");
  });

  it("lets the explicit choices pass through untouched", () => {
    expect(resolveEffectiveColorMode("dark", true)).toBe("dark");
    expect(resolveEffectiveColorMode("light", false)).toBe("light");
  });
});
