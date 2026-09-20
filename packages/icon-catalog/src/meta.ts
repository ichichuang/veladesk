import type { IconCategory, IconCollectionId, IconPalette } from "./types";

/**
 * Browser-safe collection metadata.
 *
 * This module is the ONE source of truth for which collections exist, what
 * they are called, how they are ordered and how they must be drawn. It has
 * no data imports at all — loading `icons.json` (megabytes of icon bodies)
 * is strictly the server's job in `collections.ts`, so the web client can
 * import `@veladesk/icon-catalog/meta` without pulling a single icon body
 * into its bundle.
 *
 * Display order puts brands first (`simple-icons`), then the general-
 * purpose outline sets, then the colored development sets, then emoji.
 */

export interface IconCollectionInfo {
  readonly id: IconCollectionId;
  /** English display name (the web layer localizes further if wanted). */
  readonly label: string;
  /** Stable display order across the whole catalog. */
  readonly order: number;
  readonly category: IconCategory;
  readonly palette: IconPalette;
}

export const ICON_COLLECTIONS: readonly IconCollectionInfo[] = [
  { id: "simple-icons", label: "Brands", order: 0, category: "brand", palette: "monochrome" },
  { id: "lucide", label: "Lucide", order: 1, category: "general", palette: "monochrome" },
  { id: "tabler", label: "Tabler", order: 2, category: "general", palette: "monochrome" },
  { id: "ph", label: "Phosphor", order: 3, category: "general", palette: "monochrome" },
  { id: "fluent-color", label: "Fluent Color", order: 4, category: "general", palette: "multicolor" },
  { id: "devicon", label: "Devicon", order: 5, category: "development", palette: "multicolor" },
  {
    id: "vscode-icons",
    label: "VSCode Icons",
    order: 6,
    category: "development",
    palette: "multicolor",
  },
  { id: "catppuccin", label: "Catppuccin", order: 7, category: "development", palette: "multicolor" },
  { id: "noto", label: "Noto Emoji", order: 8, category: "emoji", palette: "multicolor" },
];

const COLLECTIONS_BY_ID: ReadonlyMap<string, IconCollectionInfo> = new Map(
  ICON_COLLECTIONS.map((collection) => [collection.id, collection])
);

/** The collection metadata for `id`, or undefined for an unknown id. */
export function findIconCollection(id: string): IconCollectionInfo | undefined {
  return COLLECTIONS_BY_ID.get(id);
}

/** Whether `value` is one of the nine bundled collection ids. */
export function isIconCollectionId(value: unknown): value is IconCollectionId {
  return typeof value === "string" && COLLECTIONS_BY_ID.has(value);
}
