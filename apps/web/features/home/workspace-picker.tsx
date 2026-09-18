"use client";

import { useState } from "react";
import type { WorkspaceCandidate } from "@veladesk/client-runtime";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useI18n } from "../i18n/use-i18n";
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
  const { t } = useI18n();
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
        setError(describeSelectFailure(result, t));
      }
    } catch (selectError: unknown) {
      setError(
        selectError instanceof Error ? selectError.message : t("picker.error.openFailed")
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
        <p className="vela-screen__lead">{t("picker.lead")}</p>

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
                  {candidate.source === "local" ? t("picker.sourceLocal") : t("picker.sourceServer")}
                  {" · "}
                  {candidate.source === "local"
                    ? describeSyncState(candidate.syncState, t)
                    : t("picker.revision", { revision: candidate.revision })}
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

import type { TranslateFn } from "../i18n/use-i18n";

function describeSyncState(
  syncState: "clean" | "dirty" | "conflict",
  t: TranslateFn
): string {
  switch (syncState) {
    case "clean":
      return t("picker.synced");
    case "dirty":
      return t("picker.pending");
    case "conflict":
      return t("picker.conflict");
  }
}

function describeSelectFailure(
  result: Extract<SelectWorkspaceResult, { ok: false }>,
  t: TranslateFn
): string {
  switch (result.reason) {
    case "not-found":
      return t("picker.error.notFound");
    case "network-error":
      return t("picker.error.network");
    case "server-error":
      return result.httpStatus === undefined
        ? t("picker.error.serverError")
        : t("picker.error.serverErrorStatus", { status: result.httpStatus });
    case "protocol-error":
      return t("picker.error.protocol");
  }
}
