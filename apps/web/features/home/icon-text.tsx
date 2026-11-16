import { clampGraphemes, iconTextFit } from "./generated-icon";

/**
 * The text glyph of an app icon tile (generated initial, custom icon text,
 * or the initial fallback of a failed library/uploaded icon).
 *
 * task 028: CUSTOM icon text may hold up to
 * {@link APP_ICON_TEXT_MAX_GRAPHEMES} user-visible characters and renders
 * verbatim (clamped); AUTO-derived text is always one initial (callers
 * pass `generatedIconText(name)` / `iconInitial`). Callers may pass a
 * whole name or a legacy multi-character custom text — everything is
 * clamped here, so the tile and the input always agree. The span carries
 * `data-text-fit` so the CSS tiers shrink multi-character text inside the
 * tile; centering is owned by the tile (`.vela-app-icon` /
 * `.vela-item__icon` / `.vela-app-content__icon` are grid +
 * place-items:center).
 */
export function IconText({ text }: { readonly text: string }) {
  const shown = clampGraphemes(text);
  return (
    <span className="vela-app-icon__text" data-text-fit={iconTextFit(shown)}>
      {shown}
    </span>
  );
}

/**
 * What the icon-text INPUT keeps: at most {@link APP_ICON_TEXT_MAX_GRAPHEMES}
 * grapheme clusters — exactly what the tile renders. Pasting "微信文档助手之家"
 * into the field keeps its first twelve characters, pasting "👨‍👩‍👧" keeps the
 * whole family emoji (one grapheme, not three code points). Legacy stored
 * text longer than the bound also collapses when the editor re-reads it.
 */
export function clampIconText(text: string): string {
  return clampGraphemes(text);
}
