"use client";

import { useRef, useState } from "react";
import { createEmptyWorkspace } from "@veladesk/domain";

import { useWorkspaceRuntimeInstance, useWorkspaceRuntimeState } from "./use-workspace-runtime";
import type { WorkspaceClientRuntimeState } from "@veladesk/client-runtime";
import { WorkspaceRuntimeProvider } from "./workspace-runtime-provider";
import "./workspace-runtime-lab.css";

/**
 * Development-only integration lab for the workspace client runtime
 * (/lab/workspace-runtime). Deliberately NOT product visual design. It
 * runs against the isolated "veladesk-runtime-lab" IndexedDB database so
 * the future production homepage data can never be touched from here.
 */

const LAB_DATABASE_NAME = "veladesk-runtime-lab";

function buildLabWorkspace() {
  return createEmptyWorkspace({
    workspaceId: "runtime-lab-workspace",
    workspaceName: "Runtime Lab",
    pageId: "runtime-lab-page",
    pageName: "Home",
    grid: { columns: 6, rows: 4 },
  });
}

export function WorkspaceRuntimeLab() {
  return (
    <WorkspaceRuntimeProvider
      databaseName={LAB_DATABASE_NAME}
      loadingFallback={
        <div className="workspace-runtime-lab__loading">Starting workspace runtime…</div>
      }
      errorFallback={(error) => (
        <div className="workspace-runtime-lab__loading">
          Workspace runtime failed to start: {error.message}
        </div>
      )}
    >
      <LabBody />
    </WorkspaceRuntimeProvider>
  );
}

function LabBody() {
  const runtime = useWorkspaceRuntimeInstance();
  const state = useWorkspaceRuntimeState();
  const renameCounter = useRef(1);
  const [busy, setBusy] = useState(false);

  const ready = state.status === "ready" ? state.workspace : undefined;

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="workspace-runtime-lab">
      <h1 className="workspace-runtime-lab__title">Workspace runtime lab</h1>
      <p className="workspace-runtime-lab__db">
        IndexedDB: <code>{LAB_DATABASE_NAME}</code> (isolated lab database)
      </p>

      <section className="workspace-runtime-lab__panel">
        <h2>runtime status</h2>
        <pre className="workspace-runtime-lab__state">{JSON.stringify(summarize(state), null, 2)}</pre>
      </section>

      {state.status === "selection-required" ? (
        <section className="workspace-runtime-lab__panel">
          <h2>select a workspace</h2>
          <div className="workspace-runtime-lab__buttons">
            {state.candidates.map((candidate) => (
              <button
                key={`${candidate.source}:${candidate.id}`}
                type="button"
                className="workspace-runtime-lab__button"
                disabled={busy}
                onClick={() => {
                  void run(() => runtime.selectWorkspace(candidate.id));
                }}
              >
                [{candidate.source}] {candidate.name} ({candidate.id})
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="workspace-runtime-lab__panel">
        <h2>actions</h2>
        <div className="workspace-runtime-lab__buttons">
          <button
            type="button"
            className="workspace-runtime-lab__button"
            disabled={busy}
            onClick={() => {
              void run(() => runtime.stageWorkspaceCreate(buildLabWorkspace()));
            }}
          >
            Create Lab Workspace
          </button>
          <button
            type="button"
            className="workspace-runtime-lab__button"
            disabled={busy || ready === undefined}
            onClick={() => {
              if (ready === undefined) {
                return;
              }
              renameCounter.current += 1;
              const renamed = {
                ...ready.snapshot,
                name: `Runtime Lab (edit ${renameCounter.current})`,
              };
              void run(() => runtime.stageWorkspaceUpdate(renamed));
            }}
          >
            Stage Rename
          </button>
          <button
            type="button"
            className="workspace-runtime-lab__button"
            disabled={busy || ready === undefined}
            onClick={() => {
              void run(() => runtime.syncCurrent());
            }}
          >
            Sync Now
          </button>
          <button
            type="button"
            className="workspace-runtime-lab__button"
            disabled={busy || ready === undefined}
            onClick={() => {
              void run(() => runtime.pullCurrent());
            }}
          >
            Pull Now
          </button>
        </div>
      </section>
    </main>
  );
}

function summarize(state: WorkspaceClientRuntimeState): unknown {
  switch (state.status) {
    case "ready": {
      const { workspace } = state;
      return {
        status: state.status,
        workspace: {
          id: workspace.id,
          name: workspace.snapshot.name,
          syncState: workspace.syncState,
          serverRevision: workspace.serverRevision,
          localGeneration: workspace.localGeneration,
          ...(workspace.conflictRevision !== undefined
            ? { conflictRevision: workspace.conflictRevision }
            : {}),
        },
        lastRemoteResult: state.lastRemoteResult ?? null,
      };
    }
    case "selection-required":
      return { status: state.status, candidates: state.candidates };
    default:
      return state;
  }
}
