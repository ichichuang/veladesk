"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import type { WorkspaceCandidate, WorkspaceManagementResult } from "@veladesk/client-runtime";
import { resolveWorkspaceAppearance } from "@veladesk/domain";
import { VdPortalContainerProvider } from "@components/ui/overlay-scope";
import { buildAppearanceTheme, resolveEffectiveColorMode } from "./appearance-theme";
import { useSystemPrefersLight } from "./use-system-prefers-light";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useI18n } from "../i18n/use-i18n";
import type { DesktopMenuEntry } from "./desktop-command-menu";
import { ConfirmDialog } from "./confirm-dialog";
import { WorkspaceDialog, describeWorkspaceFailure } from "./workspace-dialog";
import { deleteWorkspaceViewState } from "./workspace-view-state";

type WorkspaceManager = { menu: DesktopMenuEntry; candidates: readonly WorkspaceCandidate[]; create(): void; select(id: string): void };
const ManagerContext = createContext<WorkspaceManager | null>(null);
export const useWorkspaceManager = () => useContext(ManagerContext);

/** Lives above the keyed shells: feedback and management dialogs survive a switch. */
export function WorkspaceManagerProvider({ workspace, children }: { readonly workspace: LocalWorkspaceRecord; readonly children: ReactNode }) {
  const runtime = useWorkspaceRuntimeInstance();
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);
  const theme = useMemo(() => buildAppearanceTheme(resolveWorkspaceAppearance(workspace.snapshot.preferences)), [workspace.snapshot.preferences]);
  const systemPrefersLight = useSystemPrefersLight();
  const effectiveColorMode = resolveEffectiveColorMode(theme.colorMode, systemPrefersLight);
  const { t } = useI18n();
  const [candidates, setCandidates] = useState<readonly WorkspaceCandidate[]>([{ source: "local", id: workspace.id, name: workspace.snapshot.name, syncState: workspace.syncState, serverRevision: workspace.serverRevision }]);
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "rename" | "delete"; workspace: WorkspaceCandidate } | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const refresh = useCallback(async () => {
    // Hosts can supply a minimal runtime before management becomes available.
    if (typeof runtime.listWorkspaces === "function") setCandidates(await runtime.listWorkspaces());
  }, [runtime]);
  useEffect(() => { void refresh().catch(() => {}); }, [refresh, workspace.id]);
  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  async function run(operation: () => Promise<WorkspaceManagementResult>, message: string) {
    if (working.current) return { ok: false, reason: "busy" } as const;
    working.current = true; setBusy(true); setError(null);
    try {
      const result = await operation();
      if (result.ok) {
        setToast({ message, error: false });
        await refresh().catch(() => {});
      }
      return result;
    } catch { return { ok: false, reason: "protocol-error" } as const; }
    finally { working.current = false; setBusy(false); }
  }
  function select(id: string) {
    const name = candidates.find(candidate => candidate.id === id)?.name ?? "";
    void run(() => runtime.selectWorkspace(id), t("workspace.switched", { name })).then(result => {
      if (!result.ok) setToast({ message: describeWorkspaceFailure(result, t), error: true });
    });
  }
  function create() { setError(null); setDialog({ kind: "create" }); }
  const menu: DesktopMenuEntry = {
    kind: "submenu", id: "workspaces", label: t("workspace.menu"), entries: [
      ...candidates.map((candidate): DesktopMenuEntry => ({
        kind: "action", id: `workspace:${candidate.id}`, label: candidate.name, checked: candidate.id === workspace.id, disabled: busy,
        onSelect: () => select(candidate.id), tools: [
          { icon: "rename", label: t("workspace.renameItem", { name: candidate.name }), disabled: busy,
            onSelect: () => { setError(null); setDialog({ kind: "rename", workspace: candidate }); } },
          { icon: "delete", label: t("workspace.deleteItem", { name: candidate.name }), disabled: busy || candidates.length <= 1,
            ...(candidates.length <= 1 ? { reason: t("workspace.last") } : {}),
            onSelect: () => { setError(null); setDialog({ kind: "delete", workspace: candidate }); } },
        ],
      })),
      { kind: "separator" },
      { kind: "action", id: "create-workspace", label: t("workspace.create"), disabled: busy || candidates.length >= 10,
        ...(candidates.length >= 10 ? { reason: t("workspace.limit") } : {}), onSelect: create },
    ],
  };
  // Stable enough for consumers; operation closures always see the current catalog.
  const value = { menu, candidates, create, select };
  return <ManagerContext.Provider value={value}>
    {children}
    <VdPortalContainerProvider value={portalRoot}>
    {dialog?.kind === "create" || dialog?.kind === "rename" ? <WorkspaceDialog candidates={candidates}
      {...(dialog.kind === "rename" ? { workspace: dialog.workspace } : {})}
      onClose={() => setDialog(null)}
      onCreate={snapshot => run(() => runtime.createWorkspace(snapshot), t("workspace.created", { name: snapshot.name }))}
      onRename={(id, name) => run(() => runtime.renameWorkspace(id, name), t("workspace.renamed", { name }))} /> : null}
    {dialog?.kind === "delete" ? <ConfirmDialog title={t("workspace.delete")} message={t("workspace.deleteMessage", { name: dialog.workspace.name })}
      confirmLabel={t("workspace.delete")} busy={busy} error={error} onCancel={() => { if (!busy) setDialog(null); }}
      onConfirm={() => {
        const target = dialog.workspace;
        void run(() => runtime.deleteWorkspace(target.id), t("workspace.deleted", { name: target.name })).then(result => {
          if (result.ok) {
            try { deleteWorkspaceViewState(window.localStorage, target.id); } catch { /* optional view preference */ }
            setDialog(null);
          } else setError(describeWorkspaceFailure(result, t));
        });
      }} /> : null}

    </VdPortalContainerProvider>
    <div ref={setPortalRoot} data-vd-ui="" data-vd-portal-root="" data-vd-color-mode={effectiveColorMode} style={theme.style as CSSProperties} >
    {toast !== null ? <div className="vela-onboarding-success vela-workspace-toast" role={toast.error ? "alert" : "status"}>
      <span>{toast.message}</span><button type="button" className="vela-button" aria-label={t("common.close")} onClick={() => setToast(null)}>×</button>
    </div> : null}
    </div>
  </ManagerContext.Provider>;
}

/** Touch uses the same menu entries, expanded in place inside the menu sheet. */
export function WorkspaceMenuInline({ beforeAction }: { readonly beforeAction: () => void }) {
  const manager = useWorkspaceManager();
  const [open, setOpen] = useState(false);
  if (manager?.menu.kind !== "submenu") return null;
  return <div className="vela-workspace-inline">
    <button type="button" className="vela-context-menu__item" aria-expanded={open} onClick={() => setOpen(!open)}>{manager.menu.label}<span aria-hidden="true">{open ? "⌄" : "›"}</span></button>
    {open ? <div role="group" aria-label={manager.menu.label}>
      {manager.menu.entries.map((entry, index) => entry.kind === "action" ? <div key={entry.id} className="vela-workspace-menu-row">
        <button type="button" className="vela-context-menu__item" aria-current={entry.checked ? "true" : undefined} disabled={entry.disabled} title={entry.reason} onClick={() => { beforeAction(); entry.onSelect(); }}>
          <span aria-hidden="true">{entry.checked ? "✓" : ""}</span><span className="vela-workspace-menu-name">{entry.label}</span>
        </button>
        {entry.tools?.map(tool => <span key={tool.icon} title={tool.reason ?? tool.label}><button type="button" className="vela-button" aria-label={tool.label} disabled={tool.disabled} onClick={() => { beforeAction(); tool.onSelect(); }}>{tool.icon === "rename" ? "✎" : "×"}</button></span>)}
      </div> : <hr key={index} />)}
    </div> : null}
  </div>;
}
