import { getIconData } from "@iconify/utils";
import type { IconifyIcon } from "@iconify/utils";

import type { IconCollectionId, IconSet } from "./types";

/**
 * The bundled collection loaders.
 *
 * Every icon set comes from an `@iconify-json/*` package in `node_modules`
 * and ships with the VelaDesk server — the Iconify public API, CDNs and any
 * other remote icon source are never contacted at runtime. Collection
 * metadata (ids, labels, order, category, palette) lives in the
 * browser-safe `meta.ts`; this module only maps an id to its JSON loader.
 */

export {
  ICON_COLLECTIONS,
  findIconCollection,
  isIconCollectionId,
} from "./meta";
export type { IconCollectionInfo } from "./meta";

/**
 * Bundler-friendly lazy loaders: one static string per collection so both
 * webpack/turbopack and Vitest can analyze the chunk boundaries, while the
 * multi-megabyte JSON bodies stay out of every route that does not need
 * them (a collection is parsed only when a search or browse touches it).
 */
const ICON_SET_LOADERS: Record<IconCollectionId, () => Promise<{ default: IconSet }>> = {
  "simple-icons": () => import("@iconify-json/simple-icons/icons.json"),
  lucide: () => import("@iconify-json/lucide/icons.json"),
  tabler: () => import("@iconify-json/tabler/icons.json"),
  ph: () => import("@iconify-json/ph/icons.json"),
  "fluent-color": () => import("@iconify-json/fluent-color/icons.json"),
  devicon: () => import("@iconify-json/devicon/icons.json"),
  "vscode-icons": () => import("@iconify-json/vscode-icons/icons.json"),
  catppuccin: () => import("@iconify-json/catppuccin/icons.json"),
  noto: () => import("@iconify-json/noto/icons.json"),
};

/**
 * Lazy singleton per collection: the parsed JSON and any derived search
 * index are built at most once per process and reused for every request.
 * The promise is cached (not just the value) so concurrent first requests
 * share one load instead of racing.
 */
const ICON_SET_CACHE = new Map<IconCollectionId, Promise<IconSet>>();

export function loadIconSet(collection: IconCollectionId): Promise<IconSet> {
  let cached = ICON_SET_CACHE.get(collection);
  if (cached === undefined) {
    cached = ICON_SET_LOADERS[collection]().then((module) => module.default);
    ICON_SET_CACHE.set(collection, cached);
  }
  return cached;
}

/**
 * Resolves one icon (including aliases) inside a bundled collection, or
 * undefined when the name is unknown. This is the only place the catalog
 * hands its structural `IconSet` to `@iconify/utils`.
 */
export async function resolveIcon(
  collection: IconCollectionId,
  name: string
): Promise<IconifyIcon | undefined> {
  const set = await loadIconSet(collection);
  const icon = getIconData(set as Parameters<typeof getIconData>[0], name);
  return icon ?? undefined;
}
