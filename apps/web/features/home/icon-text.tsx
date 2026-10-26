import { iconInitial } from "./generated-icon";

/**
 * The ONE text glyph of an app icon tile (generated initial, custom icon
 * text, or the initial fallback of a failed library/uploaded icon). It
 * always renders a single character — callers may pass a whole name or a
 * legacy multi-character custom text. Centering is owned by the tile
 * (`.vela-app-icon` / `.vela-item__icon` / `.vela-app-content__icon` are
 * all grid + place-items:center).
 */
export function IconText({ text }: { readonly text: string }) {
  return <span className="vela-app-icon__text">{iconInitial(text)}</span>;
}

/**
 * What the icon-text INPUT keeps: at most ONE grapheme cluster — exactly
 * the single glyph the tile renders. Pasting "微信" into the field leaves
 * "微", pasting "👨‍👩‍👧" keeps the whole family emoji (one grapheme, not
 * three code points). Legacy stored text with several characters also
 * collapses to its first glyph when the editor re-reads it.
 */
export function clampIconText(text: string): string {
  return iconInitial(text);
}
