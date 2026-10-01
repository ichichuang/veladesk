"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import {
  ICON_PICKER_DEBOUNCE_MS,
  ICON_PICKER_SCOPES,
  appendIconPickerPage,
  buildIconSearchUrl,
  collectionsForScope,
  decodeIconSearchPage,
  scopeMessageKey,
} from "./icon-picker-model";
import type { IconPickerEntry } from "./icon-picker-model";
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
 * Paging: filters always reset to offset 0 and replace the results, while
 * "load more" APPENDS the next page (deduped by id) until `nextOffset` is
 * null. Every request carries a generation token, so a slow response from an
 * abandoned query can never overwrite the current grid; a failed page keeps
 * the results already on screen and offers a retry.
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
  const [scope, setScope] = useState<IconSearchScope>("recommended");
  const [collection, setCollection] = useState<IconCollectionId | null>(null);
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerResults | null>(null);
  const [append, setAppend] = useState<AppendProgress | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** Bumped whenever the filters change; stale responses are dropped. */
  const generationRef = useRef(0);

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

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let cancelled = false;
    window
      .fetch(baseUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`icon search failed (${response.status})`);
        }
        return response.json() as unknown;
      })
      .then((body) => {
        if (cancelled || generationRef.current !== generation) {
          return;
        }
        const decoded = decodeIconSearchPage(body);
        setResults(
          decoded === undefined
            ? { key: baseUrl, entries: [], total: 0, nextOffset: null, failed: true }
            : { key: baseUrl, ...decoded, failed: false }
        );
      })
      .catch(() => {
        if (cancelled || generationRef.current !== generation) {
          return;
        }
        setResults({ key: baseUrl, entries: [], total: 0, nextOffset: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  // Results and append progress only apply to the URL currently requested —
  // a leftover from an abandoned query is invisible by derivation.
  const current = results !== null && results.key === baseUrl ? results : null;
  const entries = current?.entries ?? [];
  const failed = current?.failed === true;
  const nextOffset = current?.nextOffset ?? null;
  const visible = current !== null && !failed;
  const loadingFirstPage = current === null && !failed;
  const appendState = append !== null && append.key === baseUrl ? append : null;
  const appending = appendState?.busy === true;
  const appendFailed = appendState?.failed === true;

  const loadMore = useCallback(() => {
    const offset = results !== null && results.key === baseUrl ? results.nextOffset : null;
    if (offset === null || appending) {
      return;
    }
    const generation = generationRef.current;
    setAppend({ key: baseUrl, busy: true, failed: false });
    window
      .fetch(buildIconSearchUrl({ query, scope, collection, offset }))
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`icon search failed (${response.status})`);
        }
        return response.json() as unknown;
      })
      .then((body) => {
        if (generationRef.current !== generation) {
          return;
        }
        const decoded = decodeIconSearchPage(body);
        if (decoded === undefined) {
          setAppend({ key: baseUrl, busy: false, failed: true });
          return;
        }
        setResults((previous) =>
          previous === null || previous.key !== baseUrl
            ? previous
            : {
                ...previous,
                entries: appendIconPickerPage(previous.entries, decoded.entries),
                total: decoded.total,
                nextOffset: decoded.nextOffset,
              }
        );
        setAppend({ key: baseUrl, busy: false, failed: false });
      })
      .catch(() => {
        if (generationRef.current === generation) {
          setAppend({ key: baseUrl, busy: false, failed: true });
        }
      });
  }, [appending, baseUrl, collection, query, results, scope]);

  function chooseScope(next: IconSearchScope) {
    setScope(next);
    // A source outside the new scope can only return an empty grid.
    setCollection(null);
  }

  const sourceOptions = collectionsForScope(scope);

  return (
    <div className="vela-icon-picker" data-testid="icon-picker">
      <TextField value={rawQuery} onChange={setRawQuery} aria-label={t("iconPicker.searchLabel")}>
        <Label className="sr-only">{t("iconPicker.searchLabel")}</Label>
        <Input
          ref={inputRef}
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
          shared quiet scrollbar. */}
      <VdScrollArea
        axis="y"
        className="vela-icon-picker__scroll"
        data-vd-wheel-scope="local"
      >
        <div className="vela-icon-picker__grid">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="vela-icon-picker__cell"
              data-selected={entry.id === selectedId ? "true" : undefined}
              aria-label={`${entry.label} · ${findIconCollection(entry.collection)?.label ?? entry.collection}`}
              title={entry.label}
              onClick={() => onSelect(entry.id)}
            >
              <IconPreview iconId={entry.id} />
            </button>
          ))}
        </div>
      </VdScrollArea>
      <div className="vela-icon-picker__footer">
        {visible && entries.length === 0 ? (
          <span className="vela-icon-picker__note">{t("iconPicker.noResults")}</span>
        ) : null}
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
      </div>
    </div>
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
      />
    );
  }
  return <span className="vela-icon-picker__preview" style={glyphMaskStyle(model.url)} />;
}
