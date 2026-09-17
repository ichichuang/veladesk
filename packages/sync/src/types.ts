/**
 * Public type contracts of @veladesk/sync.
 *
 * The sync package connects the local IndexedDB working copy to the
 * workspace HTTP API: a browser-safe transport plus an explicit
 * coordinator over the local outbox. It never touches SQLite, Node APIs,
 * React or schedulers.
 */

import type { WorkspaceId, WorkspaceSnapshot } from "@veladesk/domain";
import type { LocalWorkspaceStore } from "@veladesk/local-store";

/** The canonical server view of one workspace, as far as sync cares. */
export interface RemoteWorkspace {
  readonly snapshot: WorkspaceSnapshot;
  readonly revision: number;
}

/**
 * Shared transport failure contract.
 *
 * - network-error: the fetch itself rejected (offline, DNS, aborted…).
 * - server-error: an HTTP 5xx response.
 * - protocol-error: anything that violates the API contract — malformed
 *   JSON, malformed shapes, unexpected status/code combinations, illegal
 *   conflict revisions or domain-invalid success snapshots. Never silently
 *   reinterpret API drift as a business result.
 */
export type RemoteTransportFailure =
  | {
      readonly reason: "network-error";
    }
  | {
      readonly reason: "server-error";
      readonly status: number;
    }
  | {
      readonly reason: "protocol-error";
      readonly status?: number;
    };

/**
 * The same failure contract embedded as discriminated (`ok: false`)
 * members of the transport result unions.
 */
type TransportFailureResult =
  | {
      readonly ok: false;
      readonly reason: "network-error";
    }
  | {
      readonly ok: false;
      readonly reason: "server-error";
      readonly status: number;
    }
  | {
      readonly ok: false;
      readonly reason: "protocol-error";
      readonly status?: number;
    };

/** Result of {@link WorkspaceSyncTransport.getWorkspace}. */
export type GetRemoteWorkspaceResult =
  | {
      readonly ok: true;
      readonly workspace: RemoteWorkspace;
    }
  | {
      readonly ok: false;
      readonly reason: "not-found";
    }
  | {
      readonly ok: false;
      readonly reason: "network-error" | "server-error" | "protocol-error";
      readonly status?: number;
    };

/** Result of {@link WorkspaceSyncTransport.createWorkspace}. */
export type CreateRemoteWorkspaceResult =
  | {
      readonly ok: true;
      readonly workspace: RemoteWorkspace;
    }
  | {
      readonly ok: false;
      readonly reason: "already-exists";
    }
  | {
      readonly ok: false;
      readonly reason: "invalid-workspace";
    }
  | TransportFailureResult;

/** Result of {@link WorkspaceSyncTransport.saveWorkspace}. */
export type SaveRemoteWorkspaceResult =
  | {
      readonly ok: true;
      readonly workspace: RemoteWorkspace;
    }
  | {
      readonly ok: false;
      readonly reason: "not-found";
    }
  | {
      readonly ok: false;
      readonly reason: "invalid-workspace";
    }
  | {
      readonly ok: false;
      readonly reason: "revision-conflict";
      readonly actualRevision: number;
    }
  | TransportFailureResult;

/** Browser-safe HTTP boundary towards the workspace API. */
export interface WorkspaceSyncTransport {
  getWorkspace(workspaceId: WorkspaceId): Promise<GetRemoteWorkspaceResult>;

  createWorkspace(snapshot: WorkspaceSnapshot): Promise<CreateRemoteWorkspaceResult>;

  saveWorkspace(
    snapshot: WorkspaceSnapshot,
    expectedRevision: number
  ): Promise<SaveRemoteWorkspaceResult>;
}

/** Options of {@link createHttpWorkspaceSyncTransport}. */
export interface HttpWorkspaceSyncTransportOptions {
  /**
   * Base URL prepended to `/api/v1/...`. Defaults to `""` (browser
   * same-origin). A trailing `/` is stripped; a whitespace-only baseUrl is
   * rejected with `RangeError`.
   */
  readonly baseUrl?: string;

  /** Fetch implementation. Defaults to `globalThis.fetch`. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Outcome of one explicit `syncWorkspace` attempt.
 *
 * `pending` means the request itself succeeded but newer local edits
 * accumulated while it was in flight — the outbox still holds work for the
 * next explicit sync. `superseded` means the local state moved on (another
 * tab / context) so the acknowledgement or conflict marking was a no-op.
 */
export type SyncWorkspaceResult =
  | {
      readonly status: "idle";
      readonly workspaceId: WorkspaceId;
    }
  | {
      readonly status: "synced";
      readonly workspaceId: WorkspaceId;
      readonly serverRevision: number;
    }
  | {
      readonly status: "pending";
      readonly workspaceId: WorkspaceId;
      readonly serverRevision: number;
    }
  | {
      readonly status: "conflict";
      readonly workspaceId: WorkspaceId;
      readonly actualRevision: number;
    }
  | {
      readonly status: "server-missing";
      readonly workspaceId: WorkspaceId;
    }
  | {
      readonly status: "server-rejected";
      readonly workspaceId: WorkspaceId;
    }
  | {
      readonly status: "network-error";
      readonly workspaceId: WorkspaceId;
    }
  | {
      readonly status: "server-error";
      readonly workspaceId: WorkspaceId;
      readonly httpStatus: number;
    }
  | {
      readonly status: "protocol-error";
      readonly workspaceId: WorkspaceId;
      readonly httpStatus?: number;
    }
  | {
      readonly status: "superseded";
      readonly workspaceId: WorkspaceId;
    };

/** Explicit, scheduler-free orchestration over the local outbox. */
export interface WorkspaceSyncCoordinator {
  /**
   * Sends the current pending mutation of one workspace. Same-process
   * single-flight: concurrent calls for the same workspace share one
   * in-flight request.
   */
  syncWorkspace(workspaceId: WorkspaceId): Promise<SyncWorkspaceResult>;
}

/** Options of {@link createWorkspaceSyncCoordinator}. */
export interface WorkspaceSyncCoordinatorOptions {
  readonly store: LocalWorkspaceStore;
  readonly transport: WorkspaceSyncTransport;
}
