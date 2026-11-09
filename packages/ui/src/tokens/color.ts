/**
 * Semantic color token constants — the Dawn Chart palette (direction A,
 * P1). The typed JS mirror of the `--vd-color-*` declarations in
 * `packages/ui/src/tokens.css`; the CSS file is what paints, this module is
 * what JS consumers (canvas paint, contrast tooling, export/bridge code)
 * read. The two are kept identical by the vd-ui-theme-contract test reading
 * the stylesheet and by review — values here are the raw declarations,
 * never re-derived.
 *
 * Values are OKLCH component triples (`[L, C, H]`) so consumers can compose
 * (e.g. re-hue the accent) without string parsing. Decorative alphas stay
 * in the CSS declarations and are not mirrored — EXCEPT the material-tier
 * surface alphas, which tier overrides flip and which tooling therefore
 * needs (VD_SURFACE_ALPHA).
 *
 * The accent hue stays runtime-variable (`--vd-accent-hue`); entries below
 * carry the Dawn apricot fallback hue 60. The light-mode accent keeps the
 * contract-safe L/C pair (0.53/0.15): the designer draft's 0.64/0.16 drops
 * the every-hue ≥ 4.5:1 accent-fg guarantee to 4.4:1, and the draft's own
 * contrast rule (次要文字 ≥ 4.5:1) wins that conflict.
 */

/** `[lightness, chroma, hue]` of one OKLCH declaration. */
export type VdOklch = readonly [number, number, number];

/** Dark-mode (default) semantic palette. */
export const VD_COLOR_DARK = {
  /** Scene bottom layer — the deep-sea ink behind everything. */
  bgDeep: [0.16, 0.03, 255],
  /** Glass tiles / panels (alpha via VD_SURFACE_ALPHA). */
  bgSurface: [0.22, 0.03, 255],
  /** Menus / dialogs (alpha via VD_SURFACE_ALPHA.raised). */
  bgRaised: [0.27, 0.03, 255],
  /** Opaque control wells: base, raised, hover, active. */
  bgWell: [0.24, 0.03, 255],
  bgWellRaised: [0.28, 0.03, 255],
  bgWellHover: [0.32, 0.03, 255],
  bgWellActive: [0.36, 0.03, 255],
  fgPrimary: [0.96, 0.01, 250],
  fgMuted: [0.74, 0.02, 250],
  fgDisabled: [0.55, 0.015, 250],
  /** 1px hairline separators (α 0.10 in CSS). */
  borderHairline: [1, 0, 0],
  /** Glass inner stroke (α 0.18 in CSS). */
  borderHighlight: [1, 0, 0],
  /** Strong control borders (α 0.30 in CSS). */
  borderStrong: [1, 0, 0],
  accent: [0.78, 0.14, 60],
  accentHover: [0.83, 0.14, 60],
  accentFg: [0.20, 0.04, 50],
  /** Wash base (α 0.16 in CSS). */
  accentWash: [0.78, 0.13, 60],
  /** Horizon gradient stops: apricot → rose → cold blue. */
  dawn1: [0.80, 0.13, 65],
  dawn2: [0.70, 0.14, 15],
  dawn3: [0.55, 0.10, 250],
  focus: [0.82, 0.12, 220],
  danger: [0.68, 0.19, 25],
  dangerHover: [0.73, 0.19, 25],
  dangerFg: [0.99, 0.005, 25],
} as const satisfies Readonly<Record<string, VdOklch>>;

/**
 * Light-mode palette (`[data-vd-color-mode="light"]`) — "白昼海图": mist
 * white ground, pale-gold horizon, solid surfaces with light shadows.
 * Dawn stops keep their hues at +8% lightness.
 */
export const VD_COLOR_LIGHT = {
  bgDeep: [0.97, 0.01, 250],
  bgSurface: [1, 0, 0],
  bgRaised: [1, 0, 0],
  bgWell: [0.955, 0.008, 250],
  bgWellRaised: [0.92, 0.01, 250],
  bgWellHover: [0.895, 0.012, 250],
  bgWellActive: [0.87, 0.014, 250],
  fgPrimary: [0.22, 0.03, 255],
  fgMuted: [0.46, 0.02, 255],
  fgDisabled: [0.64, 0.012, 250],
  borderHairline: [0.22, 0.03, 255],
  borderHighlight: [1, 0, 0],
  borderStrong: [0.22, 0.03, 255],
  /** L/C kept at the every-hue 4.5:1 contract (see module header). */
  accent: [0.53, 0.15, 60],
  accentHover: [0.48, 0.15, 60],
  accentFg: [0.99, 0.005, 250],
  accentWash: [0.53, 0.14, 60],
  dawn1: [0.88, 0.13, 65],
  dawn2: [0.78, 0.14, 15],
  dawn3: [0.63, 0.10, 250],
  focus: [0.55, 0.15, 240],
  danger: [0.55, 0.2, 25],
  dangerHover: [0.5, 0.2, 25],
  dangerFg: [0.99, 0.005, 25],
} as const satisfies Readonly<Record<string, VdOklch>>;

/**
 * Material-tier surface alphas per mode (the `--vd-alpha-*` channel
 * variables). Mirrored because the 清爽/柔和 tiers override them and
 * tooling needs the effective value; every other alpha is CSS-only.
 */
export const VD_SURFACE_ALPHA = {
  dark: { surface: 0.62, raised: 0.78 },
  light: { surface: 0.78, raised: 0.92 },
} as const;

/** The Dawn apricot hue baked into every accent fallback (60°). */
export const VD_ACCENT_HUE_FALLBACK = 60;
