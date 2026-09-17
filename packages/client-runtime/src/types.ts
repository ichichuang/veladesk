/**
 * Public type contracts of @veladesk/client-runtime.
 *
 * The runtime owns the browser workspace session: local-first bootstrap,
 * remote discovery, in-memory active-workspace selection and explicit
 * sync/pull orchestration, exposed as an external store
 * (`subscribe`/`getSnapshot`) for `useSyncExternalStore`.
 *
 * It has no React, no Next.js, no Node APIs and no persistence beyond the
 * local store it is given.
 */

import type { WorkspaceId } from "@veladesk/domain";
import type {
  LocalWorkspaceRecord,
  LocalWorkspaceSyncState,
} from "@veladesk/local-store";
import type {
  PullWorkspaceResult,
  SyncWorkspaceResult,
  WorkspaceSyncTransport,
} from "@veladesk/sync";
import type { LocalWorkspaceStore } from "@veladesk/local-store";

/**
 * One selectable workspace surfaced by bootstrap.
 *
 * V1 never mixes catalogs: with any local copies present, candidates are
 * local only; only a completely empty local store consults the remote
 * catalog.
 */
export type WorkspaceCandidate =
  | {
      readonly source: "local";
      readonly id: WorkspaceId;
      readonly name: string;
      readonly syncState: LocalWorkspaceSyncState;
      readonly serverRevision: number | null;
    }
  | {
      readonly source: "remote";
      readonly id: WorkspaceId;
      readonly name: string;
      readonly revision: number;
    };

/**
 * Result of the most recent startup or manual reconcile. A single field —
 * deliberately no log, no history.
 */
export type WorkspaceRuntimeRemoteResult =
  | SyncWorkspaceResult
  | PullWorkspaceResult
  | {
      readonly status: "conflict-present";
      readonly workspaceId: WorkspaceId;
    };

/** The observable session state of the runtime. */
export type WorkspaceClientRuntimeState =
  | {
      readonly status: "idle";
    }
  | {
      readonly status: "booting";
    }
  | {
      readonly status: "empty";
    }
  | {
      readonly status: "selection-required";
      readonly candidates: readonly WorkspaceCandidate[];
    }
  | {
      readonly status: "remote-unavailable";
      readonly reason: "network-error" | "server-error" | "protocol-error";
      readonly httpStatus?: number;
    }
  | {
      readonly status: "ready";
      readonly workspace: LocalWorkspaceRecord;
      readonly lastRemoteResult?: WorkspaceRuntimeRemoteResult;
    };

/** The browser workspace session runtime. */
export interface WorkspaceClientRuntime {
  /** Current state reference; changes only by whole-state replacement. */
  getSnapshot(): WorkspaceClientRuntimeState;

  /** Subscribe to state replacements; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;

  /**
   * Runs the local-first bootstrap at most once per runtime. Concurrent
   * calls share the run; later calls resolve to the current state. Local
   * IndexedDB failures reject — they are never disguised as
   * remote-unavailable.
   */
  initialize(): Promise<WorkspaceClientRuntimeState>;
}

/** Options of {@link createWorkspaceClientRuntime}. */
export interface WorkspaceClientRuntimeOptions {
  readonly store: LocalWorkspaceStore;
  readonly transport: WorkspaceSyncTransport;
}
