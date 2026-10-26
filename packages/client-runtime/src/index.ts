/**
 * Public API of @veladesk/client-runtime.
 *
 * Explicit named exports only — no `export *`. Internal listener sets,
 * test support and fake transports stay package-private.
 */

export { createWorkspaceClientRuntime } from "./runtime";
export { openWorkspaceClientRuntime } from "./open";
export type { OpenWorkspaceClientRuntimeOptions } from "./open";

export type {
  RuntimePullCurrentResult,
  RuntimeStageWorkspaceUpdateResult,
  RuntimeSyncCurrentResult,
  SelectWorkspaceResult,
  WorkspaceCandidate,
  WorkspaceManagementResult,
  WorkspaceManagementFailureReason,
  WorkspaceClientRuntime,
  WorkspaceClientRuntimeOptions,
  WorkspaceClientRuntimeState,
  WorkspaceRuntimeRemoteResult,
} from "./types";

export { LAST_WORKSPACE_KEY } from "./selection-memory";
export type { WorkspacePreferenceStorage } from "./selection-memory";
