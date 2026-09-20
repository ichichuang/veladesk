import { isIconCollectionId, renderIconSvg, searchIconCatalog } from "@veladesk/icon-catalog";

import { errorResponse, jsonResponse } from "./response";

/**
 * HTTP handlers for the self-hosted icon catalog (task 016-A).
 *
 * Handlers stay pure request/response adapters — query decoding and issue
 * mapping live here, icon data comes exclusively from the bundled
 * `@iconify-json/*` collections via `@veladesk/icon-catalog`. No remote
 * icon source exists on this code path at all.
 */

/** GET /api/v1/icons/search */
export async function handleIconSearch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const outcome = await searchIconCatalog({
    q: url.searchParams.get("q") ?? undefined,
    collection: url.searchParams.get("collection") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!outcome.ok) {
    return errorResponse(400, outcome.issue);
  }
  return jsonResponse({ icons: outcome.icons });
}

/**
 * GET /api/v1/icons/:collection/:name.svg
 *
 * `name` arrives as the raw dynamic segment, optionally carrying the
 * `.svg` suffix; both `terminal.svg` and `terminal` resolve to the same
 * icon. Unknown collections, malformed names and unknown icons are all a
 * plain 404 — the route never treats path data as a file path.
 */
export async function handleIconSvg(
  collectionSegment: string,
  nameSegment: string
): Promise<Response> {
  if (!isIconCollectionId(collectionSegment)) {
    return iconNotFound();
  }
  const name = decodeIconName(nameSegment);
  if (name === undefined) {
    return iconNotFound();
  }
  const svg = await renderIconSvg(collectionSegment, name);
  if (svg === undefined) {
    return iconNotFound();
  }
  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // Icon content is pinned by the package lock: a VelaDesk upgrade
      // changes asset versions anyway, so the cache can be forever.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

function iconNotFound(): Response {
  return errorResponse(404, "icon-not-found");
}

const ICON_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SVG_SUFFIX = /\.svg$/;

/** Strips the optional `.svg` suffix and validates the remaining name. */
function decodeIconName(segment: string): string | undefined {
  const name = segment.replace(SVG_SUFFIX, "");
  if (name.length === 0 || !ICON_NAME_PATTERN.test(name)) {
    return undefined;
  }
  return name;
}
