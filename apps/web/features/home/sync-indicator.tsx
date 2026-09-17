"use client";

import { useState } from "react";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceRuntimeRemoteResult } from "@veladesk/client-runtime";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import "./home-shell.css";

interface SyncIndicatorProps {
  readonly workspace: LocalWorkspaceRecord;
  readonly lastRemoteResult?: WorkspaceRuntimeRemoteResult | undefined;
}

/**
 * Compact sync status in the top bar.
 *
 * clean → Synced (click pulls), dirty → Pending / Offline (click syncs),
 * conflict → Conflict (display only — conflicts are never re-sent or
 * auto-resolved in this stage).
 */
export function SyncIndicator({ workspace, lastRemoteResult }: SyncIndicatorProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const [busy, setBusy] = useState(false);

  const { syncState } = workspace;
  const offline =
    syncState === "dirty" &&
    (lastRemoteResult?.status === "network-error" || lastRemoteResult?.status === "server-error");

  const label =
    syncState === "clean" ? "Synced" : syncState === "dirty" ? (offline ? "Offline" : "Pending") : "Conflict";

  function handleClick() {
    if (busy || syncState === "conflict") {
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

  if (syncState === "conflict") {
    return (
      <span className="vela-sync" data-state="conflict" title="Conflict — resolution comes in a later update">
        <span className="vela-sync__dot" aria-hidden="true" />
        Conflict
      </span>
    );
  }

  return (
    <button
      type="button"
      className="vela-sync"
      data-state={syncState}
      disabled={busy}
      title={syncState === "dirty" ? "Sync now" : "Refresh from server"}
      onClick={handleClick}
    >
      <span className="vela-sync__dot" aria-hidden="true" />
      {busy ? "Syncing…" : label}
    </button>
  );
}
