import type { CSSProperties } from "react";

import { iconTextFitScale } from "./generated-icon";

/**
 * The ONE text glyph of an app icon tile (generated initials, custom icon
 * text, or the initials fallback of a failed library/uploaded icon).
 * Centering is owned by the tile (`.vela-app-icon` / `.vela-item__icon` /
 * `.vela-app-content__icon` are all grid + place-items:center); this span
 * only carries the width-fit multiplier so 3–4 wide characters shrink
 * instead of wrapping or spilling out of a fixed-slot tile. The adaptive
 * desktop tile ignores the multiplier — its resolver size already caps
 * the width (`generatedTextEmWidth`).
 */
export function IconText({ text }: { readonly text: string }) {
  const fit = iconTextFitScale(text);
  return (
    <span
      className="vela-app-icon__text"
      style={fit === 1 ? undefined : ({ "--vd-icon-text-fit": String(fit) } as CSSProperties)}
    >
      {text}
    </span>
  );
}
