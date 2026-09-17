"use client";

import { useEffect, useState, type ReactNode } from "react";

import { getBrowserWorkspaceRuntime } from "./browser-runtime";
import { WorkspaceRuntimeContextProvider } from "./use-workspace-runtime";

/**
 * Thin React adapter over the client runtime.
 *
 * The provider owns exactly two concerns: making the runtime instance
 * available below (created in a client effect — never at import time, so
 * SSR builds never touch IndexedDB or fetch) and kicking off the one-time
 * bootstrap. All domain/session state remains in the runtime's external
 * store; consumers read it with useSyncExternalStore.
 *
 * The default database is the production "veladesk-local"; engineering
 * labs pass their own isolated database name.
 */
export function WorkspaceRuntimeProvider({
  databaseName,
  children,
}: {
  databaseName?: string;
  children: ReactNode;
}) {
  const [runtime, setRuntime] = useState<Awaited<
    ReturnType<typeof getBrowserWorkspaceRuntime>
  > | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getBrowserWorkspaceRuntime(databaseName).then((instance) => {
      if (cancelled) {
        return;
      }
      setRuntime(instance);
      void instance.initialize();
    });
    return () => {
      cancelled = true;
    };
  }, [databaseName]);

  if (runtime === null) {
    return <div className="workspace-runtime-lab__loading">Starting workspace runtime…</div>;
  }

  return (
    <WorkspaceRuntimeContextProvider value={runtime}>{children}</WorkspaceRuntimeContextProvider>
  );
}
