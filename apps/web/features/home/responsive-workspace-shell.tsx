"use client";

import { lazy, Suspense, useEffect } from "react";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceRuntimeRemoteResult } from "@veladesk/client-runtime";

import { useWorkspaceShellMode } from "./use-workspace-shell-mode";
import { useWorkspaceActiveSection } from "./workspace-active-section";
import { StartupScreen } from "./startup-screen";

/**
 * Code-split shells (task 026 §62): the resolver picks the mode BEFORE the
 * target shell's chunk loads; only that chunk is fetched and executed. The
 * existing startup surface covers the brief chunk load — never a blank
 * white screen (§63).
 */
const DesktopShell = lazy(() =>
  import("./desktop-shell").then((module) => ({ default: module.DesktopShell })),
);
const MobileShell = lazy(() =>
  import("./mobile/mobile-shell").then((module) => ({ default: module.MobileShell })),
);

/**
 * The responsive workspace shell (task 026 §3/§4): mounts EXACTLY ONE
 * interaction shell — desktop authoring or mobile consumption — never one
 * wrapping the other, never both with CSS hiding (duplicate listeners,
 * DnD sensors and runtime consumers are the failure mode that design
 * forbids).
 *
 * The workspace RUNTIME and the SHARED ACTIVE SECTION live here, ABOVE the
 * shell switch: a desktop↔mobile swap changes presentation only — no
 * re-open, no re-bootstrap, no lost section (§4/§72/§73). An unresolved
 * capability (first client frame without matchMedia) keeps the startup
 * surface (§7); a workspace id change remounts the whole subtree so every
 * boot-scoped piece (view state, warm sets, session state) resets together.
 */
export function ResponsiveWorkspaceShell({
  workspace,
  lastRemoteResult,
  onReady,
}: {
  readonly onReady?: (() => void) | undefined;
  readonly workspace: LocalWorkspaceRecord;
  readonly lastRemoteResult?: WorkspaceRuntimeRemoteResult | undefined;
}) {
  return <ShellTree key={workspace.id} workspace={workspace} lastRemoteResult={lastRemoteResult} onReady={onReady} />;
}

function ShellTree({
  workspace,
  lastRemoteResult,
  onReady,
}: {
  readonly onReady?: (() => void) | undefined;
  readonly workspace: LocalWorkspaceRecord;
  readonly lastRemoteResult?: WorkspaceRuntimeRemoteResult | undefined;
}) {
  const shellMode = useWorkspaceShellMode();
  const activeSection = useWorkspaceActiveSection({
    workspaceId: workspace.id,
    pageIds: workspace.snapshot.pages.map((page) => page.id),
    defaultSectionId: workspace.snapshot.preferences.defaultPageId,
  });

  if (shellMode === null) {
    // Capability unresolved (§7): keep the EXISTING branded loading
    // surface — never a second boot screen, never a default desktop.
    return <StartupScreen />;
  }

  return (
    <Suspense fallback={<StartupScreen />}>
      <WorkspacePaintReady onReady={onReady} />
      {shellMode === "mobile" ? (
        <MobileShell
          workspace={workspace}
          lastRemoteResult={lastRemoteResult}
          activeSection={activeSection}
        />
      ) : (
        <DesktopShell
          workspace={workspace}
          lastRemoteResult={lastRemoteResult}
          activeSection={activeSection}
        />
      )}
    </Suspense>
  );
}

/** Inside Suspense: notify only after the shell commits and a paint can occur. */
export function WorkspacePaintReady({ onReady }: { readonly onReady?: (() => void) | undefined }) {
  useEffect(() => {
    if (onReady === undefined) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(onReady);
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [onReady]);
  return null;
}
