"use client";

import { useState, type FormEvent } from "react";
import { createEmptyWorkspace } from "@veladesk/domain";
import type { WorkspaceSnapshot } from "@veladesk/domain";
import { createGridDefinition } from "@veladesk/desktop-engine";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useI18n } from "../i18n/use-i18n";
import { buildSampleWorkspace } from "../import-json/sample-workspace";
import { createBrowserId } from "./browser-id";
import "./home-shell.css";

interface OnboardingScreenProps {
  /**
   * Shown with a calm notice when the server could not be reached during
   * bootstrap. Creating a local workspace must stay possible offline.
   */
  readonly remoteUnavailable?: boolean;
  readonly onSampleCreated?: () => void;
}

/**
 * First-use onboarding: one question (workspace name), one action.
 *
 * Local-first: staging the workspace makes the desktop usable immediately;
 * the follow-up sync is fired without waiting and never blocks entry.
 * The default names (workspace and first page) follow the active locale —
 * existing workspaces are never renamed.
 */
export function OnboardingScreen({ remoteUnavailable = false, onSampleCreated }: OnboardingScreenProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const { t, locale } = useI18n();
  // null = untouched: the input shows the locale's default name, and the
  // stored-locale restore (post-hydration) can still update it. The user's
  // own typing always wins.
  const [nameInput, setNameInput] = useState<string | null>(null);
  const name = nameInput ?? t("onboarding.defaultWorkspaceName");
  const [creating, setCreating] = useState<"empty" | "sample" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) {
      return;
    }
    const workspaceName = name.trim();
    if (workspaceName.length === 0) {
      setError(t("onboarding.error.enterName"));
      return;
    }
    if (workspaceName.length > 40) {
      setError(t("workspace.error.name"));
      return;
    }
    setCreating("empty");
    setError(null);
    try {
      const snapshot: WorkspaceSnapshot = createEmptyWorkspace({
        workspaceId: createBrowserId("workspace"),
        workspaceName,
        pageId: createBrowserId("page"),
        pageName: t("onboarding.defaultPageName"),
        grid: createGridDefinition(10, 6),
      });
      const result = await runtime.stageWorkspaceCreate(snapshot);
      if (!result.ok) {
        setError(t("onboarding.error.createFailed"));
        setCreating(null);
        return;
      }
      // Local-first: the desktop is already usable. Sync is an explicit
      // follow-up attempt — a network failure keeps the workspace dirty
      // instead of blocking entry.
      void runtime.syncCurrent().catch(() => {});
    } catch {
      setError(t("onboarding.error.createException"));
      setCreating(null);
    }
  }

  /**
   * 一键体验示例工作区: builds the curated sample (four category sections,
   * a folder example and a dock) through the canonical import pipeline and
   * stages it exactly like a hand-created workspace — local-first, sync
   * fired without waiting.
   */
  async function handleCreateSample() {
    if (creating) {
      return;
    }
    setCreating("sample");
    setError(null);
    try {
      const snapshot = buildSampleWorkspace((kind) => createBrowserId(kind), locale);
      const result = await runtime.stageWorkspaceCreate(snapshot);
      if (!result.ok) {
        setError(t("onboarding.error.createFailed"));
        setCreating(null);
        return;
      }
      // Same local-first contract as the manual path: the desktop is
      // usable now; the follow-up sync never blocks entry.
      void runtime.syncCurrent().catch(() => {});
      onSampleCreated?.();
    } catch {
      setError(t("onboarding.error.createSampleFailed"));
      setCreating(null);
    }
  }

  return (
    <main className="vela-screen vela-onboarding">
      <div className="vela-screen__ambient" aria-hidden="true" />
      <section className="vela-screen__panel vela-onboarding__panel" aria-labelledby="vela-onboarding-title">
        <h1 id="vela-onboarding-title" className="vela-wordmark">VelaDesk</h1>
        <p className="vela-screen__lead">{t("onboarding.lead")}</p>

        {remoteUnavailable ? (
          <div className="vela-notice" role="status">
            <p>{t("onboarding.remoteUnavailable")}</p>
            <button type="button" className="vela-button" aria-label={t("common.retry")} onClick={() => window.location.reload()}>
              {t("common.retry")}
            </button>
          </div>
        ) : null}

        <div className="vela-onboarding__sample">
          <p className="vela-onboarding__eyebrow">{t("onboarding.sampleTitle")}</p>
          <p id="vela-sample-description" className="vela-onboarding__description">{t("onboarding.sampleDescription")}</p>
          <button type="button" className="vela-button vela-button--primary" disabled={creating !== null}
            aria-label={creating === "sample" ? t("onboarding.creatingSampleButton") : t("onboarding.sampleButton")}
            aria-busy={creating === "sample"} aria-describedby="vela-sample-description"
            onClick={() => void handleCreateSample()}>
            {creating === "sample" ? <span className="vela-onboarding__spinner" aria-hidden="true" /> : null}
            {creating === "sample" ? t("onboarding.creatingSampleButton") : t("onboarding.sampleButton")}
          </button>
        </div>
        <form className="vela-form vela-onboarding__blank" onSubmit={handleCreate}>
          <label className="vela-form__label" htmlFor="vela-onboarding-name">
            {t("onboarding.workspaceNameLabel")}
          </label>
          <input
            id="vela-onboarding-name"
            className="vela-input"
            type="text"
            value={name}
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setNameInput(event.target.value)}
            disabled={creating !== null}
            aria-invalid={error === t("onboarding.error.enterName")}
            aria-describedby={error !== null ? "vela-onboarding-error" : undefined}
          />
          <button type="submit" className="vela-button" disabled={creating !== null}
            aria-label={creating === "empty" ? t("onboarding.creatingButton") : t("onboarding.createButton")}
            aria-busy={creating === "empty"}>
            {creating === "empty" ? t("onboarding.creatingButton") : t("onboarding.createButton")}
          </button>
        </form>
        {error !== null ? (
          <p id="vela-onboarding-error" className="vela-form__error" role="alert">{error}</p>
        ) : null}
      </section>
    </main>
  );
}
