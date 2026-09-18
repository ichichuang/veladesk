"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";

import { moveLauncherIndex } from "./launcher-navigation";
import { LAUNCHER_MAX_RESULTS, searchLauncherEntries } from "./launcher-search";
import type { LauncherEntry } from "./launcher-types";
import "./home-shell.css";

const LISTBOX_ID = "vela-launcher-listbox";

function optionId(index: number): string {
  return `vela-launcher-option-${index}`;
}

function kindLabel(entry: LauncherEntry): string {
  switch (entry.kind) {
    case "app":
      return "App";
    case "folder":
      return "Folder";
    case "page":
      return "Page";
    case "command":
      return "Command";
  }
}

interface LauncherProps {
  readonly entries: readonly LauncherEntry[];
  readonly onActivate: (entry: LauncherEntry) => void;
  readonly onClose: () => void;
}

/**
 * The workspace launcher: a fullscreen modal surface with an
 * upper-center glass panel — search input, result listbox, keyboard
 * hints.
 *
 * Owns only session state (query + active index); activation is
 * delegated to `onActivate`, closing to `onClose`. The input keeps
 * focus at all times (combobox pattern): results move via
 * aria-activedescendant, never via focus. Opening captures the focused
 * element and restores focus to it on close.
 */
export function Launcher({ entries, onActivate, onClose }: LauncherProps) {
  const [query, setQuery] = useState("");
  const [requestedIndex, setRequestedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Autofocus the query input and remember the opener for focus restore.
  useEffect(() => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);

  const results = useMemo(
    () => searchLauncherEntries(entries, query).slice(0, LAUNCHER_MAX_RESULTS),
    [entries, query],
  );

  // The active index is derived, so it can never go stale: when the
  // snapshot shrinks the entry list while the launcher is open (a sync
  // or edit landing mid-search), the active result normalizes instead of
  // pointing at a deleted entry.
  const activeIndex =
    results.length === 0 ? -1 : Math.min(requestedIndex, results.length - 1);

  useEffect(() => {
    if (activeIndex < 0) {
      return;
    }
    listRef.current
      ?.querySelector(`#${CSS.escape(optionId(activeIndex))}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, results]);

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
            resultCount: results.length,
            direction: "next",
          }),
        );
        return;
      case "ArrowUp":
        event.preventDefault();
        setRequestedIndex((current) =>
          moveLauncherIndex({
            currentIndex: current,
            resultCount: results.length,
            direction: "previous",
          }),
        );
        return;
      case "Home":
        event.preventDefault();
        setRequestedIndex((current) =>
          moveLauncherIndex({
            currentIndex: current,
            resultCount: results.length,
            direction: "first",
          }),
        );
        return;
      case "End":
        event.preventDefault();
        setRequestedIndex((current) =>
          moveLauncherIndex({
            currentIndex: current,
            resultCount: results.length,
            direction: "last",
          }),
        );
        return;
      case "Enter": {
        event.preventDefault();
        const entry = results[activeIndex];
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

  return (
    <div className="vela-launcher-backdrop" onMouseDown={handleBackdropMouseDown}>
      <section
        className="vela-launcher"
        role="dialog"
        aria-modal="true"
        aria-label="Search workspace"
      >
        <input
          ref={inputRef}
          className="vela-launcher__input"
          role="combobox"
          aria-expanded="true"
          aria-controls={LISTBOX_ID}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-label="Search workspace"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search apps, folders, pages and commands…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setRequestedIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
        <div id={LISTBOX_ID} className="vela-launcher__results" role="listbox" ref={listRef}>
          {results.map((entry, index) => (
            <button
              key={entry.key}
              type="button"
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              className="vela-launcher__option"
              data-active={index === activeIndex ? "true" : undefined}
              onMouseEnter={() => setRequestedIndex(index)}
              onClick={() => onActivate(entry)}
            >
              <span className="vela-launcher__label">{entry.label}</span>
              <span className="vela-launcher__kind">{kindLabel(entry)}</span>
            </button>
          ))}
          {results.length === 0 ? <p className="vela-launcher__empty">No matches</p> : null}
        </div>
        <footer className="vela-launcher__footer" aria-hidden="true">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </footer>
      </section>
    </div>
  );
}
