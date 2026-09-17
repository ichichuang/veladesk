"use client";

import { useEffect, useState, type ReactNode } from "react";

import { getBrowserWorkspaceRuntime } from "./browser-runtime";
import { WorkspaceRuntimeContextProvider } from "./use-workspace-runtime";

export interface WorkspaceRuntimeProviderProps {
  /** Local IndexedDB database name; defaults to the production database. */
  readonly databaseName?: string;
  readonly children: ReactNode;
  /** Rendered while the runtime is being opened. Defaults to `null`. */
  readonly loadingFallback?: ReactNode;
  /**
   * Rendered when opening the runtime or bootstrapping the session throws.
   * Receives the error; defaults to `null`. Each surface (production home,
   * labs) supplies its own presentation.
   */
  readonly errorFallback?: (error: Error) => ReactNode;
}

/**
 * Thin React adapter over the client runtime.
 *
 * The provider owns exactly three concerns: making the runtime instance
 * available below (created in a client effect — never at import time, so
 * SSR builds never touch IndexedDB or fetch), kicking off the one-time
 * bootstrap, and catching open/bootstrap failures so callers can present
 * them. All domain/session state remains in the runtime's external store;
 * consumers read it with useSyncExternalStore.
 *
 * Open and initialize failures are caught — never unhandled rejections —
 * and surface through `errorFallback`. A failed open is also dropped from
 * the browser runtime singleton cache, so an explicit retry gets a fresh
 * attempt.
 */
export function WorkspaceRuntimeProvider({
  databaseName,
  children,
  loadingFallback = null,
  errorFallback,
}: WorkspaceRuntimeProviderProps) {
  const [runtime, setRuntime] = useState<Awaited<
    ReturnType<typeof getBrowserWorkspaceRuntime>
  > | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBrowserWorkspaceRuntime(databaseName)
      .then((instance) => {
        if (cancelled) {
          return;
        }
        setRuntime(instance);
        instance.initialize().catch((bootstrapError: unknown) => {
          if (cancelled) {
            return;
          }
          setError(
            bootstrapError instanceof Error
              ? bootstrapError
              : new Error(String(bootstrapError))
          );
        });
      })
      .catch((openError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(
          openError instanceof Error ? openError : new Error(String(openError))
        );
      });
    return () => {
      cancelled = true;
    };
  }, [databaseName]);

  if (error !== null) {
    return errorFallback !== undefined ? <>{errorFallback(error)}</> : null;
  }

  if (runtime === null) {
    return <>{loadingFallback}</>;
  }

  return (
    <WorkspaceRuntimeContextProvider value={runtime}>{children}</WorkspaceRuntimeContextProvider>
  );
}
