"use client";

import { useState } from "react";
import type { WorkspaceCandidate } from "@veladesk/client-runtime";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import type { SelectWorkspaceResult } from "@veladesk/client-runtime";
import "./home-shell.css";

interface WorkspacePickerScreenProps {
  readonly candidates: readonly WorkspaceCandidate[];
}

/**
 * Workspace selection: shown when bootstrap found several workspaces and
 * no single obvious one. Only the clicked candidate is disabled while its
 * selection is in flight; failures keep the picker open with an inline
 * status — never a full-page reload.
 */
export function WorkspacePickerScreen({ candidates }: WorkspacePickerScreenProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(candidateId: string) {
    if (pendingId !== null) {
      return;
    }
    setPendingId(candidateId);
    setError(null);
    try {
      const result: SelectWorkspaceResult = await runtime.selectWorkspace(candidateId);
      if (!result.ok) {
        setError(describeSelectFailure(result));
      }
    } catch (selectError: unknown) {
      setError(
        selectError instanceof Error ? selectError.message : "Opening the workspace failed."
      );
    } finally {
      setPendingId(null);
    }
  }

  return (
    <main className="vela-screen">
      <div className="vela-screen__ambient" aria-hidden="true" />
      <section className="vela-screen__panel">
        <h1 className="vela-wordmark">VelaDesk</h1>
        <p className="vela-screen__lead">Choose a workspace to open.</p>

        <ul className="vela-picker">
          {candidates.map((candidate) => (
            <li key={`${candidate.source}:${candidate.id}`}>
              <button
                type="button"
                className="vela-picker__item"
                disabled={pendingId !== null && pendingId !== candidate.id}
                aria-busy={pendingId === candidate.id}
                onClick={() => {
                  void handleSelect(candidate.id);
                }}
              >
                <span className="vela-picker__name">{candidate.name}</span>
                <span className="vela-picker__meta">
                  {candidate.source === "local" ? "Local" : "Server"}
                  {" · "}
                  {candidate.source === "local"
                    ? describeSyncState(candidate.syncState)
                    : `rev ${candidate.revision}`}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {error !== null ? (
          <p className="vela-form__error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}

function describeSyncState(syncState: "clean" | "dirty" | "conflict"): string {
  switch (syncState) {
    case "clean":
      return "Synced";
    case "dirty":
      return "Pending";
    case "conflict":
      return "Conflict";
  }
}

function describeSelectFailure(result: Extract<SelectWorkspaceResult, { ok: false }>): string {
  switch (result.reason) {
    case "not-found":
      return "That workspace no longer exists.";
    case "network-error":
      return "The server could not be reached.";
    case "server-error":
      return result.httpStatus === undefined
        ? "The server reported an error."
        : `The server reported an error (HTTP ${result.httpStatus}).`;
    case "protocol-error":
      return "The server responded unexpectedly.";
  }
}
