"use client";

import { DragDropProvider } from "@dnd-kit/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { findDesktopPage } from "@veladesk/domain";
import type { DesktopPage, DesktopPageId, WorkspaceSnapshot } from "@veladesk/domain";
import type { PageLayout } from "@veladesk/desktop-engine";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceRuntimeRemoteResult } from "@veladesk/client-runtime";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useAtomicGridDrag } from "../desktop-grid/use-atomic-grid-drag";
import { useGridMetrics } from "../desktop-grid/use-grid-metrics";
import { AddAppDialog } from "./add-app-dialog";
import { DesktopGridView } from "./desktop-grid";
import { Dock } from "./dock";
import { SyncIndicator } from "./sync-indicator";
import { replacePageLayout } from "./workspace-layout";
import "./home-shell.css";

/** UI-only desktop mode. Session state — never persisted back to preferences. */
export type DesktopMode = "view" | "arrange";

/** Stages the edited snapshot locally, then attempts one explicit sync. */
async function stageAndSync(
  runtime: ReturnType<typeof useWorkspaceRuntimeInstance>,
  nextSnapshot: WorkspaceSnapshot
): Promise<void> {
  const result = await runtime.stageWorkspaceUpdate(nextSnapshot);
  if (result.ok) {
    void runtime.syncCurrent().catch(() => {});
  } else {
    console.error(`VelaDesk: layout change was not staged (${result.reason})`);
  }
}

interface DesktopShellProps {
  readonly workspace: LocalWorkspaceRecord;
  readonly lastRemoteResult?: WorkspaceRuntimeRemoteResult | undefined;
}

/**
 * The ready-state production desktop: fixed viewport, ambient wallpaper,
 * top bar, entity grid, page dots and floating dock.
 *
 * Local-first editing: a legal drop is staged immediately (the UI updates
 * without waiting for the network) and an explicit sync follows. Drag
 * sessions are atomic (shared useAtomicGridDrag contract) and are refused
 * when the workspace page changed under them.
 */
export function DesktopShell({ workspace, lastRemoteResult }: DesktopShellProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const snapshot = workspace.snapshot;

  const [mode, setMode] = useState<DesktopMode>(() =>
    snapshot.preferences.layoutLocked ? "view" : "arrange"
  );
  const [sessionPageId, setSessionPageId] = useState<DesktopPageId | null>(null);
  const [addAppOpen, setAddAppOpen] = useState(false);
  const arrange = mode === "arrange";

  const activePage = resolveActivePage(snapshot, sessionPageId);

  // Latest-value mirrors for async/session callbacks (drag commit, page
  // keyboard navigation) that must always see the current render's data.
  const workspaceRef = useRef(workspace);
  const pageIdRef = useRef<DesktopPageId | null>(activePage?.id ?? null);
  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);
  useEffect(() => {
    pageIdRef.current = activePage?.id ?? null;
  }, [activePage]);

  const commitDraggedLayout = useCallback(
    (movedLayout: PageLayout, layoutAtStart: PageLayout) => {
      const current = workspaceRef.current;
      const pageId = pageIdRef.current;
      if (pageId === null) {
        return;
      }
      const page = findDesktopPage(current.snapshot, pageId);
      // The drag session already rejected stale layouts; this re-check pins
      // the commit to the exact workspace state the drag started from.
      if (page === undefined || page.layout !== layoutAtStart) {
        return;
      }
      const replaced = replacePageLayout(current.snapshot, pageId, movedLayout);
      if (!replaced.ok) {
        return;
      }
      void stageAndSync(runtime, replaced.workspace);
    },
    [runtime]
  );

  const { gridRef, metrics } = useGridMetrics(
    activePage !== undefined ? activePage.layout.grid : { columns: 1, rows: 1 }
  );
  const { dragging, handleDragStart, handleDragEnd } = useAtomicGridDrag({
    layout: activePage !== undefined ? activePage.layout : null,
    metrics,
    onCommit: commitDraggedLayout,
  });

  // Keyboard page switching — never while a drag is live or focus sits in
  // a form field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (dragging || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) {
        return;
      }
      const pages = workspaceRef.current.snapshot.pages;
      if (pages.length < 2) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const currentId = pageIdRef.current;
      const index = pages.findIndex((page) => page.id === currentId);
      if (index < 0) {
        return;
      }
      const nextIndex =
        event.key === "ArrowLeft"
          ? Math.max(0, index - 1)
          : Math.min(pages.length - 1, index + 1);
      if (nextIndex !== index) {
        event.preventDefault();
        setSessionPageId(pages[nextIndex]!.id);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dragging]);

  if (activePage === undefined) {
    // Invariant violation (a workspace always has pages) — stay calm, stay
    // inspectable, never crash the tab.
    return (
      <main className="vela-screen">
        <div className="vela-screen__ambient" aria-hidden="true" />
        <section className="vela-screen__panel">
          <h1 className="vela-wordmark">VelaDesk</h1>
          <p className="vela-screen__lead">
            This workspace contains no pages, so there is nothing to display.
          </p>
          <button
            type="button"
            className="vela-button"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </section>
      </main>
    );
  }

  const pages = snapshot.pages;

  return (
    <div className="vela-desktop" data-arrange={arrange ? "true" : "false"}>
      <header className="vela-topbar">
        <span className="vela-topbar__brand">VelaDesk</span>
        <span className="vela-topbar__workspace">{snapshot.name}</span>
        <span className="vela-topbar__spacer" />
        <SyncIndicator workspace={workspace} lastRemoteResult={lastRemoteResult} />
        <button
          type="button"
          className="vela-button vela-topbar__add"
          onClick={() => setAddAppOpen(true)}
        >
          Add
        </button>
        <div className="vela-segment" role="group" aria-label="Desktop mode">
          <button
            type="button"
            className="vela-segment__button"
            aria-pressed={!arrange}
            disabled={dragging}
            onClick={() => setMode("view")}
          >
            View
          </button>
          <button
            type="button"
            className="vela-segment__button"
            aria-pressed={arrange}
            disabled={dragging}
            onClick={() => setMode("arrange")}
          >
            Arrange
          </button>
        </div>
      </header>

      <DragDropProvider onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <DesktopGridView
          layout={activePage.layout}
          workspace={snapshot}
          arrange={arrange}
          metrics={metrics}
          gridRef={gridRef}
        />
      </DragDropProvider>

      {pages.length > 1 ? (
        <div className="vela-pages" role="group" aria-label="Pages">
          {pages.map((page) => (
            <button
              key={page.id}
              type="button"
              className="vela-pages__dot"
              data-active={page.id === activePage.id ? "true" : undefined}
              aria-label={page.name}
              title={page.name}
              disabled={dragging}
              onClick={() => setSessionPageId(page.id)}
            />
          ))}
        </div>
      ) : null}

      <Dock
        workspace={snapshot}
        arrange={arrange}
        dragging={dragging}
        onToggleMode={() => setMode(arrange ? "view" : "arrange")}
        onAddApp={() => setAddAppOpen(true)}
      />

      {addAppOpen ? (
        <AddAppDialog workspace={snapshot} pageId={activePage.id} onClose={() => setAddAppOpen(false)} />
      ) : null}
    </div>
  );
}

/**
 * The session's active page. Session choice first; otherwise the workspace
 * default; otherwise the first page. `undefined` means the workspace holds
 * no pages at all (invariant violation — rendered as a calm recovery state).
 */
function resolveActivePage(
  workspace: WorkspaceSnapshot,
  sessionPageId: DesktopPageId | null
): DesktopPage | undefined {
  const session =
    sessionPageId !== null ? findDesktopPage(workspace, sessionPageId) : undefined;
  if (session !== undefined) {
    return session;
  }
  return (
    findDesktopPage(workspace, workspace.preferences.defaultPageId) ?? workspace.pages[0]
  );
}
