"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import {
  CloudUpload,
  Eye,
  Folder,
  LayoutGrid,
  Plus,
  Settings,
  SquarePlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AppShortcut, EntityId } from "@veladesk/domain";

import { VdScrollArea } from "@components/vd/scroll-area";
import { useVdPresence } from "@components/vd/presence";
import { VdAnimatedSurface } from "@components/vd/animated-surface";

import { AppIconGlyph, appIconDecorationProps } from "./app-icon-renderer";
import { flattenLauncherGroups, groupLauncherResults } from "./launcher-groups";
import type { LauncherGroupKind } from "./launcher-groups";
import { generatedIconText } from "./generated-icon";
import { moveLauncherIndex } from "./launcher-navigation";
import { LAUNCHER_MAX_RESULTS, searchLauncherEntries } from "./launcher-search";
import type { LauncherCommandId, LauncherEntry } from "./launcher-types";
import type { TranslationKey } from "../i18n/messages";
import { useI18n } from "../i18n/use-i18n";
import "./home-shell.css";

const LISTBOX_ID = "vela-launcher-listbox";

function optionId(index: number): string {
  return `vela-launcher-option-${index}`;
}

function groupHeadingId(kind: LauncherGroupKind): string {
  return `vela-launcher-group-${kind}`;
}

const KIND_LABEL_KEY: Readonly<Record<LauncherEntry["kind"], TranslationKey>> = {
  app: "launcher.kind.app",
  folder: "launcher.kind.folder",
  page: "launcher.kind.page",
  command: "launcher.kind.command",
};

const GROUP_LABEL_KEY: Readonly<Record<LauncherGroupKind, TranslationKey>> = {
  command: "launcher.group.commands",
  app: "launcher.group.apps",
  folder: "launcher.group.folders",
  page: "launcher.group.sections",
};

const COMMAND_ICON: Readonly<Record<LauncherCommandId, LucideIcon>> = {
  "add-app": Plus,
  "new-section": SquarePlus,
  "open-settings": Settings,
  "toggle-mode": Eye,
  "sync-current": CloudUpload,
};

/** Row icon for section and folder results: quiet leading identity. */
const KIND_SYMBOL: Readonly<Record<"folder" | "page", LucideIcon>> = {
  folder: Folder,
  page: LayoutGrid,
};

interface LauncherProps {
  /** Requested visibility; the launcher stays mounted through its exit. */
  readonly open: boolean;
  readonly entries: readonly LauncherEntry[];
  /**
   * The live apps by id — the icon path for app results is the SHARED
   * renderer (catalog / generated / asset, task 016), never a launcher
   * private implementation. A missing id (entity deleted mid-session)
   * degrades to generated initials, never to a technical id.
   */
  readonly appsById: ReadonlyMap<EntityId, AppShortcut>;
  readonly onActivate: (entry: LauncherEntry) => void;
  readonly onClose: () => void;
}

/**
 * The workspace launcher (redesigned in task 021-B): a fullscreen modal
 * surface with an upper-center panel — fixed search field, grouped results
 * (Commands / Apps / Folders / Sections) in one scroll area, fixed keyboard
 * hints. Only the results scroll.
 *
 * Owns only session state (query + active index); activation is delegated
 * to `onActivate`, closing to `onClose`. The input keeps focus at all
 * times (combobox pattern): results move via aria-activedescendant, never
 * via focus. Search, ranking and keyboard semantics are the pure modules —
 * the redesign is presentation only. Opening captures the focused element
 * and restores focus to it on close.
 */
export function Launcher({ open, entries, appsById, onActivate, onClose }: LauncherProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [requestedIndex, setRequestedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  // Presence (022): open-driven surface; the exit keeps the search text
  // and results stable while fading, and focus restores only at the final
  // release — once.
  const presence = useVdPresence(open);

  // Opening: fresh search state (the old remount semantics), capture the
  // opener, focus the input. Closing: restore focus to the opener exactly
  // once, when presence releases — never while the exit is still playing.
  const openerCapturedRef = useRef(false);
  useEffect(() => {
    if (presence.mounted && !openerCapturedRef.current) {
      openerCapturedRef.current = true;
      openerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery("");
      setRequestedIndex(0);
      inputRef.current?.focus();
    }
    if (!presence.mounted && openerCapturedRef.current) {
      openerCapturedRef.current = false;
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
      openerRef.current = null;
    }
  }, [presence.mounted]);

  const results = useMemo(
    () => searchLauncherEntries(entries, query).slice(0, LAUNCHER_MAX_RESULTS),
    [entries, query],
  );

  // Presentation grouping of the ranked list (021-B): within a group the
  // ranking order is untouched, groups have a fixed priority, and the flat
  // concatenation below is the keyboard index space — what is visually
  // adjacent is what ArrowUp/ArrowDown walks.
  const grouped = useMemo(() => groupLauncherResults(results), [results]);
  const { flatResults, flatIndexByKey } = useMemo(() => {
    const flat = flattenLauncherGroups(grouped);
    return {
      flatResults: flat,
      flatIndexByKey: new Map(flat.map((entry, index) => [entry.key, index] as const)),
    };
  }, [grouped]);

  // The active index is derived, so it can never go stale: when the
  // snapshot shrinks the entry list while the launcher is open (a sync
  // or edit landing mid-search), the active result normalizes instead of
  // pointing at a deleted entry.
  const activeIndex =
    flatResults.length === 0 ? -1 : Math.min(requestedIndex, flatResults.length - 1);

  useEffect(() => {
    if (activeIndex < 0) {
      return;
    }
    listRef.current
      ?.querySelector(`#${CSS.escape(optionId(activeIndex))}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, flatResults]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    // IME composition is never navigation.
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "k"
    ) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      case "ArrowDown":
        event.preventDefault();
        setRequestedIndex((current) =>
          moveLauncherIndex({
            currentIndex: current,
            resultCount: flatResults.length,
            direction: "next",
          }),
        );
        return;
      case "ArrowUp":
        event.preventDefault();
        setRequestedIndex((current) =>
          moveLauncherIndex({
            currentIndex: current,
            resultCount: flatResults.length,
            direction: "previous",
          }),
        );
        return;
      case "Home":
        event.preventDefault();
        setRequestedIndex((current) =>
          moveLauncherIndex({
            currentIndex: current,
            resultCount: flatResults.length,
            direction: "first",
          }),
        );
        return;
      case "End":
        event.preventDefault();
        setRequestedIndex((current) =>
          moveLauncherIndex({
            currentIndex: current,
            resultCount: flatResults.length,
            direction: "last",
          }),
        );
        return;
      case "Enter": {
        event.preventDefault();
        const entry = flatResults[activeIndex];
        if (entry !== undefined) {
          onActivate(entry);
        }
        return;
      }
    }
  }

  function handleBackdropMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  if (!presence.mounted) {
    return null;
  }

  return (
    <VdAnimatedSurface
      variant="overlay"
      active={open}
      onPresenceReleased={presence.completeExit}
      className="vela-launcher-backdrop"
      data-testid="launcher-backdrop"
      inert={open ? undefined : true}
      onMouseDown={handleBackdropMouseDown}
    >
      <VdAnimatedSurface
        variant="launcher"
        active={open}
        onPresenceReleased={presence.completeExit}
        className="vela-launcher"
        role="dialog"
        aria-modal="true"
        aria-label={t("launcher.dialogLabel")}
      >
        {/* Fixed search header — never scrolls away with long result sets. */}
        <input
          ref={inputRef}
          className="vela-launcher__input"
          role="combobox"
          aria-expanded="true"
          aria-controls={LISTBOX_ID}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-label={t("launcher.dialogLabel")}
          autoComplete="off"
          spellCheck={false}
          placeholder={t("launcher.placeholder")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setRequestedIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
        {/* The one scroll region: results only (VdScrollArea, 021-A). */}
        <VdScrollArea
          axis="y"
          className="vela-launcher__results-scroll"
          data-vd-wheel-scope="local"
        >
          <div
            id={LISTBOX_ID}
            className="vela-launcher__results"
            role="listbox"
            aria-label={t("launcher.dialogLabel")}
            ref={listRef}
          >
            {grouped.map((group) => (
              <div
                key={group.kind}
                className="vela-launcher__group"
                role="group"
                aria-labelledby={groupHeadingId(group.kind)}
              >
                <div
                  id={groupHeadingId(group.kind)}
                  className="vela-launcher__group-label"
                >
                  {t(GROUP_LABEL_KEY[group.kind])}
                </div>
                {group.entries.map((entry) => {
                  const index = flatIndexByKey.get(entry.key);
                  if (index === undefined) {
                    return null;
                  }
                  return (
                    <LauncherOption
                      key={entry.key}
                      entry={entry}
                      index={index}
                      active={index === activeIndex}
                      app={entry.kind === "app" ? appsById.get(entry.entityId) : undefined}
                      label={entry.label}
                      kindLabel={t(KIND_LABEL_KEY[entry.kind])}
                      onHover={() => setRequestedIndex(index)}
                      onActivate={() => onActivate(entry)}
                    />
                  );
                })}
              </div>
            ))}
            {flatResults.length === 0 ? (
              <p className="vela-launcher__empty">{t("launcher.noMatches")}</p>
            ) : null}
          </div>
        </VdScrollArea>
        {/* Fixed footer hints. */}
        <footer className="vela-launcher__footer" aria-hidden="true">
          <span>{t("launcher.hintNavigate")}</span>
          <span>{t("launcher.hintOpen")}</span>
          <span>{t("launcher.hintClose")}</span>
        </footer>
      </VdAnimatedSurface>
    </VdAnimatedSurface>
  );
}

interface LauncherOptionProps {
  readonly entry: LauncherEntry;
  readonly index: number;
  readonly active: boolean;
  /** The live app entity for icon rendering; undefined → initials fallback. */
  readonly app: AppShortcut | undefined;
  readonly label: string;
  readonly kindLabel: string;
  readonly onHover: () => void;
  readonly onActivate: () => void;
}

/**
 * One result row (021-B): shared-icon leading identity, main text, quiet
 * right-aligned type metadata. Keyboard addressing stays on the listbox —
 * rows are `role="option"` targets via aria-activedescendant.
 */
function LauncherOption({
  entry,
  index,
  active,
  app,
  label,
  kindLabel,
  onHover,
  onActivate,
}: LauncherOptionProps) {
  return (
    <button
      type="button"
      id={optionId(index)}
      role="option"
      aria-selected={active}
      className="vela-launcher__option"
      data-active={active ? "true" : undefined}
      onMouseEnter={onHover}
      onClick={onActivate}
    >
      <RowIdentity entry={entry} app={app} label={label} />
      <span className="vela-launcher__label">{label}</span>
      <span className="vela-launcher__kind">{kindLabel}</span>
    </button>
  );
}

/** The leading identity of a row: shared app tile, or a quiet symbol. */
function RowIdentity({
  entry,
  app,
  label,
}: {
  readonly entry: LauncherEntry;
  readonly app: AppShortcut | undefined;
  readonly label: string;
}) {
  if (entry.kind === "app") {
    if (app === undefined) {
      // Entity vanished mid-session (sync landing): generated initials on
      // the shared tile — never a technical id.
      return (
        <span className="vela-launcher__icon vela-app-icon" data-decoration="solid" aria-hidden="true">
          <span className="vela-app-icon__text">{generatedIconText(label)}</span>
        </span>
      );
    }
    return (
      <span
        className="vela-launcher__icon vela-app-icon"
        aria-hidden="true"
        {...appIconDecorationProps(app)}
      >
        <AppIconGlyph app={app} />
      </span>
    );
  }
  const Symbol = entry.kind === "command" ? COMMAND_ICON[entry.commandId] : KIND_SYMBOL[entry.kind];
  return (
    <span className="vela-launcher__symbol" aria-hidden="true">
      <Symbol size={16} />
    </span>
  );
}
