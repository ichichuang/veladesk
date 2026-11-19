"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { findIconCollection } from "@veladesk/icon-catalog/meta";
import type { IconCollectionId, IconSearchScope } from "@veladesk/icon-catalog/meta";

import {
  Input,
  Label,
  ListBox,
  Select,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react";

import { useI18n } from "../i18n/use-i18n";
import { VdScrollArea } from "@components/vd/scroll-area";
import { VdTooltip, VdTooltipProvider } from "@components/vd/tooltip";
import { Search } from "lucide-react";
import {
  ICON_PICKER_DEBOUNCE_MS,
  ICON_PICKER_SCOPES,
  appendIconPickerPage,
  buildIconSearchUrl,
  collectionsForScope,
  decodeIconSearchPage,
  rehydrateIconPickerPages,
  scopeMessageKey,
} from "./icon-picker-model";
import type { IconPickerEntry, IconPickerPage } from "./icon-picker-model";
import {
  readCachedIconPage,
  readIconPickerSession,
  writeCachedIconPage,
  writeIconPickerSession,
} from "./icon-picker-session";
import { iconifyGlyphModel } from "./app-icon";
import { glyphMaskStyle } from "./app-icon-renderer";
import "./home-shell.css";

/**
 * Icon Catalog picker v2 (016-A, rebuilt in 016-C): scope tabs, a source
 * filter, a search field and a paginated grid of the whole bundled catalog.
 *
 * All data comes from the self-hosted `/api/v1/icons/search` endpoint — the
 * component never talks to any other host. The grid is its own scroll
 * surface (`data-vd-wheel-scope="local"`) so wheeling through icons never
 * pages the section stack or moves the editor's pinned preview/footer.
 *
 * Paging (task 029): filters always reset to offset 0 and replace the
 * results, while loading more APPENDS the next page (deduped by id) until
 * `nextOffset` is null. A sentinel past the grid edge auto-fires ~240px
 * BEFORE the true bottom (IntersectionObserver, never a scroll-event
 * React prop — the scroll-surface contract), and the next page is
 * prefetched in idle time, so the append is usually the synchronous cache
 * path with no visible loading state. The manual button stays as the
 * always-available fallback (and the retry). Every request carries a
 * generation token, so a slow response from an abandoned query can never
 * overwrite the current grid; a failed page keeps the results already on
 * screen and offers a retry.
 *
 * Persistence (task 028, disk-backed in task 029): the bundled catalog is
 * pinned data, so EVERY decoded page — first AND appended offset pages —
 * is cached under its URL in a localStorage-backed LRU
 * (`icon-picker-session`). Revisiting a scope/collection/query renders
 * INSTANTLY with no request, and the rehydrate walk re-merges the whole
 * cached offset chain, so a picker reopened after a reload continues with
 * everything the user had already loaded. The browse context (scope /
 * source / query) persists in localStorage and is restored on mount.
 */

interface IconPickerProps {
  /** The currently selected library icon id, if any. */
  readonly selectedId: string | null;
  readonly onSelect: (iconId: string) => void;
}

interface PickerResults {
  /** The base URL the results belong to — a mismatch means "stale". */
  readonly key: string;
  readonly entries: readonly IconPickerEntry[];
  readonly total: number;
  readonly nextOffset: number | null;
  readonly failed: boolean;
}

/**
 * Load-more progress for ONE base query. Keyed by the URL it belongs to so
 * a filter change retires it without any reset inside the fetch effect.
 */
interface AppendProgress {
  readonly key: string;
  readonly busy: boolean;
  readonly failed: boolean;
}

export function IconPicker({ selectedId, onSelect }: IconPickerProps) {
  const { t } = useI18n();
  // The browse context restores from localStorage ONCE per mount (lazy
  // initializer) — the picker continues where the last session (this
  // dialog, the other picker, a previous reload) left off.
  const [restored] = useState(readIconPickerSession);
  const [scope, setScope] = useState<IconSearchScope>(restored?.scope ?? "recommended");
  const [collection, setCollection] = useState<IconCollectionId | null>(
    restored?.collection ?? null
  );
  const [rawQuery, setRawQuery] = useState(restored?.query ?? "");
  const [query, setQuery] = useState(restored?.query ?? "");
  const [results, setResults] = useState<PickerResults | null>(null);
  const [append, setAppend] = useState<AppendProgress | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** Bumped whenever the filters change; stale responses are dropped. */
  const generationRef = useRef(0);
  // F5 scroll persistence: the grid's scroll host, its live offset (a ref —
  // scroll NEVER becomes React state; the scroll-surface contract), and a
  // render-time mirror of the browse context for the unmount flush.
  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  const scrollTopRef = useRef(0);
  const restoredScrollDoneRef = useRef(false);
  /** The offset URL of the append in flight — one at a time (a ref, not
   *  state: setState is async, so the IO sentinel, the button and a retry
   *  could otherwise double-fire inside one tick). */
  const appendUrlRef = useRef<string | null>(null);
  /** In-flight page fetches by URL — the idle prefetch and a user-triggered
   *  load-more never double-fetch the same page. */
  const pageFetchesRef = useRef(new Map<string, Promise<IconPickerPage | null>>());

  /**
   * The ONE fetch path (task 029): same-URL requests are deduped through
   * the in-flight map, and every DECODED page lands in the persistent
   * cache — the catalog is pinned data, so a fetched URL is finished
   * forever. Generation checks stay at the CALLERS: caching a stale-URL
   * page is always correct, applying it to the grid is not.
   */
  const fetchIconPage = useCallback((url: string): Promise<IconPickerPage | null> => {
    const inFlight = pageFetchesRef.current.get(url);
    if (inFlight !== undefined) {
      return inFlight;
    }
    const promise = window
      .fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`icon search failed (${response.status})`);
        }
        return response.json() as unknown;
      })
      .then((body) => {
        const decoded = decodeIconSearchPage(body);
        if (decoded !== undefined) {
          writeCachedIconPage(url, decoded);
        }
        return decoded ?? null;
      })
      .catch(() => null)
      .finally(() => {
        pageFetchesRef.current.delete(url);
      });
    pageFetchesRef.current.set(url, promise);
    return promise;
  }, []);

  // Debounced query (spec: ~150ms). "Load more" never goes through this.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(rawQuery), ICON_PICKER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [rawQuery]);

  // Focus the search field once on open.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const baseUrl = useMemo(
    () => buildIconSearchUrl({ query, scope, collection }),
    [query, scope, collection]
  );

  // The browse context writes through on every settled change — a reload
  // (or the other picker's next mount) restores exactly this state. F5: a
  // filter change starts a NEW grid at the top, so the outgoing grid's
  // scroll offset never rides the new context's snapshot. Change detection
  // is VALUE-based (not first-run-skipped): a StrictMode dev double-mount
  // re-runs effects, and a run-count skip would let the second run zero
  // the scrollTop the restore just applied.
  const prevContextRef = useRef<{ scope: IconSearchScope; collection: IconCollectionId | null; rawQuery: string } | null>(null);
  useEffect(() => {
    const previous = prevContextRef.current;
    prevContextRef.current = { scope, collection, rawQuery };
    if (
      previous !== null &&
      (previous.scope !== scope ||
        previous.collection !== collection ||
        previous.rawQuery !== rawQuery)
    ) {
      scrollTopRef.current = 0;
      writeIconPickerSession({ scope, collection, query: rawQuery, scrollTop: 0 });
    }
  });

  // F5 restore: one shot after mount. The rehydrated entries render
  // synchronously from the persistent page cache, so the stored offset
  // lands on the full grid; anything shorter simply clamps.
  useLayoutEffect(() => {
    if (restoredScrollDoneRef.current) {
      return;
    }
    restoredScrollDoneRef.current = true;
    const top = restored?.scrollTop;
    if (top !== undefined && top > 0 && scrollHostRef.current !== null) {
      scrollHostRef.current.scrollTop = top;
    }
  }, [restored]);

  // F5 observe: a passive imperative listener keeps the live offset in a
  // ref only — no scroll-driven renders, no React scroll props. A5 fix
  // (walkthrough acceptance): Lenis smooth-scroll lands fractional
  // mid-animation offsets, and the session decode requires a safe integer
  // (a fractional value would degrade the WHOLE stored session — context
  // included), so the ref stores the rounded pixel.
  useEffect(() => {
    const host = scrollHostRef.current;
    if (host === null) {
      return;
    }
    const persistScroll = () => {
      scrollTopRef.current = Math.round(host.scrollTop);
    };
    host.addEventListener("scroll", persistScroll, { passive: true });
    return () => {
      host.removeEventListener("scroll", persistScroll);
    };
  }, []);

  // F5 flush: the LAST session write happens at unmount with the final
  // browse context AND the final scroll offset. The mirror effect (runs
  // after every render, no dep array) keeps the ref current without ever
  // touching refs during render.
  const sessionValuesRef = useRef({ scope, collection, rawQuery });
  useEffect(() => {
    sessionValuesRef.current = { scope, collection, rawQuery };
  });
  useEffect(() => {
    return () => {
      const snapshot = sessionValuesRef.current;
      writeIconPickerSession({
        scope: snapshot.scope,
        collection: snapshot.collection,
        query: snapshot.rawQuery,
        scrollTop: scrollTopRef.current,
      });
    };
  }, []);

  useEffect(() => {
    // Pinned catalog content: a URL seen before decodes to the same page.
    // A cache HIT renders through render-time derivation below (no
    // setState inside effects); only a genuine miss touches the network.
    if (readCachedIconPage(baseUrl) !== undefined) {
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let cancelled = false;
    void fetchIconPage(baseUrl).then((page) => {
      if (cancelled || generationRef.current !== generation) {
        return;
      }
      setResults(
        page === null
          ? { key: baseUrl, entries: [], total: 0, nextOffset: null, failed: true }
          : { key: baseUrl, ...page, failed: false }
      );
    });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, fetchIconPage]);

  // Results and append progress only apply to the URL currently requested —
  // a leftover from an abandoned query is invisible by derivation. A cached
  // page (pinned catalog ⇒ immutable per URL) renders immediately here, and
  // task 029 rehydrates the WHOLE cached offset chain behind it, so a
  // revisit (this tab or after a reload) restores everything the user had
  // loaded with zero requests. Memoized so the object identity is stable
  // for the loadMore callback.
  const cachedPage = readCachedIconPage(baseUrl);
  const current = useMemo(() => {
    if (results !== null && results.key === baseUrl) {
      return results;
    }
    if (cachedPage !== undefined) {
      const restored = rehydrateIconPickerPages(cachedPage, (offset) =>
        readCachedIconPage(buildIconSearchUrl({ query, scope, collection, offset }))
      );
      return { key: baseUrl, ...restored, failed: false };
    }
    return null;
  }, [results, baseUrl, cachedPage, query, scope, collection]);
  const entries = current?.entries ?? [];
  const failed = current?.failed === true;
  const nextOffset = current?.nextOffset ?? null;
  const visible = current !== null && !failed;
  const loadingFirstPage = current === null && !failed;
  const appendState = append !== null && append.key === baseUrl ? append : null;
  const appending = appendState?.busy === true;
  const appendFailed = appendState?.failed === true;

  const loadMore = useCallback(() => {
    if (current === null || current.key !== baseUrl) {
      return;
    }
    const offset = current.nextOffset;
    if (offset === null) {
      return;
    }
    const offsetUrl = buildIconSearchUrl({ query, scope, collection, offset });
    if (appendUrlRef.current === offsetUrl) {
      return;
    }
    // A prefetched page (idle warm-up or an earlier visit) appends
    // SYNCHRONOUSLY — no busy state, no loading flash.
    const cached = readCachedIconPage(offsetUrl);
    if (cached !== undefined) {
      appendUrlRef.current = offsetUrl;
      setResults({
        key: baseUrl,
        entries: appendIconPickerPage(current.entries, cached.entries),
        total: cached.total,
        nextOffset: cached.nextOffset,
        failed: false,
      });
      setAppend(null);
      appendUrlRef.current = null;
      return;
    }
    // The entries the NEXT page appends onto — the derived view (cache
    // hits never enter state) is the single source of truth here.
    const baseEntries = current.entries;
    const generation = generationRef.current;
    appendUrlRef.current = offsetUrl;
    setAppend({ key: baseUrl, busy: true, failed: false });
    void fetchIconPage(offsetUrl).then((page) => {
      if (appendUrlRef.current === offsetUrl) {
        appendUrlRef.current = null;
      }
      if (generationRef.current !== generation) {
        return;
      }
      if (page === null) {
        setAppend({ key: baseUrl, busy: false, failed: true });
        return;
      }
      setResults({
        key: baseUrl,
        entries: appendIconPickerPage(baseEntries, page.entries),
        total: page.total,
        nextOffset: page.nextOffset,
        failed: false,
      });
      setAppend({ key: baseUrl, busy: false, failed: false });
    });
  }, [baseUrl, collection, current, fetchIconPage, query, scope]);

  // task 029 auto-load: a sentinel past the grid edge trips ~240px BEFORE
  // the true bottom, so the next page is usually prefetched and appended
  // with no visible loading state. IntersectionObserver with the implicit
  // root (intersection is still clipped by the picker's own scroll
  // container) — never a scroll-event React prop (the scroll-surface
  // contract). The observer re-arms on every append (loadMore identity
  // changes), so a grid still shorter than the scroll area keeps chaining
  // until it scrolls, and stops the moment the sentinel sits out of view.
  const autoLoadEnabled = visible && nextOffset !== null && !appendFailed;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!autoLoadEnabled) {
      return;
    }
    const node = sentinelRef.current;
    if (node === null || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((entry) => entry.isIntersecting)) {
          loadMore();
        }
      },
      { rootMargin: "240px 0px" }
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [autoLoadEnabled, loadMore]);

  // task 029 preload: while the user is still browsing the loaded pages,
  // the NEXT page warms into the persistent cache in idle time — by the
  // time the sentinel trips, the append is the synchronous cache path.
  // Cache-only (no state): a warmed page for an abandoned query is still a
  // correct cache entry, so there is no generation check to make.
  useEffect(() => {
    if (!visible || nextOffset === null) {
      return;
    }
    const nextUrl = buildIconSearchUrl({ query, scope, collection, offset: nextOffset });
    if (readCachedIconPage(nextUrl) !== undefined || pageFetchesRef.current.has(nextUrl)) {
      return;
    }
    let cancelled = false;
    const warm = () => {
      if (!cancelled) {
        void fetchIconPage(nextUrl);
      }
    };
    const idle =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(warm)
        : window.setTimeout(warm, 400);
    return () => {
      cancelled = true;
      if (typeof window.requestIdleCallback === "function") {
        window.cancelIdleCallback(idle);
      } else {
        window.clearTimeout(idle);
      }
    };
  }, [visible, nextOffset, query, scope, collection, fetchIconPage]);

  function chooseScope(next: IconSearchScope) {
    setScope(next);
    // A source outside the new scope can only return an empty grid.
    setCollection(null);
  }

  const sourceOptions = collectionsForScope(scope);

  return (
    <VdTooltipProvider skipDelayDuration={120}>
    <div className="vela-icon-picker" data-testid="icon-picker">
      <TextField value={rawQuery} onChange={setRawQuery} aria-label={t("iconPicker.searchLabel")}>
        <Label className="sr-only">{t("iconPicker.searchLabel")}</Label>
        <Input
          ref={inputRef}
          name="iconSearch"
          className="h-10"
          type="text"
          maxLength={100}
          autoComplete="off"
          placeholder={t("iconPicker.searchPlaceholder")}
        />
      </TextField>
      <ToggleButtonGroup
        selectionMode="single"
        selectedKeys={new Set([scope])}
        onSelectionChange={(keys) => {
          const value = [...keys][0];
          if (typeof value === "string") {
            chooseScope(value as IconSearchScope);
          }
        }}
        aria-label={t("iconPicker.collections")}
      >
        {ICON_PICKER_SCOPES.map((candidate) => (
          <ToggleButton key={candidate} id={candidate}>
            {t(scopeMessageKey(candidate))}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <div className="vela-icon-picker__filters">
        <Select
          value={collection ?? "all"}
          onChange={(value) => {
            if (value === null || value === "all") {
              setCollection(null);
            } else if (typeof value === "string") {
              setCollection(value as IconCollectionId);
            }
          }}
          aria-label={t("iconPicker.sourceLabel")}
          variant="secondary"
          className="w-[180px]"
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="all" textValue={t("iconPicker.sourceAll")}>
                {t("iconPicker.sourceAll")}
                <ListBox.ItemIndicator />
              </ListBox.Item>
              {sourceOptions.map((info) => (
                <ListBox.Item key={info.id} id={info.id} textValue={info.label}>
                  {info.label}
                  {/* Meaningful selected state (021-R1): see settings-center. */}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        {current !== null && !failed ? (
          <span className="vela-icon-picker__count">
            {t("iconPicker.loadedCount", { loaded: entries.length, total: current.total })}
          </span>
        ) : null}
      </div>
      {scope === "brand" ? (
        <p className="vela-icon-picker__note">{t("iconPicker.brandsNote")}</p>
      ) : null}
      {failed ? (
        <p className="vela-form__error" role="alert">
          {t("iconPicker.loadFailed")}
        </p>
      ) : null}
      {/* The scroll owner (VdScrollArea, 021-A): wheeling through icons
          never pages the section stack, and the framed well carries the
          shared quiet scrollbar. Lenis-smoothed (an overlay pane, never
          the app frame). */}
      <VdScrollArea
        axis="y"
        smooth
        className="vela-icon-picker__scroll"
        data-vd-wheel-scope="local"
        ref={scrollHostRef}
      >
        {visible && entries.length === 0 ? (
          // friendly-ui 空态: a centered friendly empty state INSIDE the
          // owning grid area — icon, copy and the obvious next action
          // (clear the search), replacing the bare footer caption.
          <div className="vela-icon-picker__empty">
            <Search className="vela-icon-picker__empty-icon" strokeWidth={1.5} aria-hidden="true" />
            <p className="vela-icon-picker__empty-text">{t("iconPicker.noResults")}</p>
            {rawQuery.trim().length > 0 ? (
              <button
                type="button"
                className="vela-button vela-icon-picker__empty-clear"
                onClick={() => setRawQuery("")}
              >
                {t("iconPicker.clearSearch")}
              </button>
            ) : null}
          </div>
        ) : (
        <div className="vela-icon-picker__grid">
          {entries.map((entry) => {
            // F4b: hover shows a LARGE preview — a wide wordmark that
            // shrinks to a speck at cell size is identifiable at tooltip
            // size. The cell keeps its own aria-label; the tooltip is
            // supplemental (never the accessible name).
            const collectionLabel =
              findIconCollection(entry.collection)?.label ?? entry.collection;
            return (
              <VdTooltip
                key={entry.id}
                content={`${entry.label} · ${collectionLabel}`}
                media={<IconPreview iconId={entry.id} />}
              >
                <button
                  type="button"
                  className="vela-icon-picker__cell"
                  data-selected={entry.id === selectedId ? "true" : undefined}
                  aria-label={`${entry.label} · ${collectionLabel}`}
                  onClick={() => onSelect(entry.id)}
                >
                  <IconPreview iconId={entry.id} />
                </button>
              </VdTooltip>
            );
          })}
        </div>
        )}
        {/* The auto-load sentinel: observed ~240px before the true bottom
            (see the effect above); invisible, inert, zero-height. */}
        <div ref={sentinelRef} className="vela-icon-picker__sentinel" aria-hidden="true" />
      </VdScrollArea>
      <div className="vela-icon-picker__footer">
        {appendFailed ? (
          <>
            <span className="vela-icon-picker__note" role="alert">
              {t("iconPicker.loadMoreFailed")}
            </span>
            <button
              type="button"
              className="vela-button vela-icon-picker__more"
              onClick={loadMore}
              disabled={appending}
            >
              {t("iconPicker.retryLoadMore")}
            </button>
          </>
        ) : nextOffset !== null ? (
          <button
            type="button"
            className="vela-button vela-icon-picker__more"
            onClick={loadMore}
            disabled={appending}
          >
            {appending ? t("iconPicker.loadingMore") : t("iconPicker.loadMore")}
          </button>
        ) : null}
        {loadingFirstPage ? (
          <span className="vela-icon-picker__note">{t("common.working")}</span>
        ) : null}
        {/* 首屏骨架 (friendly-ui): a quiet shimmer grid stands in for the
            first page — the picker opens as a SHAPE, not a blank well with
            a caption. Purely presentational (aria-hidden); the real grid
            replaces it the moment the page decodes. */}
        {loadingFirstPage ? (
          <div className="vela-icon-picker__skeleton" aria-hidden="true">
            {Array.from({ length: 24 }, (_, index) => (
              <span key={index} className="vela-icon-picker__skeleton-cell" />
            ))}
          </div>
        ) : null}
      </div>
    </div>
    </VdTooltipProvider>
  );
}

/**
 * One icon preview: masked for monochrome collections, a same-origin
 * `<img>` for multicolor ones so the real pigments show BEFORE selection —
 * the grid must never render every icon in one flat color. No innerHTML,
 * no third-party host; the URL comes from validated catalog ids only.
 */
export function IconPreview({ iconId }: { iconId: string }) {
  const model = iconifyGlyphModel(iconId);
  if (model === undefined) {
    return <span className="vela-icon-picker__preview" />;
  }
  if (model.kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- same-origin SVG route, not an optimizable static asset
      <img
        className="vela-icon-picker__preview vela-icon-picker__preview--image"
        src={model.url}
        alt=""
        aria-hidden="true"
        draggable={false}
        loading="lazy"
        decoding="async"
      />
    );
  }
  return <span className="vela-icon-picker__preview" style={glyphMaskStyle(model.url)} />;
}
