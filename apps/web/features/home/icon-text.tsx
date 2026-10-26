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
