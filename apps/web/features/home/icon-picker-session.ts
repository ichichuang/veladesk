import { isIconCollectionId } from "@veladesk/icon-catalog/meta";
import type { IconCollectionId, IconSearchScope } from "@veladesk/icon-catalog/meta";

import { isIconPickerScope } from "./icon-picker-model";
import type { IconPickerPage } from "./icon-picker-model";

/**
 * Icon-picker session memory (task 028): the two halves of "switching
 * categories must never reload".
 *
 * 1. PAGE CACHE — the bundled catalog is PINNED npm data, so the same
 *    search URL always decodes to the same page. Decoded pages live in a
 *    small module-level LRU for the tab's lifetime; a scope/collection/
 *    query switch that revisits a URL renders instantly and never fetches.
 *    The cache never crosses a reload, and that is fine: the localStorage
 *    half below restores the CONTEXT so the first view after a reload is
 *    also one network request, not zero-context browsing.
 *
 * 2. SESSION STATE — the last browse context (scope / collection / query)
 *    persists under a versioned localStorage key with the same strict
 *    parse + try/catch degradation policy as the workspace view state
 *    (`workspace-view-state.ts`). Both pickers (appearance editor and
 *    Add-App) mount the same `IconPicker`, so both restore and both write.
 *
 * Pure module: no React, no fetch, no component state.
 */

/** Decoded-page LRU bound — a browsing session touches far fewer URLs. */
const PAGE_CACHE_LIMIT = 48;

const pageCache = new Map<string, IconPickerPage>();

/** Returns the cached decoded page for `url`, refreshing its LRU recency. */
export function readCachedIconPage(url: string): IconPickerPage | undefined {
  const page = pageCache.get(url);
  if (page !== undefined) {
    pageCache.delete(url);
    pageCache.set(url, page);
  }
  return page;
}

/** Caches one decoded page for `url` (most recently used). */
export function writeCachedIconPage(url: string, page: IconPickerPage): void {
  pageCache.delete(url);
  pageCache.set(url, page);
  if (pageCache.size > PAGE_CACHE_LIMIT) {
    const oldest = pageCache.keys().next().value;
    if (oldest !== undefined) {
      pageCache.delete(oldest);
    }
  }
}

/** Test seam: drops every cached page (module state survives across tests). */
export function clearCachedIconPagesForTests(): void {
  pageCache.clear();
}

/** The browse context the picker restores and keeps writing back. */
export interface IconPickerSessionState {
  readonly scope: IconSearchScope;
  readonly collection: IconCollectionId | null;
  readonly query: string;
}

const STORAGE_KEY = "veladesk:icon-picker:v1";

interface StoredIconPickerSession {
  readonly version: 1;
  readonly scope: unknown;
  readonly collection: unknown;
  readonly query: unknown;
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
    const { scope, collection, query } = parsed;
    if (!isIconPickerScope(scope) || typeof query !== "string") {
      return undefined;
    }
    if (collection !== null && !isIconCollectionId(collection)) {
      return undefined;
    }
    // The query travels raw (the field clamps to its own maxLength) but a
    // stale oversized value still degrades instead of fighting the input.
    return query.length <= 100 ? { scope, collection, query } : undefined;
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
    };
    store.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota/private-mode failures must never break browsing.
  }
}
