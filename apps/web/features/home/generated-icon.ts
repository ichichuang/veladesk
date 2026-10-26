/**
 * Generated icon text for an app name: the first one to two code points of
 * the trimmed name, uppercased where the script supports it. No grapheme
 * segmentation library on purpose — two JS code points is the v1 budget.
 */
export function generatedIconText(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "";
  }
  return Array.from(trimmed)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/*
 * Icon-text width model (fix/icon-text-center). Icon text is up to four
 * code points of ANY script (custom text), but the tiles were sized by
 * code-point count alone: a CJK ideograph or emoji advances a full em while
 * a Latin capital advances ~0.6–0.7em, so 3–4 wide characters wrapped onto
 * a second line or spilled out of the fixed-slot tiles. The model below is
 * deliberately conservative (Latin/other = 0.72em, i.e. wider than typical
 * caps) so the estimate errs towards fitting.
 */
const WIDE_CODE_POINT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\p{Extended_Pictographic}\u2E80-\u303F\u3200-\u33FF\uFE30-\uFE4F\uFF01-\uFF60\uFFE0-\uFFE6]/u;
const ZERO_WIDTH_CODE_POINT = /[\p{M}\u200B-\u200D\uFE00-\uFE0F]/u;
const NARROW_EM = 0.72;

/** Estimated advance width of icon text, in em of its font size. */
export function iconTextEmWidth(text: string): number {
  let width = 0;
  for (const codePoint of Array.from(text.trim())) {
    if (ZERO_WIDTH_CODE_POINT.test(codePoint)) {
      continue;
    }
    width += WIDE_CODE_POINT.test(codePoint) ? 1 : NARROW_EM;
  }
  return width;
}

/**
 * Width budget of text in a FIXED-SLOT tile (dock, folder overlay, mobile
 * grid/dock, launcher and mobile search rows), in em of the tile's base
 * text size: two ideographs (the widest generated initials) plus a hair,
 * so every 1–2 character text keeps its existing size.
 */
export const FIXED_SLOT_ICON_TEXT_BUDGET_EM = 2.1;

/**
 * Font-size multiplier that fits icon text into the fixed-slot budget:
 * 1 when it already fits, otherwise the shrink that makes it fit.
 */
export function iconTextFitScale(text: string, budgetEm: number = FIXED_SLOT_ICON_TEXT_BUDGET_EM): number {
  const width = iconTextEmWidth(text);
  if (!(width > budgetEm)) {
    return 1;
  }
  return Math.round((budgetEm / width) * 1000) / 1000;
}
