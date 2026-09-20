import { iconToHTML, iconToSVG, replaceIDs } from "@iconify/utils";

import { resolveIcon } from "./collections";
import type { IconCollectionId } from "./types";

/**
 * Local SVG rendering for bundled icons.
 *
 * SVG markup is generated in-process from the bundled IconifyJSON data via
 * `@iconify/utils` — never from user strings, never with `innerHTML`
 * assembly, and never from a remote source. Bodies come exclusively from
 * the pinned `@iconify-json/*` packages, so the output is trusted and the
 * endpoint can serve it as immutable public cache.
 *
 * Monochrome model: every bundled body draws with `currentColor`, so the
 * renderer controls all coloring through CSS.
 */

/**
 * Renders one bundled icon as a standalone SVG document, or undefined when
 * the name does not resolve in the collection (including aliases).
 * Deterministic for all icons without internal ids; the handful with ids
 * get counter-suffixed ids via `replaceIDs`, which is collision-free but
 * order-dependent — semantically identical output either way.
 */
export async function renderIconSvg(
  collection: IconCollectionId,
  name: string
): Promise<string | undefined> {
  const icon = await resolveIcon(collection, name);
  if (icon === undefined) {
    return undefined;
  }
  const rendered = iconToSVG(icon);
  return iconToHTML(replaceIDs(rendered.body), rendered.attributes);
}
