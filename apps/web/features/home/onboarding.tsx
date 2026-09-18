"use client";

import { useState, type FormEvent } from "react";
import { createEmptyWorkspace } from "@veladesk/domain";
import type { WorkspaceSnapshot } from "@veladesk/domain";
import { createGridDefinition } from "@veladesk/desktop-engine";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useI18n } from "../i18n/use-i18n";
import { createBrowserId } from "./browser-id";
import "./home-shell.css";

interface OnboardingScreenProps {
  /**
   * Shown with a calm notice when the server could not be reached during
   * bootstrap. Creating a local workspace must stay possible offline.
   */
  readonly remoteUnavailable?: boolean;
}

/**
 * First-use onboarding: one question (workspace name), one action.
 *
 * Local-first: staging the workspace makes the desktop usable immediately;
 * the follow-up sync is fired without waiting and never blocks entry.
 * The default names (workspace and first page) follow the active locale —
 * existing workspaces are never renamed.
 */
export function OnboardingScreen({ remoteUnavailable = false }: OnboardingScreenProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const { t } = useI18n();
  // null = untouched: the input shows the locale's default name, and the
  // stored-locale restore (post-hydration) can still update it. The user's
  // own typing always wins.
  const [nameInput, setNameInput] = useState<string | null>(null);
  const name = nameInput ?? t("onboarding.defaultWorkspaceName");
  const [creating, setCreating] = useState(false);
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
    setCreating(true);
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
        setCreating(false);
        return;
      }
      // Local-first: the desktop is already usable. Sync is an explicit
      // follow-up attempt — a network failure keeps the workspace dirty
      // instead of blocking entry.
      void runtime.syncCurrent().catch(() => {});
    } catch (createError: unknown) {
      setError(
        createError instanceof Error
          ? createError.message
          : t("onboarding.error.createException")
      );
      setCreating(false);
    }
  }

  return (
    <main className="vela-screen">
      <div className="vela-screen__ambient" aria-hidden="true" />
      <section className="vela-screen__panel">
        <h1 className="vela-wordmark">VelaDesk</h1>
        <p className="vela-screen__lead">{t("onboarding.lead")}</p>

        {remoteUnavailable ? (
          <div className="vela-notice" role="status">
            <p>{t("onboarding.remoteUnavailable")}</p>
            <button type="button" className="vela-button" onClick={() => window.location.reload()}>
              {t("common.retry")}
            </button>
          </div>
        ) : null}

        <form className="vela-form" onSubmit={handleCreate}>
          <label className="vela-form__label" htmlFor="vela-onboarding-name">
            {t("onboarding.workspaceNameLabel")}
          </label>
          <input
            id="vela-onboarding-name"
            className="vela-input"
            type="text"
            value={name}
            maxLength={80}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setNameInput(event.target.value)}
            aria-describedby={error !== null ? "vela-onboarding-error" : undefined}
          />
          {error !== null ? (
            <p id="vela-onboarding-error" className="vela-form__error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="vela-button vela-button--primary" disabled={creating}>
            {creating ? t("onboarding.creatingButton") : t("onboarding.createButton")}
          </button>
        </form>
      </section>
    </main>
  );
}
