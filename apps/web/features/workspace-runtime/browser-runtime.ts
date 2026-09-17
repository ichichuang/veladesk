/**
 * Browser-only factory for the workspace client runtime.
 *
 * Nothing here may run at module import time: no IndexedDB open, no fetch,
 * no initialize. The runtime is created lazily on the first explicit call
 * (from a client effect) and cached as a singleton per database name.
 *
 * The production default is the "veladesk-local" database. Engineering
 * labs pass their own database name (e.g. "veladesk-runtime-lab") so they
 * can never pollute the future homepage data.
 */

import { openWorkspaceClientRuntime } from "@veladesk/client-runtime";
import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";

const DEFAULT_DATABASE_NAME = "veladesk-local";

const runtimePromises = new Map<string, Promise<WorkspaceClientRuntime>>();

export function getBrowserWorkspaceRuntime(
  databaseName: string = DEFAULT_DATABASE_NAME
): Promise<WorkspaceClientRuntime> {
  const existing = runtimePromises.get(databaseName);
  if (existing !== undefined) {
    return existing;
  }
  const created = openWorkspaceClientRuntime({ databaseName, baseUrl: "" });
  runtimePromises.set(databaseName, created);
  return created;
}
