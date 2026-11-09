/**
 * Color token constants (P1-ENG-1) — the typed JS mirror of the `--vdu-*`
 * palette declared in `packages/ui/src/tokens.css`. The CSS file is what
 * paints; this module is what JS consumers (canvas paint, contrast tooling,
 * future export/bridge code) read. The two are kept identical by the
 * vd-ui-theme-contract test reading the stylesheet and by review — values
 * here are the raw declarations, never re-derived.
 *
 * Values are OKLCH component triples (`[L, C, H]`) so consumers can compose
 * (e.g. re-hue the accent) without string parsing; alpha stays in the CSS
 * declarations and is not mirrored. The accent hue is runtime-variable
 * (`--vd-accent-hue`); the entries below carry the 205 fallback hue.
 */

/** `[lightness, chroma, hue]` of one OKLCH declaration. */
export type VdOklch = readonly [number, number, number];

/** Dark-mode (default) surface, text, line and state colors. */
export const VD_COLOR_DARK = {
  bg: [0.215, 0.015, 264],
  bgRaised: [0.255, 0.015, 264],
  bgHover: [0.295, 0.016, 264],
  bgActive: [0.325, 0.016, 264],
  fg: [0.95, 0.01, 260],
  fgMuted: [0.72, 0.02, 264],
  fgDisabled: [0.55, 0.012, 264],
  border: [0.9, 0.02, 264],
  borderStrong: [0.9, 0.02, 264],
  accent: [0.78, 0.12, 205],
  accentHover: [0.83, 0.12, 205],
  accentFg: [0.17, 0.02, 264],
  focus: [0.85, 0.1, 205],
  danger: [0.64, 0.19, 25],
  dangerHover: [0.69, 0.19, 25],
  dangerFg: [0.99, 0.005, 25],
} as const satisfies Readonly<Record<string, VdOklch>>;

/** Light-mode palette (`[data-vd-color-mode="light"]`). */
export const VD_COLOR_LIGHT = {
  bg: [0.985, 0.004, 264],
  bgRaised: [0.955, 0.006, 264],
  bgHover: [0.925, 0.008, 264],
  bgActive: [0.895, 0.01, 264],
  fg: [0.24, 0.02, 264],
  fgMuted: [0.38, 0.02, 264],
  fgDisabled: [0.62, 0.012, 264],
  border: [0.35, 0.02, 264],
  borderStrong: [0.35, 0.02, 264],
  /** Lightness 0.53 keeps ≥ 4.5:1 against accent-fg for EVERY hue (021-R1). */
  accent: [0.53, 0.15, 205],
  accentHover: [0.48, 0.15, 205],
  accentFg: [0.99, 0.005, 264],
  focus: [0.5, 0.14, 205],
} as const satisfies Readonly<Record<string, VdOklch>>;

/** The accent-hue fallback baked into every accent declaration. */
export const VD_ACCENT_HUE_FALLBACK = 205;
