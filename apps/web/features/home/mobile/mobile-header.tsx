"use client";

import { Menu, Search } from "lucide-react";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceRuntimeRemoteResult } from "@veladesk/client-runtime";

import { useI18n } from "../../i18n/use-i18n";
import "./mobile-shell.css";

/**
 * The mobile header (task 026 §12/§13): workspace name (single line,
 * truncated), a lightweight sync status next to it (clean renders NOTHING;
 * the status always carries text, never color alone, and is deliberately
 * NOT interactive — no refresh menu on mobile), then the two entry points
 * Search and Menu. The header owns no navigation and no management.
 */
export function MobileHeader({
  workspace,
  lastRemoteResult,
  onOpenSearch,
  onOpenMenu,
}: {
  readonly workspace: LocalWorkspaceRecord;
  readonly lastRemoteResult?: WorkspaceRuntimeRemoteResult | undefined;
  readonly onOpenSearch: () => void;
  readonly onOpenMenu: () => void;
}) {
  const { t } = useI18n();
  const syncState = workspace.syncState;
  const offline =
    syncState === "dirty" &&
    (lastRemoteResult?.status === "network-error" || lastRemoteResult?.status === "server-error");
  const status: "dirty" | "offline" | "conflict" | null =
    syncState === "conflict" ? "conflict" : syncState === "dirty" ? (offline ? "offline" : "dirty") : null;
  const statusLabel =
    status === "conflict"
      ? t("sync.conflict")
      : status === "offline"
        ? t("sync.offline")
        : status === "dirty"
          ? t("sync.pending")
          : null;

  return (
    <header className="vela-mobile-header">
      <span className="vela-mobile-header__name">{workspace.snapshot.name}</span>
      {status !== null && statusLabel !== null ? (
        <span className="vela-mobile-header__sync" data-state={status} role="status">
          <span className="vela-mobile-header__sync-dot" aria-hidden="true" />
          {statusLabel}
        </span>
      ) : null}
      <span className="vela-mobile-header__actions">
        <button type="button" className="vela-mobile-icon-button" aria-label={t("mobile.search.open")} onClick={onOpenSearch}>
          <Search size={20} aria-hidden="true" />
        </button>
        <button type="button" className="vela-mobile-icon-button" aria-label={t("mobile.menu.open")} onClick={onOpenMenu}>
          <Menu size={20} aria-hidden="true" />
        </button>
      </span>
    </header>
  );
}
