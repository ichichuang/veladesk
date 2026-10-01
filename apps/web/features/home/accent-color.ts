/**
 * Accent color helpers (task 019-D).
 *
 * The accent is persisted as an OKLCH hue degree (0–359) that feeds
 * `--vd-accent-hue`. The Settings UI offers curated swatches first; the
 * custom picker path lets the user pick an RGB color and converts it to
 * the hue component — the accent token keeps its saturation/lightness
 * policy, only the hue is user-chosen.
 */

/** Curated swatch hues, sorted by angle (display order). */
export const ACCENT_SWATCH_HUES: readonly number[] = [25, 145, 195, 205, 245, 262, 300, 340];

/**
 * Extracts the hue degree (0–359) of a `#rgb`/`#rrggbb` hex color.
 * Returns undefined for anything unparsable — callers keep the previous
 * hue instead of inventing a value. Pure.
 */
export function hueFromHex(hex: string): number | undefined {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (match === null) {
    return undefined;
  }
  let digits = hex.slice(1);
  if (digits.length === 3) {
    digits = [...digits].map((c) => c + c).join("");
  }
  const r = parseInt(digits.slice(0, 2), 16) / 255;
  const g = parseInt(digits.slice(2, 4), 16) / 255;
  const b = parseInt(digits.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) {
    // Achromatic: hue is undefined; keep a stable canonical red.
    return 0;
  }
  let hue: number;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }
  const degrees = hue * 60;
  return Math.round(degrees < 0 ? degrees + 360 : degrees) % 360;
}

/**
 * A representative hex color for a hue degree — a saturated mid tone, used
 * to seed the custom picker with the currently selected accent. Inverse of
 * {@link hueFromHex} for round-tripping: `hueFromHex(hexFromHue(h))` stays
 * on the same hue. Pure.
 */
export function hexFromHue(hue: number): string {
  const h = ((Math.round(hue) % 360) + 360) % 360;
  // HSL → RGB at s=0.9, l=0.55.
  const s = 0.9;
  const l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}
