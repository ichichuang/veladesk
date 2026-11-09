"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";

import type { DesktopPageId, EntityId } from "@veladesk/domain";

/**
 * The SHELL surface contract (P1-ENG-1): session-only UI types that used to
 * live at the top of the monolithic desktop-shell.tsx, plus the typed
 * context the shell provides downward. The scene and the tile host must
 * never import each other — anything they need from the shell's authority
 * (current section, mode, reduced motion, commands) flows through here or
 * through explicit props.
 */

/** UI-only desktop mode. Session state — never persisted back to preferences. */
export type DesktopMode = "view" | "arrange";

/**
 * Which context-menu surface was opened. Presentation-only shell state.
 * The desktop command menu (empty area / rail chrome) is built by
 * `buildDesktopCommandEntries`; entities and sections get their own
 * builders from the same module.
 */
export type ContextMenuTarget =
  | {
      readonly kind: "entity";
      readonly entityId: EntityId;
      readonly source: "desktop" | "dock" | "folder";
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "section";
      readonly pageId: DesktopPageId;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "desktop";
      readonly x: number;
      readonly y: number;
    };

/** Overlay/dialog surfaces the shell can host, one at a time (plus overlay). */
export type HomeDialog =
  | { readonly kind: "add-app"; readonly pageId: DesktopPageId }
  | { readonly kind: "edit-app"; readonly entityId: EntityId }
  | { readonly kind: "edit-visual"; readonly entityId: EntityId }
  | { readonly kind: "delete-app"; readonly entityId: EntityId }
  | { readonly kind: "new-section" }
  | { readonly kind: "rename-section"; readonly pageId: DesktopPageId }
  | { readonly kind: "delete-section"; readonly pageId: DesktopPageId }
  | { readonly kind: "move-to-section"; readonly appId: EntityId }
  | { readonly kind: "rename-folder"; readonly folderId: EntityId }
  | { readonly kind: "delete-folder"; readonly folderId: EntityId };

/** One command any lower layer (scene, tile host, plugin tile) dispatches. */
export type ShellCommand =
  | { readonly kind: "switch-section"; readonly pageId: DesktopPageId; readonly animate?: boolean }
  | { readonly kind: "toggle-mode" }
  | { readonly kind: "open-dialog"; readonly dialog: HomeDialog }
  | { readonly kind: "open-context-menu"; readonly target: ContextMenuTarget }
  | { readonly kind: "open-folder"; readonly folderId: EntityId }
  | { readonly kind: "open-launcher" }
  | { readonly kind: "open-settings"; readonly backgroundSectionId?: DesktopPageId }
  | { readonly kind: "sync" };

/** What the shell provides to every layer below it. */
export interface ShellContextValue {
  /** The effective active section id. */
  readonly activeSectionId: DesktopPageId | null;
  /** The UI mode (view / arrange). */
  readonly mode: DesktopMode;
  /** The shared reduced-motion bridge. */
  readonly reducedMotion: boolean;
  /** The typed command dispatcher. */
  readonly dispatch: (command: ShellCommand) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

/**
 * Provides the shell context. The value is memoized by the shell so
 * memoized tile layers that consume the context re-render only when a
 * context field actually changes.
 */
export function ShellContextProvider({
  value,
  children,
}: {
  readonly value: ShellContextValue;
  readonly children: ReactNode;
}) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

/** Reads the shell context; throws when used outside the desktop shell. */
export function useShellContext(): ShellContextValue {
  const value = useContext(ShellContext);
  if (value === null) {
    throw new Error("useShellContext must be used inside the DesktopShell");
  }
  return value;
}

export interface UseShellContextValueInput {
  readonly activeSectionId: DesktopPageId | null;
  readonly mode: DesktopMode;
  readonly reducedMotion: boolean;
  /** Command implementations, composed by the shell from its layers. */
  readonly switchSection: (
    pageId: DesktopPageId,
    options?: { readonly animate?: boolean }
  ) => void;
  readonly switchMode: (next: DesktopMode) => void;
  readonly openDialog: (dialog: HomeDialog) => void;
  readonly openContextMenu: (target: ContextMenuTarget) => void;
  readonly openFolderOverlay: (folderId: EntityId) => void;
  readonly setLauncherOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  readonly openSettings: () => void;
  readonly openSectionBackgroundSettings: (pageId: DesktopPageId) => void;
  readonly syncCurrent: () => void;
}

/**
 * Builds the memoized shell-context value with its typed dispatcher
 * (P1-ENG-1). The dispatch closure is mirrored through a ref from an
 * every-render effect, so the context value itself stays referentially
 * stable between actual section/mode/reduced-motion changes while the
 * dispatcher always runs the latest implementations.
 */
export function useShellContextValue(input: UseShellContextValueInput): ShellContextValue {
  const {
    activeSectionId,
    mode,
    reducedMotion,
    switchSection,
    switchMode,
    openDialog,
    openContextMenu,
    openFolderOverlay,
    setLauncherOpen,
    openSettings,
    openSectionBackgroundSettings,
    syncCurrent,
  } = input;

  const dispatchRef = useRef<(command: ShellCommand) => void>(() => {});
  const dispatch = useCallback((command: ShellCommand) => {
    dispatchRef.current(command);
  }, []);
  useEffect(() => {
    dispatchRef.current = (command) => {
      switch (command.kind) {
        case "switch-section":
          switchSection(
            command.pageId,
            command.animate !== undefined ? { animate: command.animate } : undefined
          );
          return;
        case "toggle-mode":
          switchMode(mode === "arrange" ? "view" : "arrange");
          return;
        case "open-dialog":
          openDialog(command.dialog);
          return;
        case "open-context-menu":
          openContextMenu(command.target);
          return;
        case "open-folder":
          openFolderOverlay(command.folderId);
          return;
        case "open-launcher":
          setLauncherOpen(true);
          return;
        case "open-settings":
          if (command.backgroundSectionId !== undefined) {
            openSectionBackgroundSettings(command.backgroundSectionId);
          } else {
            openSettings();
          }
          return;
        case "sync":
          syncCurrent();
          return;
      }
    };
  });

  return useMemo<ShellContextValue>(
    () => ({
      activeSectionId,
      mode,
      reducedMotion,
      dispatch,
    }),
    [activeSectionId, mode, reducedMotion, dispatch]
  );
}
