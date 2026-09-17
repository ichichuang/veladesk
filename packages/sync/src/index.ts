/**
 * Public API of @veladesk/sync.
 *
 * Explicit named exports only — no `export *`. The internal equality
 * helper and test support stay package-private.
 */

export { createHttpWorkspaceSyncTransport } from "./http-transport";
export { createWorkspaceSyncCoordinator } from "./coordinator";

export type {
  CreateRemoteWorkspaceResult,
  GetRemoteWorkspaceResult,
  HttpWorkspaceSyncTransportOptions,
  PullWorkspaceResult,
  RemoteTransportFailure,
  RemoteWorkspace,
  SaveRemoteWorkspaceResult,
  SyncWorkspaceResult,
  WorkspaceSyncCoordinator,
  WorkspaceSyncCoordinatorOptions,
  WorkspaceSyncTransport,
} from "./types";
