import { isIconCollectionId } from "@veladesk/icon-catalog/meta";
import type { IconCollectionId, IconSearchScope } from "@veladesk/icon-catalog/meta";

import { decodeIconSearchPage, isIconPickerScope } from "./icon-picker-model";
import type { IconPickerPage } from "./icon-picker-model";
import { VELADESK_VERSION } from "../../lib/app-version";

/**
 * Icon-picker session memory (task 028, persistent pages in task 029): the
 * two halves of "switching categories must never reload".
 *
 * 1. PAGE CACHE — the bundled catalog is PINNED npm data, so the same
 *    search URL always decodes to the same page. Decoded pages live in a
 *    module-level LRU for the tab's lifetime AND in a versioned
 *    localStorage store (LRU-bounded), so a scope/collection/query switch
 *    that revisits a URL renders instantly without fetching — including
 *    after a reload, where every page the user already loaded (first AND
 *    appended offset pages) is restored from disk and re-merged by the
 *    picker's rehydrate walk. Storage failures (quota, private mode)
 *    degrade silently to the in-memory cache; a corrupt or wrong-version
 *    store drops only its undecodable pages, never the browse session.
 *
 * 2. SESSION STATE — the last browse context (scope / collection / query)
 *    persists under a versioned localStorage key with the same strict
 *    parse + try/catch degradation policy as the workspace view state
 *    (`workspace-view-state.ts`). Both pickers (appearance editor and
 *    Add-App) mount the same `IconPicker`, so both restore and both write.
 *
 * Pure module: no React, no fetch, no component state.
 */

/** In-memory decoded-page LRU bound — a browsing session touches far fewer URLs. */
const PAGE_CACHE_LIMIT = 48;

/**
 * Persistent store bound. One page is ~96 entries ≈ 10–20KB of JSON, so 24
 * pages keep the store comfortably inside the localStorage budget even
 * with several large collections browsed.
 */
const PAGE_STORE_LIMIT = 24;

/** How many oldest pages a failed persist (quota) sheds before retrying once. */
const PAGE_STORE_EVICTION_STEP = 4;

/**
 * The persistent page store's versioned localStorage key — namespaced by
 * the APP VERSION. The catalog ships with the app, so the same search URL
 * decodes to different pages across upgrades (curated list changes,
 * collection bumps); keying by version makes an upgrade drop the whole
 * stale store instead of serving pre-upgrade pages forever.
 */
const PAGE_STORE_KEY = `veladesk:icon-picker-pages:v1:${VELADESK_VERSION}`;

const pageCache = new Map<string, IconPickerPage>();

/** Hydrated persistent pages in LRU order (oldest first); null = not read yet. */
let persistentPages: Map<string, IconPickerPage> | null = null;
/** Set after a persist failure survived its eviction retry — stop trying. */
let persistDisabled = false;

function pageStoreStorage(): Storage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

interface StoredIconPageStore {
  readonly version: 1;
  /** LRU order, oldest first — the map iteration order on the write side. */
  readonly order: readonly string[];
  /** Endpoint-shaped pages (`{ icons, total, nextOffset }`) keyed by URL. */
  readonly pages: Readonly<Record<string, unknown>>;
}

function serializeIconPageStore(pages: Map<string, IconPickerPage>): string {
  const stored: StoredIconPageStore = {
    version: 1,
    order: [...pages.keys()],
    pages: Object.fromEntries(
      [...pages.entries()].map(([url, page]) => [
        url,
        { icons: page.entries, total: page.total, nextOffset: page.nextOffset },
      ]),
    ),
  };
  return JSON.stringify(stored);
}

/**
 * Strict parse of the persistent store: version-gated, every page decoded
 * through the SAME endpoint decoder (an undecodable page — corruption, a
 * future shape change — is dropped individually; the rest of the store
 * survives). Returns an LRU-ordered map, or null when nothing usable.
 */
export function deserializeIconPageStore(raw: string): Map<string, IconPickerPage> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.order)) {
    return null;
  }
  const source =
    typeof record.pages === "object" && record.pages !== null && !Array.isArray(record.pages)
      ? (record.pages as Record<string, unknown>)
      : {};
  const pages = new Map<string, IconPickerPage>();
  for (const url of record.order) {
    if (typeof url !== "string") {
      continue;
    }
    // The stored page is endpoint-shaped, so the canonical decoder is the
    // ONE validator a page ever passes through.
    const decoded = decodeIconSearchPage(source[url]);
    if (decoded !== undefined) {
      pages.set(url, decoded);
    }
  }
  return pages;
}

function hydratePersistentPages(storage: Storage | undefined): Map<string, IconPickerPage> {
  if (persistentPages !== null) {
    return persistentPages;
  }
  let pages: Map<string, IconPickerPage> | null = null;
  if (storage !== undefined) {
    try {
      const raw = storage.getItem(PAGE_STORE_KEY);
      if (raw !== null) {
        pages = deserializeIconPageStore(raw);
      }
    } catch {
      pages = null;
    }
  }
  persistentPages = pages ?? new Map<string, IconPickerPage>();
  return persistentPages;
}

function persistIconPageStore(pages: Map<string, IconPickerPage>): void {
  if (persistDisabled) {
    return;
  }
  const storage = pageStoreStorage();
  if (storage === undefined) {
    return;
  }
  try {
    storage.setItem(PAGE_STORE_KEY, serializeIconPageStore(pages));
  } catch {
    // Quota: shed the oldest pages and retry once; a second failure (or a
    // storage that stays broken) permanently downgrades to memory-only.
    for (let dropped = 0; dropped < PAGE_STORE_EVICTION_STEP; dropped += 1) {
      const oldest = pages.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      pages.delete(oldest);
    }
    try {
      storage.setItem(PAGE_STORE_KEY, serializeIconPageStore(pages));
    } catch {
      persistDisabled = true;
    }
  }
}

/** Memory-LRU promotion without any storage write (safe during render). */
function rememberMemoryPage(url: string, page: IconPickerPage): void {
  pageCache.delete(url);
  pageCache.set(url, page);
  if (pageCache.size > PAGE_CACHE_LIMIT) {
    const oldest = pageCache.keys().next().value;
    if (oldest !== undefined) {
      pageCache.delete(oldest);
    }
  }
}

/** Returns the cached decoded page for `url`, refreshing its LRU recency. */
export function readCachedIconPage(url: string): IconPickerPage | undefined {
  const page = pageCache.get(url);
  if (page !== undefined) {
    pageCache.delete(url);
    pageCache.set(url, page);
    return page;
  }
  const stored = hydratePersistentPages(pageStoreStorage()).get(url);
  if (stored !== undefined) {
    // Promote into the memory LRU (NO persist — reads must stay free of
    // storage writes so render-time derivation stays side-effect-free).
    rememberMemoryPage(url, stored);
    return stored;
  }
  return undefined;
}

/** Caches one decoded page for `url` (most recently used, persisted). */
export function writeCachedIconPage(url: string, page: IconPickerPage): void {
  rememberMemoryPage(url, page);
  const stored = hydratePersistentPages(pageStoreStorage());
  stored.delete(url);
  stored.set(url, page);
  if (stored.size > PAGE_STORE_LIMIT) {
    const oldest = stored.keys().next().value;
    if (oldest !== undefined) {
      stored.delete(oldest);
    }
  }
  persistIconPageStore(stored);
}

/** Test seam: drops every cached page (module state survives across tests). */
export function clearCachedIconPagesForTests(): void {
  pageCache.clear();
  persistentPages = null;
  persistDisabled = false;
  const storage = pageStoreStorage();
  if (storage !== undefined) {
    try {
      storage.removeItem(PAGE_STORE_KEY);
    } catch {
      // Ignore — tests on storage-less hosts still clear the memory maps.
    }
  }
}

/**
 * Test seam: simulates a RELOAD for the page cache — the in-memory LRU and
 * the hydration flag drop, localStorage keeps its bytes, so the next read
 * re-hydrates exactly like a fresh tab would.
 */
export function simulateIconPageReloadForTests(): void {
  pageCache.clear();
  persistentPages = null;
  persistDisabled = false;
}

/** The browse context the picker restores and keeps writing back. */
export interface IconPickerSessionState {
  readonly scope: IconSearchScope;
  readonly collection: IconCollectionId | null;
  readonly query: string;
  /**
   * F5: the grid's last scroll offset (px). Optional and absent on every
   * pre-F5 stored session; restored alongside the context so a reopened
   * picker continues where the last one scrolled, not just what it loaded.
   */
  readonly scrollTop?: number;
}

const STORAGE_KEY = "veladesk:icon-picker:v1";

/** Sane upper bound for a persisted scroll offset (px) — beyond this the
 * value is corruption, not a scroll position. */
const MAX_SESSION_SCROLL_TOP = 1_000_000;

interface StoredIconPickerSession {
  readonly version: 1;
  readonly scope: unknown;
  readonly collection: unknown;
  readonly query: unknown;
  readonly scrollTop?: unknown;
}

function isStoredSession(value: unknown): value is StoredIconPickerSession {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.version === 1;
}

/**
 * Reads the persisted browse context. Anything unexpected — wrong version,
 * unknown scope/collection ids, a non-string query — degrades to undefined
 * (the picker's own defaults) instead of a half-restored state. Never
 * throws, even when storage itself is unavailable.
 */
export function readIconPickerSession(storage?: Storage): IconPickerSessionState | undefined {
  const store = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  if (store === undefined) {
    return undefined;
  }
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw === null) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredSession(parsed)) {
      return undefined;
    }
    const { scope, collection, query, scrollTop } = parsed;
    if (!isIconPickerScope(scope) || typeof query !== "string") {
      return undefined;
    }
    if (collection !== null && !isIconCollectionId(collection)) {
      return undefined;
    }
    if (
      scrollTop !== undefined &&
      (typeof scrollTop !== "number" ||
        !Number.isSafeInteger(scrollTop) ||
        scrollTop < 0 ||
        scrollTop > MAX_SESSION_SCROLL_TOP)
    ) {
      return undefined;
    }
    // The query travels raw (the field clamps to its own maxLength) but a
    // stale oversized value still degrades instead of fighting the input.
    if (query.length > 100) {
      return undefined;
    }
    return scrollTop === undefined
      ? { scope, collection, query }
      : { scope, collection, query, scrollTop };
  } catch {
    return undefined;
  }
}

/** Persists the browse context; storage failures are silently ignored. */
export function writeIconPickerSession(
  state: IconPickerSessionState,
  storage?: Storage
): void {
  const store = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  if (store === undefined) {
    return;
  }
  try {
    const payload: StoredIconPickerSession = {
      version: 1,
      scope: state.scope,
      collection: state.collection,
      query: state.query,
      // F5: only present when a scroll position was actually observed —
      // a fresh session stays byte-identical to the pre-F5 shape.
      ...(state.scrollTop !== undefined ? { scrollTop: state.scrollTop } : {}),
    };
    store.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota/private-mode failures must never break browsing.
  }
}
