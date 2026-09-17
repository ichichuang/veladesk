/**
 * Public API of @veladesk/client-runtime.
 *
 * Explicit named exports only — no `export *`. Internal listener sets,
 * test support and fake transports stay package-private.
 */

export { createWorkspaceClientRuntime } from "./runtime";

export type {
  WorkspaceCandidate,
  WorkspaceClientRuntime,
  WorkspaceClientRuntimeOptions,
  WorkspaceClientRuntimeState,
  WorkspaceRuntimeRemoteResult,
} from "./types";
