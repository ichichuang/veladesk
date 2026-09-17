import { openLocalWorkspaceStore } from "@veladesk/local-store";
import { createHttpWorkspaceSyncTransport } from "@veladesk/sync";

import { createWorkspaceClientRuntime } from "./runtime";
import type { WorkspaceClientRuntime } from "./types";

/** Options of {@link openWorkspaceClientRuntime}. */
export interface OpenWorkspaceClientRuntimeOptions {
  /** Local IndexedDB database name. Defaults to the store's own default. */
  readonly databaseName?: string;

  /** Injectable clock for the local store. */
  readonly now?: () => number;

  /**
   * Optional IndexedDB implementation injection (tests / non-window
   * contexts). Both fields must be supplied together.
   */
  readonly indexedDB?: IDBFactory;
  readonly IDBKeyRange?: typeof IDBKeyRange;

  /** Transport base URL. Defaults to browser same-origin. */
  readonly baseUrl?: string;

  /** Transport fetch implementation. Defaults to `globalThis.fetch`. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Browser convenience constructor: opens the local store (awaited
 * explicitly so IndexedDB open failures surface immediately), builds the
 * HTTP transport and wires the runtime. Call it from a client effect or
 * other explicit browser context — never at module import time.
 */
export async function openWorkspaceClientRuntime(
  options: OpenWorkspaceClientRuntimeOptions = {}
): Promise<WorkspaceClientRuntime> {
  const store = await openLocalWorkspaceStore({
    ...(options.databaseName !== undefined ? { databaseName: options.databaseName } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.indexedDB !== undefined ? { indexedDB: options.indexedDB } : {}),
    ...(options.IDBKeyRange !== undefined ? { IDBKeyRange: options.IDBKeyRange } : {}),
  });
  const transport = createHttpWorkspaceSyncTransport({
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
  });
  return createWorkspaceClientRuntime({ store, transport });
}
