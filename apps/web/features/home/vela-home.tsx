"use client";

import { useCallback, useState } from "react";
import type { WorkspaceRuntimeRemoteResult } from "@veladesk/client-runtime";

import { WorkspaceRuntimeProvider } from "../workspace-runtime/workspace-runtime-provider";
import { useWorkspaceRuntimeState } from "../workspace-runtime/use-workspace-runtime";
import { UiLocaleProvider } from "../i18n/ui-locale-provider";
import { useI18n } from "../i18n/use-i18n";
import { WorkspaceManagerProvider } from "./workspace-manager";
import { ResponsiveWorkspaceShell } from "./responsive-workspace-shell";
import { EngineeringModeGate } from "../engineering/engineering-mode-gate";
import { OnboardingScreen } from "./onboarding";
import { StartupScreen } from "./startup-screen";
import { WorkspacePickerScreen } from "./workspace-picker";
import "./home-shell.css";
import { WorkspaceTransition } from "./workspace-motion";
import { MotionToast } from "./motion-toast";

/**
 * The production VelaDesk home: mounts the workspace runtime against the
 * default local database and renders the matching runtime state — ambient
 * boot, first-use onboarding, workspace selection, the RESPONSIVE shell
 * (desktop authoring or mobile consumption, task 026), or a fullscreen
 * recovery screen when local storage itself cannot be opened.
 *
 * Everything renders inside the UiLocaleProvider: server and first client
 * frame are zh-CN; the stored browser locale restores after hydration.
 */
export function VelaHome() {
  return (
    <UiLocaleProvider>
      <EngineeringModeGate>
        <WorkspaceRuntimeProvider
          loadingFallback={<StartupScreen />}
          errorFallback={(error) => <HomeRecoveryScreen error={error} />}
        >
          <HomeScreen />
        </WorkspaceRuntimeProvider>
      </EngineeringModeGate>
    </UiLocaleProvider>
  );
}

function HomeScreen() {
  const state = useWorkspaceRuntimeState();
  const [sampleCreated, setSampleCreated] = useState(false);
  const readyWorkspaceId = state.status === "ready" ? state.workspace.id : null;
  const [paintedWorkspaceId, setPaintedWorkspaceId] = useState<string | null>(null);
  const handleReady = useCallback(() => setPaintedWorkspaceId(readyWorkspaceId), [readyWorkspaceId]);
  const dismissSample = useCallback(() => setSampleCreated(false), []);
  function content() {
    switch (state.status) {
      case "idle":
      case "booting":
        return <StartupScreen />;
      case "empty":
        return <OnboardingScreen onSampleCreated={() => setSampleCreated(true)} />;
      case "remote-unavailable":
        // UX-11: no local data AND the server unreachable is a CONNECTION
        // problem, not a first-run welcome — the user must never be
        // funneled into creating a fresh workspace by a network outage.
        return <ConnectionScreen />;
      case "selection-required":
        return <WorkspacePickerScreen candidates={state.candidates} />;
      case "ready":
        return (
          <>
            <WorkspaceManagerProvider workspace={state.workspace} notice={sampleCreated && paintedWorkspaceId === state.workspace.id ? <SampleSuccessToast onDismiss={dismissSample} /> : null}>
              <ResponsiveWorkspaceShell workspace={state.workspace} lastRemoteResult={state.lastRemoteResult} onReady={handleReady} />
            </WorkspaceManagerProvider>
            {/*
              UX-11: local data + offline boot enters the desktop directly;
              this notice says so once per workspace session (it dismisses
              itself, and a later reconnect needs no announcement).
            */}
            <OfflineBootNotice workspaceId={state.workspace.id} lastRemoteResult={state.lastRemoteResult} />
          </>
        );
    }
  }
  return <WorkspaceTransition
    identity={readyWorkspaceId ?? state.status}
    awaitingPaint={readyWorkspaceId !== null && paintedWorkspaceId !== readyWorkspaceId}
    ready={readyWorkspaceId !== null && paintedWorkspaceId === readyWorkspaceId}
  >{content()}</WorkspaceTransition>;
}

function SampleSuccessToast({ onDismiss }: { readonly onDismiss: () => void }) {
  const { t } = useI18n();
  return <MotionToast onDismiss={onDismiss}>{t("onboarding.sampleSuccess")}</MotionToast>;
}

/**
 * Whether a remote result reports the server as unreachable RIGHT NOW (a
 * failed sync/pull attempt, not a healthy one and not a conflict).
 */
function isOfflineResult(result: WorkspaceRuntimeRemoteResult | undefined): boolean {
  return result?.status === "network-error" || result?.status === "server-error";
}

/**
 * The offline-boot announcement (UX-11): when the session entered the
 * desktop with local data while the server was unreachable, ONE
 * self-dismissing toast states it plainly — the desktop stays fully usable
 * and the badge in the corner carries the state afterwards. Announced once
 * per workspace id (switching workspaces or reloading may legitimately
 * re-announce).
 */
function OfflineBootNotice({
  workspaceId,
  lastRemoteResult,
}: {
  readonly workspaceId: string;
  readonly lastRemoteResult: WorkspaceRuntimeRemoteResult | undefined;
}) {
  const { t } = useI18n();
  // Derived state (never a ref in render): the announcement latches per
  // workspace id, so a later re-render or sync result cannot re-show it.
  const [announcedFor, setAnnouncedFor] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  if (isOfflineResult(lastRemoteResult) && announcedFor !== workspaceId) {
    setAnnouncedFor(workspaceId);
    setVisible(true);
  }
  if (!visible) {
    return null;
  }
  return (
    <MotionToast slot="workspace" onDismiss={() => setVisible(false)}>
      {t("startup.offlineLocalData")}
    </MotionToast>
  );
}

/**
 * The cannot-connect boot screen (UX-11): an EMPTY local store plus an
 * unreachable server. Reuses the recovery screen's calm panel — wordmark,
 * one honest sentence, an explicit retry; nothing about this state may
 * suggest onboarding or workspace creation.
 */
function ConnectionScreen() {
  const { t } = useI18n();
  return (
    <main className="vela-screen">
      <div className="vela-screen__ambient" aria-hidden="true" />
      <section className="vela-screen__panel">
        <h1 className="vela-wordmark">VelaDesk</h1>
        <p className="vela-screen__lead">{t("connection.lead")}</p>
        <div className="vela-screen__actions">
          <button
            type="button"
            className="vela-button vela-button--primary"
            onClick={() => window.location.reload()}
          >
            {t("common.retry")}
          </button>
        </div>
      </section>
    </main>
  );
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
