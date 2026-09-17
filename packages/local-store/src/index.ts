/**
 * Public API of @veladesk/local-store.
 *
 * Explicit named exports only — no `export *`, and the raw Dexie database
 * and its tables stay internal to the package.
 */

export { LOCAL_STORE_SCHEMA_VERSION } from "./database";
export { openLocalWorkspaceStore } from "./store";

export type {
  AcknowledgeWorkspaceSyncInput,
  AcknowledgeWorkspaceSyncResult,
  HydrateWorkspaceResult,
  LocalWorkspaceRecord,
  LocalWorkspaceStore,
  LocalWorkspaceSyncState,
  MarkWorkspaceConflictInput,
  MarkWorkspaceConflictResult,
  OpenLocalWorkspaceStoreOptions,
  StageWorkspaceCreateResult,
  StageWorkspaceUpdateResult,
  WorkspaceOutboxEntry,
  WorkspaceOutboxOperation,
} from "./types";
