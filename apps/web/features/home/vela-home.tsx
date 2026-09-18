"use client";

import { WorkspaceRuntimeProvider } from "../workspace-runtime/workspace-runtime-provider";
import { useWorkspaceRuntimeState } from "../workspace-runtime/use-workspace-runtime";
import { UiLocaleProvider } from "../i18n/ui-locale-provider";
import { useI18n } from "../i18n/use-i18n";
import { DesktopShell } from "./desktop-shell";
import { OnboardingScreen } from "./onboarding";
import { StartupScreen } from "./startup-screen";
import { WorkspacePickerScreen } from "./workspace-picker";
import "./home-shell.css";

/**
 * The production VelaDesk home: mounts the workspace runtime against the
 * default local database and renders the matching runtime state — ambient
 * boot, first-use onboarding, workspace selection, the desktop shell, or a
 * fullscreen recovery screen when local storage itself cannot be opened.
 *
 * Everything renders inside the UiLocaleProvider: server and first client
 * frame are zh-CN; the stored browser locale restores after hydration.
 */
export function VelaHome() {
  return (
    <UiLocaleProvider>
      <WorkspaceRuntimeProvider
        loadingFallback={<StartupScreen />}
        errorFallback={(error) => <HomeRecoveryScreen error={error} />}
      >
        <HomeScreen />
      </WorkspaceRuntimeProvider>
    </UiLocaleProvider>
  );
}

function HomeScreen() {
  const state = useWorkspaceRuntimeState();
  switch (state.status) {
    case "idle":
    case "booting":
      return <StartupScreen />;
    case "empty":
      return <OnboardingScreen />;
    case "remote-unavailable":
      return <OnboardingScreen remoteUnavailable />;
    case "selection-required":
      return <WorkspacePickerScreen candidates={state.candidates} />;
    case "ready":
      return <DesktopShell workspace={state.workspace} lastRemoteResult={state.lastRemoteResult} />;
  }
}

interface HomeRecoveryScreenProps {
  readonly error: Error;
}

/**
 * Fullscreen recovery screen for local storage failures (IndexedDB open or
 * runtime bootstrap throwing). The technical cause stays visible but folded
 * away; Retry is an explicit reload.
 */
function HomeRecoveryScreen({ error }: HomeRecoveryScreenProps) {
  const { t } = useI18n();
  return (
    <main className="vela-screen">
      <div className="vela-screen__ambient" aria-hidden="true" />
      <section className="vela-screen__panel">
        <h1 className="vela-wordmark">VelaDesk</h1>
        <p className="vela-screen__lead">{t("recovery.lead")}</p>
        <div className="vela-screen__actions">
          <button
            type="button"
            className="vela-button vela-button--primary"
            onClick={() => window.location.reload()}
          >
            {t("common.retry")}
          </button>
        </div>
        <details className="vela-screen__detail">
          <summary>{t("recovery.technicalDetails")}</summary>
          <p>{error.message}</p>
        </details>
      </section>
    </main>
  );
}
