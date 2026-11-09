"use client";

import type { RefObject } from "react";
import { useEffect, useRef } from "react";

import { pageItemIds } from "@veladesk/domain";
import type { DesktopPage, DesktopPageId } from "@veladesk/domain";
import type { LayoutItemId } from "@veladesk/desktop-engine";

import { canRedo, canUndo } from "../../canvas/arrange-history";
import type { ArrangeCanvasHistories } from "../../canvas/arrange-history";
import type { PendingCanvasHandoff } from "../../canvas/canvas-handoff";
import { resolveArrangeHistoryCommand } from "../arrange-shortcuts";
import { selectAllIds } from "../selection-state";
import { EMPTY_SELECTION } from "../tile-host/use-tile-session";
import type { ContextMenuState } from "../context-menu";
import type { HomeDialog } from "./shell-context";

export interface UseDesktopShortcutsInput {
  readonly arrange: boolean;
  readonly contextMenu: ContextMenuState | null;
  readonly dialog: HomeDialog | null;
  readonly overlayFolderId: string | null;
  readonly launcherOpen: boolean;
  readonly settingsOpen: boolean;
  readonly dragging: boolean;
  readonly activePage: DesktopPage | undefined;
  readonly setLauncherOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  readonly applySelection: (next: ReadonlySet<LayoutItemId>) => void;
  readonly selectionRef: RefObject<ReadonlySet<LayoutItemId>>;
  readonly nudgeSelection: (columnStep: number, rowStep: number) => void;
  readonly applyHistoryStep: (pageId: DesktopPageId, direction: "undo" | "redo") => void;
  readonly arrangeHistoriesRef: RefObject<ArrangeCanvasHistories>;
  readonly pendingHandoffRef: RefObject<PendingCanvasHandoff | null>;
  readonly resizeLockRef: RefObject<boolean>;
  readonly pageIdRef: RefObject<DesktopPageId | null>;
  readonly draggingRef: RefObject<boolean>;
}

/**
 * The shell's GLOBAL keyboard layer (P1-ENG-1), extracted verbatim from
 * the former desktop-shell.tsx: undo/redo, select all, launcher chord,
 * Escape selection clear, arrow nudge. Global section arrows are GONE —
 * the rail owns section keyboard navigation and the right side owns real
 * vertical scrolling.
 */
export function useDesktopShortcuts(input: UseDesktopShortcutsInput): void {
  const {
    arrange,
    contextMenu,
    dialog,
    overlayFolderId,
    launcherOpen,
    settingsOpen,
    dragging,
    activePage,
    setLauncherOpen,
    applySelection,
    selectionRef,
    nudgeSelection,
    applyHistoryStep,
    arrangeHistoriesRef,
    pendingHandoffRef,
    resizeLockRef,
    pageIdRef,
    draggingRef,
  } = input;

  // Latest-value mirror: the effect binding stays on its original deps;
  // the handler always sees the current selection writer.
  const applySelectionRef = useRef(applySelection);
  useEffect(() => {
    applySelectionRef.current = applySelection;
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const inField =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      const surfaceOpen =
        contextMenu !== null ||
        dialog !== null ||
        overlayFolderId !== null ||
        launcherOpen ||
        settingsOpen;

      if (event.key === "Escape") {
        // An in-flight icon resize consumes Escape itself (cancel, no write);
        // open surfaces consume it next; otherwise it clears the selection.
        if (resizeLockRef.current) {
          return;
        }
        if (!surfaceOpen && arrange && selectionRef.current.size > 0) {
          event.preventDefault();
          applySelectionRef.current(EMPTY_SELECTION);
        }
        return;
      }

      // Launcher chord: Ctrl/Cmd+K toggles the launcher, but never steals
      // the chord from another modal surface or an in-flight drag (and the
      // launcher never nests on top of one).
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        if (launcherOpen) {
          event.preventDefault();
          setLauncherOpen(false);
          return;
        }
        if (surfaceOpen || draggingRef.current) {
          return;
        }
        event.preventDefault();
        setLauncherOpen(true);
        return;
      }

      if (inField) {
        return;
      }

      if (
        arrange &&
        !surfaceOpen &&
        !draggingRef.current &&
        !resizeLockRef.current &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey
      ) {
        const pageId = pageIdRef.current;
        // Availability comes from the imperative history map, never the
        // closure's React state — a keydown must see the freshest history.
        // A pending handoff makes undo/redo unavailable for the moment,
        // leaving the chord untouched for the browser/OS.
        const historyAvailable = pendingHandoffRef.current === null;
        const command = resolveArrangeHistoryCommand({
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          canUndo:
            pageId !== null && historyAvailable && canUndo(arrangeHistoriesRef.current, pageId),
          canRedo:
            pageId !== null && historyAvailable && canRedo(arrangeHistoriesRef.current, pageId),
        });
        if (pageId !== null && command !== null) {
          // Only a runnable command is consumed: an unavailable undo/redo
          // leaves the event untouched for the browser/OS.
          event.preventDefault();
          applyHistoryStep(pageId, command);
          return;
        }
        if (event.key.toLowerCase() === "a" && activePage !== undefined) {
          event.preventDefault();
          applySelectionRef.current(selectAllIds(new Set(pageItemIds(activePage))));
          return;
        }
      }

      const isArrow =
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown";
      if (
        isArrow &&
        arrange &&
        !surfaceOpen &&
        !draggingRef.current &&
        !resizeLockRef.current &&
        pendingHandoffRef.current === null &&
        selectionRef.current.size > 0
      ) {
        // A held key never produces extra history entries.
        if (event.repeat) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        if (event.key === "ArrowLeft") nudgeSelection(-1, 0);
        if (event.key === "ArrowRight") nudgeSelection(1, 0);
        if (event.key === "ArrowUp") nudgeSelection(0, -1);
        if (event.key === "ArrowDown") nudgeSelection(0, 1);
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [arrange, contextMenu, dialog, overlayFolderId, launcherOpen, settingsOpen, dragging, activePage, nudgeSelection, applyHistoryStep, setLauncherOpen, selectionRef, arrangeHistoriesRef, pendingHandoffRef, resizeLockRef, pageIdRef, draggingRef]);
}
