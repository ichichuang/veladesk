"use client";

import { useState } from "react";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceRuntimeRemoteResult } from "@veladesk/client-runtime";

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
 * 离线 (click retries), conflict → 冲突 (display only; conflicts are never
 * re-sent or auto-resolved in this stage). Deliberately visually quiet.
 */
export function SectionSyncStatus({ workspace, lastRemoteResult }: SectionSyncStatusProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const { syncState } = workspace;
  const offline =
    syncState === "dirty" &&
    (lastRemoteResult?.status === "network-error" || lastRemoteResult?.status === "server-error");

  if (syncState === "clean") {
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

  const label =
    syncState === "conflict"
      ? t("sync.conflict")
      : busy
        ? t("sync.syncing")
        : offline
          ? t("sync.offline")
          : t("sync.pending");

  if (syncState === "conflict") {
    return (
      <span className="vela-sync-status" data-state="conflict" title={t("sync.conflictTitle")}>
        <span className="vela-sync-status-dot" aria-hidden="true" />
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="vela-sync-status"
      data-state={offline ? "offline" : "dirty"}
      disabled={busy}
      title={t("sync.syncNowTitle")}
      onClick={handleActivate}
    >
      <span className="vela-sync-status-dot" aria-hidden="true" />
      {label}
    </button>
  );
}
