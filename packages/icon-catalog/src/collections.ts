import { getIconData } from "@iconify/utils";
import type { IconifyIcon } from "@iconify/utils";

import type { IconCollectionId, IconSet } from "./types";

/**
 * The four bundled collections.
 *
 * Every icon set comes from an `@iconify-json/*` package in `node_modules`
 * and ships with the VelaDesk server — the Iconify public API, CDNs and any
 * other remote icon source are never contacted at runtime.
 *
 * Display order puts brands first (`simple-icons`), because most VelaDesk
 * shortcuts are website links; general-purpose sets follow alphabetically.
 */
export interface IconCollectionInfo {
  readonly id: IconCollectionId;
  /** English display name (the web layer localizes further if wanted). */
  readonly label: string;
  /** Stable display order across the whole catalog. */
  readonly order: number;
}

export const ICON_COLLECTIONS: readonly IconCollectionInfo[] = [
  { id: "simple-icons", label: "Brands", order: 0 },
  { id: "lucide", label: "Lucide", order: 1 },
  { id: "tabler", label: "Tabler", order: 2 },
  { id: "ph", label: "Phosphor", order: 3 },
];

const COLLECTIONS_BY_ID: ReadonlyMap<string, IconCollectionInfo> = new Map(
  ICON_COLLECTIONS.map((collection) => [collection.id, collection])
);

/** The collection metadata for `id`, or undefined for an unknown id. */
export function findIconCollection(id: string): IconCollectionInfo | undefined {
  return COLLECTIONS_BY_ID.get(id);
}

/** Whether `value` is one of the four bundled collection ids. */
export function isIconCollectionId(value: unknown): value is IconCollectionId {
  return typeof value === "string" && COLLECTIONS_BY_ID.has(value);
}

/**
 * Bundler-friendly lazy loaders: one static string per collection so both
 * webpack/turbopack and Vitest can analyze the chunk boundaries, while the
 * multi-megabyte JSON bodies stay out of every route that does not need
 * them.
 */
const ICON_SET_LOADERS: Record<IconCollectionId, () => Promise<{ default: IconSet }>> = {
  "simple-icons": () => import("@iconify-json/simple-icons/icons.json"),
  lucide: () => import("@iconify-json/lucide/icons.json"),
  tabler: () => import("@iconify-json/tabler/icons.json"),
  ph: () => import("@iconify-json/ph/icons.json"),
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
