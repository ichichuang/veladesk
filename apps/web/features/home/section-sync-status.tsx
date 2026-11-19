"use client";

import { useEffect, useState } from "react";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceRuntimeRemoteResult } from "@veladesk/client-runtime";

import { VdAnimatedSurface } from "@components/vd/animated-surface";
import { useVdPresence } from "@components/vd/presence";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useI18n } from "../i18n/use-i18n";
import "./home-shell.css";

interface SectionSyncStatusProps {
  readonly workspace: LocalWorkspaceRecord;
  readonly lastRemoteResult?: WorkspaceRuntimeRemoteResult | undefined;
}

/**
 * The quiet global sync whisper (task 017): bottom-left of the right
 * workspace, no longer part of the section rail.
 *
 * A clean workspace renders NOTHING — sync state is not a permanent
 * fixture. dirty → 待同步 (click syncs), dirty + network/server failure →
 * the OFFLINE badge (UX-11: prominent, readable, actionable — an
 * accent-wash pill whose click retries the sync immediately, with the
 * explanation in its accessible name), conflict → 冲突 (display only;
 * conflicts are never re-sent or auto-resolved in this stage).
 *
 * Audit A2: the badge ENTERS and LEAVES through the popup pose (a state
 * change is not an alarm), and the dirty/offline/conflict flips ease in
 * CSS on the motion tokens. One element shape for all three states, so
 * the data-state re-styling never remounts mid-life.
 *
 * Recovering the connection hides the badge by itself (UX-11): the
 * browser's `online` event triggers ONE reconciliation attempt, and a
 * successful sync leaves the workspace clean — the badge simply never
 * renders again. An `online` that cannot actually reach the server keeps
 * the badge; honest state over optimistic hiding.
 */
export function SectionSyncStatus({ workspace, lastRemoteResult }: SectionSyncStatusProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const { syncState } = workspace;
  const offline =
    syncState === "dirty" &&
    (lastRemoteResult?.status === "network-error" || lastRemoteResult?.status === "server-error");
  const visible = syncState !== "clean";
  const presence = useVdPresence(visible);

  if (!presence.mounted) {
    return null;
  }

  function handleActivate() {
    if (busy || syncState === "conflict" || syncState === "clean") {
      return;
    }
    setBusy(true);
    const action = syncState === "dirty" ? runtime.syncCurrent() : runtime.pullCurrent();
    void action
      .catch(() => {})
      .finally(() => {
        setBusy(false);
      });
  }

  // During the exit pass syncState is already "clean"; the quiet dirty
  // pose is what fades out.
  const state = offline ? "offline" : syncState === "conflict" ? "conflict" : "dirty";
  const label =
    state === "conflict"
      ? t("sync.conflict")
      : busy
        ? t("sync.syncing")
        : offline
          ? t("sync.offlineDetailed")
          : t("sync.pending");

  return (
    <VdAnimatedSurface
      variant="popup"
      active={visible}
      onPresenceReleased={presence.completeExit}
      inert={!visible || undefined}
    >
      <button
        type="button"
        className="vela-sync-status"
        data-state={state}
        disabled={busy || state === "conflict"}
        title={state === "conflict" ? t("sync.conflictTitle") : offline ? t("sync.offlineTitle") : t("sync.syncNowTitle")}
        aria-label={state === "conflict" ? t("sync.conflictTitle") : offline ? t("sync.offlineTitle") : t("sync.syncNowTitle")}
        onClick={handleActivate}
      >
        <span className="vela-sync-status__dot" aria-hidden="true" />
        {label}
      </button>
    </VdAnimatedSurface>
  );
}

/**
 * Auto-retry on reconnect (UX-11): mounted while the desktop is up; the
 * browser regaining the network triggers ONE sync attempt for a dirty
 * workspace so the offline badge clears itself when the connection really
 * is back (a still-dead route keeps it, and the badge stays honest).
 */
export function useOnlineSyncRetry(
  workspace: LocalWorkspaceRecord,
  lastRemoteResult: WorkspaceRuntimeRemoteResult | undefined,
): void {
  const runtime = useWorkspaceRuntimeInstance();
  useEffect(() => {
    const offline =
      workspace.syncState === "dirty" &&
      (lastRemoteResult?.status === "network-error" || lastRemoteResult?.status === "server-error");
    if (!offline) {
      return;
    }
    const onOnline = () => {
      void runtime.syncCurrent().catch(() => {});
    };
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
    };
  }, [runtime, workspace.syncState, lastRemoteResult]);
}
