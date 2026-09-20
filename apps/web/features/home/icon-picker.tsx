"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { useI18n } from "../i18n/use-i18n";
import {
  ICON_PICKER_DEBOUNCE_MS,
  ICON_PICKER_TABS,
  buildIconSearchUrl,
  decodeIconSearchResponse,
} from "./icon-picker-model";
import type { IconPickerEntry, IconPickerTab } from "./icon-picker-model";
import { parseIconifyIconId, iconSvgUrl } from "./app-icon";
import "./home-shell.css";

/**
 * Icon Catalog picker (task 016-A): search field, collection tabs and a
 * scrollable grid of every bundled icon.
 *
 * All data comes from the self-hosted `/api/v1/icons/search` endpoint —
 * the component never talks to any other host. The result grid is a local
 * scroll surface (`data-vd-wheel-scope="local"`) so wheeling through icons
 * never pages the section stack underneath. Keyboard: the search field
 * takes focus on open, results are plain buttons (Tab + Enter/Space).
 */

interface IconPickerProps {
  /** The currently selected library icon id, if any. */
  readonly selectedId: string | null;
  readonly onSelect: (iconId: string) => void;
}

export function IconPicker({ selectedId, onSelect }: IconPickerProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<IconPickerTab>("all");
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  /**
   * The last SETTLED response, tagged with the URL it came from. Renders
   * derive visibility (stale results never show) instead of resetting
   * state inside the effect.
   */
  const [settled, setSettled] = useState<{
    readonly url: string;
    readonly entries: IconPickerEntry[] | null;
    readonly failed: boolean;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Debounced query (spec: ~120–180ms).
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(rawQuery), ICON_PICKER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [rawQuery]);

  // Focus the search field once on open.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const url = useMemo(
    () => buildIconSearchUrl({ query, tab }),
    [query, tab]
  );

  useEffect(() => {
    let cancelled = false;
    window
      .fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`icon search failed (${response.status})`);
        }
        return response.json() as unknown;
      })
      .then((body) => {
        if (cancelled) {
          return;
        }
        const decoded = decodeIconSearchResponse(body);
        setSettled(
          decoded === undefined
            ? { url, entries: null, failed: true }
            : { url, entries: decoded, failed: false }
        );
      })
      .catch(() => {
        if (!cancelled) {
          setSettled({ url, entries: null, failed: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const current = settled !== null && settled.url === url ? settled : null;
  const results = current?.entries ?? null;
  const failed = current?.failed === true;

  return (
    <div className="vela-icon-picker" data-testid="icon-picker">
      <input
        ref={inputRef}
        className="vela-input vela-icon-picker__search"
        type="text"
        value={rawQuery}
        maxLength={100}
        placeholder={t("iconPicker.searchPlaceholder")}
        aria-label={t("iconPicker.searchLabel")}
        onChange={(event) => setRawQuery(event.target.value)}
      />
      <div className="vela-icon-picker__tabs" role="tablist" aria-label={t("iconPicker.collections")}>
        {ICON_PICKER_TABS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={candidate === tab}
            className="vela-icon-picker__tab"
            onClick={() => setTab(candidate)}
          >
            {describeTab(candidate, t)}
          </button>
        ))}
      </div>
      {tab === "simple-icons" ? (
        <p className="vela-icon-picker__note">{t("iconPicker.brandsNote")}</p>
      ) : null}
      {failed ? (
        <p className="vela-form__error" role="alert">
          {t("iconPicker.loadFailed")}
        </p>
      ) : null}
      <div className="vela-icon-picker__grid" data-vd-wheel-scope="local">
        {(results ?? []).map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="vela-icon-picker__cell"
            data-selected={entry.id === selectedId ? "true" : undefined}
            aria-label={`${entry.label} · ${describeTab(entry.collection as IconPickerTab, t)}`}
            title={entry.label}
            onClick={() => onSelect(entry.id)}
          >
            <IconPreview iconId={entry.id} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Tab display names, localized (brands first per the catalog order). */
function describeTab(
  tab: IconPickerTab,
  t: ReturnType<typeof useI18n>["t"]
): string {
  switch (tab) {
    case "all":
      return t("iconPicker.tab.all");
    case "simple-icons":
      return t("iconPicker.tab.brands");
    case "lucide":
      return "Lucide";
    case "tabler":
      return "Tabler";
    case "ph":
      return "Phosphor";
  }
}

/**
 * One icon preview: the self-hosted SVG through a CSS mask, tinted with
 * the picker's foreground color. No <img>, no innerHTML, no third-party
 * host — the URL is built from validated catalog ids only.
 */
export function IconPreview({ iconId }: { iconId: string }) {
  const parsed = parseIconifyIconId(iconId);
  const url = parsed === undefined ? undefined : iconSvgUrl(parsed.collection, parsed.name);
  const maskStyle: CSSProperties | undefined =
    url === undefined
      ? undefined
      : {
          WebkitMaskImage: `url("${url}")`,
          maskImage: `url("${url}")`,
          WebkitMaskSize: "contain",
          maskSize: "contain",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
        };
  return <span className="vela-icon-picker__preview" style={maskStyle} />;
}
