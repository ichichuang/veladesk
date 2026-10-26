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
import { MotionMenuEntries, WorkspaceMenuRow } from "./workspace-menu-row";
import { VdAnimatedSurface } from "@components/vd/animated-surface";
import { useVdPresence } from "@components/vd/presence";
import { MotionToast, MotionToastStack } from "./motion-toast";
import { captureWorkspaceDeparture, waitForWorkspaceTransition } from "./workspace-motion";
import { deleteWorkspaceViewState } from "./workspace-view-state";

type WorkspaceManager = { menu: DesktopMenuEntry; candidates: readonly WorkspaceCandidate[]; create(): void; select(id: string): void };
const ManagerContext = createContext<WorkspaceManager | null>(null);
export const useWorkspaceManager = () => useContext(ManagerContext);

/** Lives above the keyed shells: feedback and management dialogs survive a switch. */
export function WorkspaceManagerProvider({ workspace, children, notice }: { readonly workspace: LocalWorkspaceRecord; readonly children: ReactNode; readonly notice?: ReactNode }) {
  const runtime = useWorkspaceRuntimeInstance();
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);
  const theme = useMemo(() => buildAppearanceTheme(resolveWorkspaceAppearance(workspace.snapshot.preferences)), [workspace.snapshot.preferences]);
  const systemPrefersLight = useSystemPrefersLight();
  const effectiveColorMode = resolveEffectiveColorMode(theme.colorMode, systemPrefersLight);
  const { t } = useI18n();
  const [candidates, setCandidates] = useState<readonly WorkspaceCandidate[]>([{ source: "local", id: workspace.id, name: workspace.snapshot.name, syncState: workspace.syncState, serverRevision: workspace.serverRevision }]);
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "rename" | "delete"; workspace: WorkspaceCandidate } | null>(null);
  const [closing, setClosing] = useState(false);
  const dialogOrigin = useRef<HTMLElement | null>(null);
  function rememberFocus() { dialogOrigin.current = document.activeElement as HTMLElement | null; }
  function finishDialog() { setDialog(null); setClosing(false); }
  function returnFocus() {
    if (dialogOrigin.current?.isConnected && dialogOrigin.current.closest("[inert]") === null && !dialogOrigin.current.matches(":disabled")) dialogOrigin.current.focus();
    else document.querySelector<HTMLButtonElement>(".vela-rail button, .vela-mobile-shell button, .vela-desktop button")?.focus();
  }
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<readonly { id: number; message: string; error: boolean }[]>([]);
  const toastId = useRef(0);
  function showToast(toast: { message: string; error: boolean }) {
    const id = ++toastId.current;
    setToasts(current => [...current, { ...toast, id }]);
  }
  const refresh = useCallback(async () => {
    // Hosts can supply a minimal runtime before management becomes available.
    if (typeof runtime.listWorkspaces === "function") setCandidates(await runtime.listWorkspaces());
  }, [runtime]);
  useEffect(() => { void refresh().catch(() => {}); }, [refresh, workspace.id]);
  async function run(operation: () => Promise<WorkspaceManagementResult>, message: string) {
    if (working.current) return { ok: false, reason: "busy" } as const;
    working.current = true; setBusy(true); setError(null);
    try {
      const result = await operation();
      if (result.ok) {
        showToast({ message, error: false });
        await refresh().catch(() => {});
      }
      return result;
    } catch { return { ok: false, reason: "protocol-error" } as const; }
    finally { working.current = false; setBusy(false); }
  }
  const pendingSelection = useRef<string | null>(null);
  const selecting = useRef(false);
  function select(id: string) {
    if (working.current) return;
    pendingSelection.current = id;
    if (selecting.current) return;
    selecting.current = true;
    void (async () => {
      try {
        while (pendingSelection.current !== null) {
          const target = pendingSelection.current;
          pendingSelection.current = null;
          captureWorkspaceDeparture();
          const name = candidates.find(candidate => candidate.id === target)?.name ?? "";
          const result = await runtime.selectWorkspace(target);
          if (pendingSelection.current === null) showToast({ message: result.ok ? t("workspace.switched", { name }) : describeWorkspaceFailure(result, t), error: !result.ok });
        }
      } catch { showToast({ message: t("workspace.error.failed"), error: true }); }
      finally { selecting.current = false; }
    })();
  }
  function create() { rememberFocus(); setClosing(false); setError(null); setDialog({ kind: "create" }); }
  const menu: DesktopMenuEntry = {
    kind: "submenu", id: "workspaces", label: t("workspace.menu"), entries: [
      ...candidates.map((candidate): DesktopMenuEntry => ({
        kind: "action", id: `workspace:${candidate.id}`, label: candidate.name, checked: candidate.id === workspace.id, disabled: busy,
        keepOpen: true,
        onRename: async name => {
          const result = await run(() => runtime.renameWorkspace(candidate.id, name), t("workspace.renamed", { name }));
          return result.ok ? null : describeWorkspaceFailure(result, t);
        },
        onSelect: () => select(candidate.id), tools: [
          { icon: "rename", label: t("workspace.renameItem", { name: candidate.name }), disabled: busy,
            onSelect: () => { rememberFocus(); setClosing(false); setError(null); setDialog({ kind: "rename", workspace: candidate }); } },
          { icon: "delete", label: t("workspace.deleteItem", { name: candidate.name }), disabled: busy || candidates.length <= 1,
            ...(candidates.length <= 1 ? { reason: t("workspace.last") } : {}),
            onSelect: () => { rememberFocus(); setClosing(false); setError(null); setDialog({ kind: "delete", workspace: candidate }); } },
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
    {dialog?.kind === "create" || dialog?.kind === "rename" ? <WorkspaceDialog open={!closing} onExitComplete={finishDialog} onFocusReturn={returnFocus} candidates={candidates}
      {...(dialog.kind === "rename" ? { workspace: dialog.workspace } : {})}
      onClose={() => setClosing(true)}
      onCreate={snapshot => { captureWorkspaceDeparture(); return run(() => runtime.createWorkspace(snapshot), t("workspace.created", { name: snapshot.name })); }}
      onRename={(id, name) => run(() => runtime.renameWorkspace(id, name), t("workspace.renamed", { name }))} /> : null}
    {dialog?.kind === "delete" ? <ConfirmDialog open={!closing} onExitComplete={finishDialog} onFocusReturn={returnFocus} title={t("workspace.delete")} message={t("workspace.deleteMessage", { name: dialog.workspace.name })}
      confirmLabel={t("workspace.delete")} busy={busy} error={error} onCancel={() => { if (!busy) setClosing(true); }}
      onConfirm={() => {
        const target = dialog.workspace;
        captureWorkspaceDeparture();
        void run(async () => {
          if (target.id === workspace.id && document.querySelector("[data-workspace-stage]") !== null) {
            const fallback = candidates.find(candidate => candidate.id !== target.id);
            if (fallback !== undefined) {
              const result = await runtime.selectWorkspace(fallback.id);
              if (!result.ok) return result;
              await waitForWorkspaceTransition(fallback.id);
            }
          }
          return runtime.deleteWorkspace(target.id);
        }, t("workspace.deleted", { name: target.name })).then(result => {
          if (result.ok) {
            try { deleteWorkspaceViewState(window.localStorage, target.id); } catch { /* optional view preference */ }
            setClosing(true);
          } else setError(describeWorkspaceFailure(result, t));
        });
      }} /> : null}

    </VdPortalContainerProvider>
    <div ref={setPortalRoot} data-vd-ui="" data-vd-portal-root="" data-vd-color-mode={effectiveColorMode} style={theme.style as CSSProperties} >
    <MotionToastStack>
      {toasts.map(toast => <MotionToast key={toast.id} slot="workspace" error={toast.error} onDismiss={() => setToasts(current => current.filter(item => item.id !== toast.id))}>{toast.message}</MotionToast>)}
      {notice}
    </MotionToastStack>
    </div>
  </ManagerContext.Provider>;
}

/** Touch uses the same menu entries, expanded in place inside the menu sheet. */
export function WorkspaceMenuInline({ beforeAction }: { readonly beforeAction: () => void }) {
  const manager = useWorkspaceManager();
  const [open, setOpen] = useState(false);
  const presence = useVdPresence(open);
  if (manager?.menu.kind !== "submenu") return null;
  return <div className="vela-workspace-inline">
    <button type="button" className="vela-context-menu__item" aria-expanded={open} onClick={() => setOpen(!open)}>{manager.menu.label}<span aria-hidden="true">{open ? "⌄" : "›"}</span></button>
    {presence.mounted ? <VdAnimatedSurface active={open} variant="popup" onPresenceReleased={presence.completeExit} role="group" aria-label={manager.menu.label} inert={!open || undefined}>
      <MotionMenuEntries entries={manager.menu.entries} renderEntry={(entry, index, exiting, release) => entry.kind === "action" ?
        <WorkspaceMenuRow key={entry.id} entry={entry} exiting={exiting} release={release} mobile
          onSelect={() => { beforeAction(); entry.onSelect(); }} onTool={action => { beforeAction(); action(); }} /> : <hr key={index} />} />
    </VdAnimatedSurface> : null}
  </div>;
}
