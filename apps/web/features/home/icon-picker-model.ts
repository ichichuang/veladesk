import { isIconCollectionId } from "@veladesk/icon-catalog";
import type { IconCollectionId } from "@veladesk/icon-catalog";

/**
 * Pure model of the icon catalog picker (task 016-A): tab definitions,
 * endpoint URL building and response decoding. No React, no fetch.
 */

/** Picker tabs: "all" aggregates the catalog, the rest map 1:1. */
export type IconPickerTab = "all" | IconCollectionId;

export const ICON_PICKER_TABS: readonly IconPickerTab[] = [
  "all",
  "simple-icons",
  "lucide",
  "tabler",
  "ph",
];

export function isIconPickerTab(value: unknown): value is IconPickerTab {
  return value === "all" || isIconCollectionId(value);
}

/** The collection query value of a tab; "all" browses without one. */
export function tabCollectionParam(tab: IconPickerTab): string | undefined {
  return tab === "all" ? undefined : tab;
}

export const ICON_PICKER_PAGE_SIZE = 60;

/** Debounce of the search field in milliseconds. */
export const ICON_PICKER_DEBOUNCE_MS = 150;

/**
 * Builds the self-hosted search URL for the picker state. An empty
 * (whitespace-only) query is browse mode — the `q` param is omitted, which
 * the endpoint treats as curated starters / collection head.
 */
export function buildIconSearchUrl(options: {
  readonly query: string;
  readonly tab: IconPickerTab;
  readonly limit?: number;
}): string {
  const params = new URLSearchParams();
  const trimmed = options.query.trim();
  if (trimmed.length > 0) {
    params.set("q", trimmed);
  }
  const collection = tabCollectionParam(options.tab);
  if (collection !== undefined) {
    params.set("collection", collection);
  }
  params.set("limit", String(options.limit ?? ICON_PICKER_PAGE_SIZE));
  return `/api/v1/icons/search?${params.toString()}`;
}

/** One decoded picker result — mirrors the endpoint's icon objects. */
export interface IconPickerEntry {
  readonly id: string;
  readonly collection: string;
  readonly name: string;
  readonly label: string;
}

/**
 * Structural decode of the search response: `{ icons: [...] }` with id/
 * collection/name/label strings, ids shaped `<string>:<string>`. Anything
 * else is undecodable and surfaces as the picker's error state.
 */
export function decodeIconSearchResponse(value: unknown): IconPickerEntry[] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const icons = (value as { icons?: unknown }).icons;
  if (!Array.isArray(icons)) {
    return undefined;
  }
  const entries: IconPickerEntry[] = [];
  for (const item of icons) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return undefined;
    }
    const record = item as Record<string, unknown>;
    const { id, collection, name, label } = record;
    if (
      typeof id !== "string" ||
      typeof collection !== "string" ||
      typeof name !== "string" ||
      typeof label !== "string"
    ) {
      return undefined;
    }
    entries.push({ id, collection, name, label });
  }
  return entries;
}
