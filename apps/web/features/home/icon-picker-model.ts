import { ICON_COLLECTIONS, isIconCollectionId } from "@veladesk/icon-catalog/meta";
import type {
  IconCategory,
  IconCollectionId,
  IconCollectionInfo,
  IconPalette,
  IconSearchScope,
} from "@veladesk/icon-catalog/meta";

import type { TranslationKey } from "../i18n/messages";

/**
 * Pure model of the icon catalog picker (016-A, v2 in 016-C): scope tabs,
 * the per-scope source filter, self-hosted endpoint URLs, page decoding and
 * append-on-load-more. No React, no fetch.
 *
 * Everything the picker needs about the catalog comes from the
 * browser-safe `@veladesk/icon-catalog/meta` subpath, so the client never
 * pulls icon bodies into its bundle and never hardcodes a collection list.
 */

/** The picker's top-level tabs: three facets, then one per category. */
export const ICON_PICKER_SCOPES: readonly IconSearchScope[] = [
  "recommended",
  "all",
  "color",
  "brand",
  "general",
  "development",
  "emoji",
];

export function isIconPickerScope(value: unknown): value is IconSearchScope {
  return typeof value === "string" && ICON_PICKER_SCOPES.includes(value as IconSearchScope);
}

const SCOPE_MESSAGE_KEYS: Record<IconSearchScope, TranslationKey> = {
  recommended: "iconPicker.scope.recommended",
  all: "iconPicker.scope.all",
  color: "iconPicker.scope.color",
  brand: "iconPicker.scope.brand",
  general: "iconPicker.scope.general",
  development: "iconPicker.scope.development",
  emoji: "iconPicker.scope.emoji",
};

/** The translation key of a scope tab label. */
export function scopeMessageKey(scope: IconSearchScope): TranslationKey {
  return SCOPE_MESSAGE_KEYS[scope];
}

/**
 * The collections a scope can return. The source filter only ever offers
 * these, so picking a source can never produce an empty grid inside the
 * current scope.
 */
export function collectionsForScope(scope: IconSearchScope): readonly IconCollectionInfo[] {
  switch (scope) {
    case "recommended":
    case "all":
      return ICON_COLLECTIONS;
    case "color":
      return ICON_COLLECTIONS.filter((info) => info.palette === "multicolor");
    case "brand":
    case "general":
    case "development":
    case "emoji":
      return ICON_COLLECTIONS.filter((info) => info.category === scope);
  }
}

/** Icons per request (spec: 96, walking to nextOffset=null). */
export const ICON_PICKER_PAGE_SIZE = 96;

/** Debounce of the search field in milliseconds. */
export const ICON_PICKER_DEBOUNCE_MS = 150;

export interface IconPickerQuery {
  readonly query: string;
  readonly scope: IconSearchScope;
  readonly collection: IconCollectionId | null;
  readonly offset?: number;
  readonly limit?: number;
}

/**
 * Builds the self-hosted search URL for one page of picker state. An empty
 * (whitespace-only) query is browse mode — the `q` param is omitted, which
 * the endpoint treats as the curated front page (recommended) or the
 * name-ordered catalog head. `offset` is only emitted past the first page
 * so the common request stays canonical.
 */
export function buildIconSearchUrl(options: IconPickerQuery): string {
  const params = new URLSearchParams();
  const trimmed = options.query.trim();
  if (trimmed.length > 0) {
    params.set("q", trimmed);
  }
  params.set("scope", options.scope);
  if (options.collection !== null) {
    params.set("collection", options.collection);
  }
  params.set("limit", String(options.limit ?? ICON_PICKER_PAGE_SIZE));
  if (options.offset !== undefined && options.offset > 0) {
    params.set("offset", String(options.offset));
  }
  return `/api/v1/icons/search?${params.toString()}`;
}

/** One decoded picker result — mirrors the endpoint's icon objects. */
export interface IconPickerEntry {
  readonly id: string;
  readonly collection: IconCollectionId;
  readonly name: string;
  readonly label: string;
  readonly palette: IconPalette;
  readonly category: IconCategory;
}

/** One decoded page: the entries plus the paging metadata. */
export interface IconPickerPage {
  readonly entries: readonly IconPickerEntry[];
  readonly total: number;
  readonly nextOffset: number | null;
}

const PALETTES: readonly IconPalette[] = ["monochrome", "multicolor"];
const CATEGORIES: readonly IconCategory[] = ["brand", "general", "development", "emoji"];

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function decodeEntry(value: unknown): IconPickerEntry | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const { id, collection, name, label, palette, category } = value as Record<string, unknown>;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof label !== "string" ||
    !isIconCollectionId(collection) ||
    !PALETTES.includes(palette as IconPalette) ||
    !CATEGORIES.includes(category as IconCategory)
  ) {
    return undefined;
  }
  return {
    id,
    collection,
    name,
    label,
    palette: palette as IconPalette,
    category: category as IconCategory,
  };
}

/**
 * Structural decode of a search page: `{ icons, total, nextOffset }`.
 * Anything unexpected — including an entry whose palette/category the
 * renderer would have to guess — is undecodable and surfaces as the
 * picker's error state rather than a silently half-rendered grid.
 */
export function decodeIconSearchPage(value: unknown): IconPickerPage | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const { icons, total, nextOffset } = value as Record<string, unknown>;
  if (!Array.isArray(icons) || !isNonNegativeInteger(total)) {
    return undefined;
  }
  if (nextOffset !== null && !isNonNegativeInteger(nextOffset)) {
    return undefined;
  }
  const entries: IconPickerEntry[] = [];
  for (const item of icons) {
    const entry = decodeEntry(item);
    if (entry === undefined) {
      return undefined;
    }
    entries.push(entry);
  }
  return { entries, total, nextOffset };
}

/**
 * Appends the next page to the results already on screen. Icon ids are
 * unique per catalog, so a repeated id (a server-side overlap) is dropped
 * instead of rendering twice — "load more" never rewrites an earlier page.
 */
export function appendIconPickerPage(
  current: readonly IconPickerEntry[],
  next: readonly IconPickerEntry[]
): IconPickerEntry[] {
  const seen = new Set(current.map((entry) => entry.id));
  const appended = [...current];
  for (const entry of next) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      appended.push(entry);
    }
  }
  return appended;
}
