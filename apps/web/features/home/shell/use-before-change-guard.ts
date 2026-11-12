"use client";

import type { RefObject } from "react";
import { useEffect } from "react";

import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";

import type { PendingCanvasHandoff } from "../../canvas/canvas-handoff";
import type { HomeDialog } from "./shell-context";
import type { TranslateFn } from "../../i18n/use-i18n";

/**
 * The shell's before-workspace-change guard (P1-ENG-1), extracted verbatim
 * from the former desktop-shell.tsx: while a drag, a resize, a dialog or
 * Settings owns the desktop, a workspace switch waits; an in-flight layout
 * commit queue is drained first; a pending display handoff counts as
 * unsaved geometry.
 *
 * t129: the guard is also the LAST moment the outgoing workspace's DOM is
 * still mounted — the runtime publishes the switch right after it, and the
 * keyed shell remount detaches the section scrollers before any unmount
 * cleanup could read them. `captureActiveScroll` (the scene's DOM scroll
 * capture) therefore runs FIRST, so the active section's live scrollTop
 * reaches the view-state controller before the tree goes away — switching
 * workspaces and coming back resumes exactly where the user left off.
 */
export function useBeforeWorkspaceChangeGuard({
  runtime,
  dialog,
  settingsOpen,
  t,
  draggingRef,
  resizeLockRef,
  layoutQueueRef,
  pendingHandoffRef,
  captureActiveScroll,
}: {
  readonly runtime: WorkspaceClientRuntime;
  readonly dialog: HomeDialog | null;
  readonly settingsOpen: boolean;
  readonly t: TranslateFn;
  readonly draggingRef: RefObject<boolean>;
  readonly resizeLockRef: RefObject<boolean>;
  readonly layoutQueueRef: RefObject<Promise<void>>;
  readonly pendingHandoffRef: RefObject<PendingCanvasHandoff | null>;
  readonly captureActiveScroll?: (() => void) | null;
}): void {
  useEffect(() => runtime.registerBeforeWorkspaceChange?.(async () => {
    // While the outgoing DOM is still alive: record the live scroll of the
    // section the user is leaving ON (even a refused switch may still have
    // scrolled — capturing is always safe and idempotent).
    captureActiveScroll?.();
    if (draggingRef.current || resizeLockRef.current || dialog !== null || settingsOpen) {
      return t("workspace.error.editing");
    }
    await layoutQueueRef.current;
    if (pendingHandoffRef.current !== null) return t("workspace.error.unsaved");
    return null;
  }), [runtime, dialog, settingsOpen, t, draggingRef, resizeLockRef, layoutQueueRef, pendingHandoffRef, captureActiveScroll]);
}
