/**
 * The ONE initial an icon without a real image shows: the first
 * user-visible character (grapheme cluster) of the text — the app/folder
 * name, or the user's custom icon text. The full name is always shown next
 * to the tile, so one clear character is enough.
 *
 * - 中文 → 首字（「微信」→「微」）; Latin → first letter uppercased
 *   (React → R); emoji → the whole first emoji (ZWJ sequences, flags and
 *   skin tones stay intact); digits → the first digit.
 * - Leading punctuation/whitespace is skipped (「《三体》」→「三」), unless
 *   the text has nothing else.
 * - Uppercasing never turns one character into two (ß stays ß).
 */
const segmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;

/** Splits text into user-visible characters (grapheme clusters). */
export function graphemes(text: string): string[] {
  return segmenter === undefined
    ? Array.from(text)
    : Array.from(segmenter.segment(text), (part) => part.segment);
}

const SKIPPED_LEADING = /^[\p{P}\p{Z}\p{Cc}\p{Cf}]+$/u;

export function iconInitial(text: string): string {
  const parts = graphemes(text.trim());
  const first = parts.find((part) => !SKIPPED_LEADING.test(part)) ?? parts[0] ?? "";
  const upper = first.toUpperCase();
  return graphemes(upper).length === 1 ? upper : first;
}

/** Generated icon text for an app/folder name: its single initial. */
export function generatedIconText(name: string): string {
  return iconInitial(name);
}

/**
 * Custom icon text may hold SEVERAL user-visible characters (task 028):
 * up to twelve grapheme clusters — 中文 / 字母 / 数字 / emoji each count
 * as one, so a multi-code-point emoji (ZWJ families, flags, skin tones)
 * is still exactly one character. The AUTO mode keeps deriving the single
 * initial; this bound only governs what a user may type and what a tile
 * renders from custom text. Legacy stored text longer than the bound is
 * cut at render time — no migration, ever.
 */
export const APP_ICON_TEXT_MAX_GRAPHEMES = 12;

/** The first `max` grapheme clusters of `text` (the render/input clamp). */
export function clampGraphemes(text: string, max: number = APP_ICON_TEXT_MAX_GRAPHEMES): string {
  return graphemes(text.trim()).slice(0, max).join("");
}

/** How the tile shrinks a multi-character icon text to fit its box. */
export type IconTextFit = "single" | "short" | "medium" | "long";

/**
 * The fit bucket of an icon text: 1 grapheme renders at the full optical
 * size, 2–4 shrink moderately, 5–8 further, 9–12 the most. Pure — the CSS
 * tiers (`[data-text-fit]`) and the adaptive resolver share the buckets.
 */
export function iconTextFit(text: string): IconTextFit {
  const count = graphemes(text).length;
  if (count <= 1) {
    return "single";
  }
  if (count <= 4) {
    return "short";
  }
  if (count <= 8) {
    return "medium";
  }
  return "long";
}
