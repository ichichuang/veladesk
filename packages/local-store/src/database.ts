/**
 * Dexie database wrapper of @veladesk/local-store.
 *
 * Internal module: the raw Dexie instance and its tables are never part of
 * the package's public API. All access goes through LocalWorkspaceStore.
 */

import Dexie from "dexie";
import type { DexieOptions, Table } from "dexie";

import type { LocalWorkspaceRecord, WorkspaceOutboxEntry } from "./types";

/**
 * IndexedDB schema version of the local working-copy store.
 *
 * This is ONLY the IndexedDB schema version. It is deliberately independent
 * of the workspace snapshot JSON version, the app version, and the server
 * revision — those must never be conflated.
 */
export const LOCAL_STORE_SCHEMA_VERSION = 1;

/** Typed Dexie database holding the local working copies and outbox. */
export class VelaDeskLocalDatabase extends Dexie {
  readonly workspaceCopies!: Table<LocalWorkspaceRecord, string>;

  readonly workspaceOutbox!: Table<WorkspaceOutboxEntry, string>;

  constructor(name: string, options?: DexieOptions) {
    super(name, options);
    this.version(LOCAL_STORE_SCHEMA_VERSION).stores({
      workspaceCopies: "id, syncState, updatedAt",
      workspaceOutbox: "workspaceId, queuedAt",
    });
  }
}
