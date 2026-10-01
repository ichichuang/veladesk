"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Folder, LayoutGrid } from "lucide-react";
import type {
  AppShortcut,
  DesktopPageId,
  EntityId,
  WorkspaceSnapshot,
} from "@veladesk/domain";

import {
  buildLauncherEntries,
} from "../launcher-index";
import {
  LAUNCHER_MAX_RESULTS,
  searchLauncherEntries,
} from "../launcher-search";
import { moveLauncherIndex } from "../launcher-navigation";
import { AppIconGlyph, appIconDecorationProps } from "../app-icon-renderer";
import { useI18n } from "../../i18n/use-i18n";
import { MobileSheet } from "./mobile-sheet";
import "./mobile-shell.css";

/** Shared by every closed render — the index is never built while closed. */
const EMPTY_SEARCH_ENTRIES: readonly never[] = [];

/**
 * Mobile search (task 026 §33–§37): the consumption counterpart of the
 * desktop launcher — a fullscreen surface with the query field up top and
 * large touch rows.
 *
 * The SEARCH MODEL is the desktop launcher's, shared verbatim (§35):
 * `buildLauncherEntries` (with commands excluded — consumption-only, §34)
 * + `searchLauncherEntries` ranking + `moveLauncherIndex` keyboard
 * semantics. Only the presentation is mobile. Activation is delegated;
 * the caller resolves entities against the live snapshot.
 */
export function MobileSearch({
  open,
  onOpenChange,
  workspace,
  activePageId,
  onOpenApp,
  onOpenFolder,
  onSelectSection,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly workspace: WorkspaceSnapshot;
  readonly activePageId: DesktopPageId | null;
  readonly onOpenApp: (app: AppShortcut) => void;
  readonly onOpenFolder: (folderId: EntityId) => void;
  readonly onSelectSection: (pageId: DesktopPageId) => void;
}) {
  const { locale, t } = useI18n();
  const [query, setQuery] = useState("");
  const [requestedIndex, setRequestedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openRef = useRef(false);

  // The index follows the live entries; the search model is the launcher's.
  // The index follows the live entries ONLY while the surface is open
  // (R2 §19/H5): a category switch with search closed was a proven
  // irrelevant rebuild of the full launcher index — the memo factory now
  // returns a shared empty list instead of building.
  const entries = useMemo(
    () =>
      open
        ? buildLauncherEntries({
            workspace,
            activePageId,
            mode: "view",
            syncState: "clean",
            locale,
            includeCommands: false,
          })
        : EMPTY_SEARCH_ENTRIES,
    [open, workspace, activePageId, locale],
  );
  const results = useMemo(
    () => searchLauncherEntries(entries, query).slice(0, LAUNCHER_MAX_RESULTS),
    [entries, query],
  );
  const activeIndex = Math.min(requestedIndex, results.length - 1);

  // Opening resets the session and focuses the field (16px input — no iOS
  // auto-zoom, §36); closing restores focus to the opener (Radix returns
  // focus to the element focused at open — the header Search button).
  useEffect(() => {
    if (open && !openRef.current) {
      setQuery("");
      setRequestedIndex(0);
      inputRef.current?.focus();
    }
    openRef.current = open;
  }, [open]);

  function activate(index: number): void {
    const entry = results[index];
    if (entry === undefined) {
      return;
    }
    onOpenChange(false);
    switch (entry.kind) {
      case "app": {
        const app = workspace.entities.find(
          (candidate): candidate is AppShortcut =>
            candidate.kind === "app" && candidate.id === entry.entityId,
        );
        if (app !== undefined) {
          onOpenApp(app);
        }
        return;
      }
      case "folder":
        onOpenFolder(entry.entityId);
        return;
      case "page":
        onSelectSection(entry.pageId);
        return;
      case "command":
        // Commands never exist in the mobile index (includeCommands:false);
        // unreachable by construction.
        return;
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setRequestedIndex(moveLauncherIndex({ currentIndex: activeIndex, resultCount: results.length, direction: "next" }));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setRequestedIndex(moveLauncherIndex({ currentIndex: activeIndex, resultCount: results.length, direction: "previous" }));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      activate(activeIndex);
      return;
    }
  }

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      variant="fullscreen"
      label={t("mobile.search.title")}
      showCloseButton={false}
    >
      <div className="vela-mobile-search__bar">
        <input
          ref={inputRef}
          type="search"
          role="searchbox"
          className="vela-mobile-search__input"
          aria-label={t("mobile.search.title")}
          placeholder={t("mobile.search.placeholder")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setRequestedIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="vela-mobile-sheet__body">
        {results.length === 0 ? (
          <p className="vela-mobile-search__empty">{t("mobile.search.empty")}</p>
        ) : (
          <div role="listbox" aria-label={t("mobile.search.resultsLabel")}>
            {results.map((entry, index) => {
              const icon =
                entry.kind === "app" ? (
                  (() => {
                    const app = workspace.entities.find(
                      (candidate): candidate is AppShortcut =>
                        candidate.kind === "app" && candidate.id === entry.entityId,
                    );
                    if (app === undefined) {
                      return <LayoutGrid size={18} aria-hidden="true" />;
                    }
                    return (
                      <span
                        className="vela-app-icon vela-mobile-search__app-icon"
                        {...appIconDecorationProps(app)}
                      >
                        <AppIconGlyph app={app} />
                      </span>
                    );
                  })()
                ) : entry.kind === "folder" ? (
                  <Folder size={20} aria-hidden="true" />
                ) : (
                  <LayoutGrid size={20} aria-hidden="true" />
                );
              const kindLabel =
                entry.kind === "app"
                  ? t("launcher.kind.app")
                  : entry.kind === "folder"
                    ? t("launcher.kind.folder")
                    : t("launcher.kind.page");
              return (
                <button
                  key={entry.key}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex ? "true" : "false"}
                  data-active={index === activeIndex ? "true" : "false"}
                  className="vela-mobile-search__row"
                  onClick={() => activate(index)}
                  onPointerDown={() => setRequestedIndex(index)}
                >
                  <span className="vela-mobile-search__row-icon">{icon}</span>
                  <span className="vela-mobile-search__row-label">{entry.label}</span>
                  <span className="vela-mobile-search__row-kind">{kindLabel}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </MobileSheet>
  );
}
