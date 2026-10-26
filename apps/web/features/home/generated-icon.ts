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

function graphemes(text: string): string[] {
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
