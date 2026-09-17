"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import type { WorkspaceClientRuntime, WorkspaceClientRuntimeState } from "@veladesk/client-runtime";

const WorkspaceRuntimeContext = createContext<WorkspaceClientRuntime | undefined>(undefined);

/** Provides the runtime instance; render only inside the runtime provider. */
export const WorkspaceRuntimeContextProvider = WorkspaceRuntimeContext.Provider;

/** The runtime instance handed down by {@link WorkspaceRuntimeProvider}. */
export function useWorkspaceRuntimeInstance(): WorkspaceClientRuntime {
  const runtime = useContext(WorkspaceRuntimeContext);
  if (runtime === undefined) {
    throw new Error(
      "useWorkspaceRuntime must be used inside WorkspaceRuntimeProvider"
    );
  }
  return runtime;
}

/**
 * The runtime session state, bridged to React via useSyncExternalStore.
 * The runtime stays the single owner of domain/session state — React only
 * subscribes.
 */
export function useWorkspaceRuntimeState(): WorkspaceClientRuntimeState {
  const runtime = useWorkspaceRuntimeInstance();
  return useSyncExternalStore(
    (onStoreChange) => runtime.subscribe(onStoreChange),
    () => runtime.getSnapshot(),
  );
}
