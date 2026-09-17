/**
 * Public type contracts of @veladesk/local-store.
 *
 * This package owns the browser-side durable working copy of a workspace:
 * the local snapshot, server revision metadata, local edit generation,
 * sync state, and a coalesced outbox of pending server mutations.
 *
 * It deliberately has no network, no React and no scheduler — those belong
 * to later sync coordinator tasks.
 */

import type {
  WorkspaceId,
  WorkspaceSnapshot,
  WorkspaceValidationIssue,
} from "@veladesk/domain";

/** Lifecycle state of a local working copy relative to the server. */
export type LocalWorkspaceSyncState =
  | "clean"
  | "dirty"
  | "conflict";

/** Kind of pending server mutation an outbox entry represents. */
export type WorkspaceOutboxOperation =
  | "create"
  | "save";

/** Durable local working copy of one workspace. */
export interface LocalWorkspaceRecord {
  readonly id: WorkspaceId;

  readonly snapshot: WorkspaceSnapshot;

  /**
   * Last server revision this client knows to be committed.
   * null means this workspace has never successfully existed on server yet.
   */
  readonly serverRevision: number | null;

  /**
   * Monotonic local edit generation.
   * Server hydration starts at 0.
   * Every local create/update increments local generation.
   */
  readonly localGeneration: number;

  readonly syncState: LocalWorkspaceSyncState;

  /**
   * Latest conflicting remote revision known to the client.
   * Only present for syncState === "conflict".
   */
  readonly conflictRevision?: number;

  /** Local timestamp of the latest working-copy change. */
  readonly updatedAt: number;

  /**
   * Local timestamp when a server state was last successfully accepted.
   * null for a workspace never synced to server.
   */
  readonly lastSyncedAt: number | null;
}

/** One pending (coalesced) server mutation of a workspace. */
export interface WorkspaceOutboxEntry {
  readonly workspaceId: WorkspaceId;

  readonly operation: WorkspaceOutboxOperation;

  /**
   * null only for create.
   * save must carry the server revision the mutation is based on.
   */
  readonly baseRevision: number | null;

  /** Latest coalesced local snapshot to send. */
  readonly snapshot: WorkspaceSnapshot;

  readonly localGeneration: number;

  /**
   * Time this workspace first became pending.
   * Further coalesced edits preserve this timestamp.
   */
  readonly queuedAt: number;
}

/** Options of {@link openLocalWorkspaceStore}. */
export interface OpenLocalWorkspaceStoreOptions {
  readonly databaseName?: string;

  readonly now?: () => number;

  /**
   * Optional IndexedDB implementation injection for Node tests.
   * Both indexedDB and IDBKeyRange must be supplied together.
   */
  readonly indexedDB?: IDBFactory;
  readonly IDBKeyRange?: typeof IDBKeyRange;
}

/** Public store API. The raw Dexie database is intentionally not exposed. */
export interface LocalWorkspaceStore {
  getWorkspace(
    id: WorkspaceId
  ): Promise<LocalWorkspaceRecord | undefined>;

  listWorkspaces():
    Promise<readonly LocalWorkspaceRecord[]>;

  getOutboxEntry(
    workspaceId: WorkspaceId
  ): Promise<WorkspaceOutboxEntry | undefined>;

  listOutboxEntries():
    Promise<readonly WorkspaceOutboxEntry[]>;

  hydrateWorkspaceFromServer(
    snapshot: WorkspaceSnapshot,
    serverRevision: number
  ): Promise<HydrateWorkspaceResult>;

  stageWorkspaceCreate(
    snapshot: WorkspaceSnapshot
  ): Promise<StageWorkspaceCreateResult>;

  stageWorkspaceUpdate(
    snapshot: WorkspaceSnapshot
  ): Promise<StageWorkspaceUpdateResult>;

  acknowledgeWorkspaceSync(
    input: AcknowledgeWorkspaceSyncInput
  ): Promise<AcknowledgeWorkspaceSyncResult>;

  markWorkspaceConflict(
    input: MarkWorkspaceConflictInput
  ): Promise<MarkWorkspaceConflictResult>;

  close(): void;
}

/** Result of accepting a server snapshot into the local working copy. */
export type HydrateWorkspaceResult =
  | {
      readonly ok: true;
      readonly workspace: LocalWorkspaceRecord;
    }
  | {
      readonly ok: false;
      readonly reason: "invalid-workspace";
      readonly issues: readonly WorkspaceValidationIssue[];
    }
  | {
      readonly ok: false;
      readonly reason: "local-changes-present";
    }
  | {
      readonly ok: false;
      readonly reason: "stale-server-revision";
      readonly currentRevision: number;
    };

/** Result of staging a local workspace create. */
export type StageWorkspaceCreateResult =
  | {
      readonly ok: true;
      readonly workspace: LocalWorkspaceRecord;
      readonly outbox: WorkspaceOutboxEntry;
    }
  | {
      readonly ok: false;
      readonly reason: "invalid-workspace";
      readonly issues: readonly WorkspaceValidationIssue[];
    }
  | {
      readonly ok: false;
      readonly reason: "already-exists";
    };

/** Result of staging a local workspace update. */
export type StageWorkspaceUpdateResult =
  | {
      readonly ok: true;
      readonly workspace: LocalWorkspaceRecord;
      readonly outbox: WorkspaceOutboxEntry;
    }
  | {
      readonly ok: false;
      readonly reason: "invalid-workspace";
      readonly issues: readonly WorkspaceValidationIssue[];
    }
  | {
      readonly ok: false;
      readonly reason: "not-found";
    };

/** Input of a successful-sync acknowledgement. */
export interface AcknowledgeWorkspaceSyncInput {
  readonly workspaceId: WorkspaceId;

  /**
   * Local generation that was actually sent by the sync request.
   */
  readonly localGeneration: number;

  /**
   * Canonical server snapshot returned by successful create/save.
   */
  readonly serverSnapshot: WorkspaceSnapshot;

  readonly serverRevision: number;
}

/** Result of a successful-sync acknowledgement. */
export type AcknowledgeWorkspaceSyncResult =
  | {
      readonly ok: true;
      readonly workspace: LocalWorkspaceRecord;
      readonly outbox?: WorkspaceOutboxEntry;
    }
  | {
      readonly ok: false;
      readonly reason: "invalid-workspace";
      readonly issues: readonly WorkspaceValidationIssue[];
    }
  | {
      readonly ok: false;
      readonly reason: "workspace-id-mismatch";
    }
  | {
      readonly ok: false;
      readonly reason: "not-found";
    }
  | {
      readonly ok: false;
      readonly reason: "no-pending-change";
    }
  | {
      readonly ok: false;
      readonly reason: "stale-generation";
    }
  | {
      readonly ok: false;
      readonly reason: "stale-server-revision";
      readonly currentRevision: number;
    };

/** Input of a revision-conflict marking (HTTP 409 response). */
export interface MarkWorkspaceConflictInput {
  readonly workspaceId: WorkspaceId;
  readonly localGeneration: number;
  readonly actualRevision: number;
}

/** Result of a revision-conflict marking. */
export type MarkWorkspaceConflictResult =
  | {
      readonly ok: true;
      readonly workspace: LocalWorkspaceRecord;
    }
  | {
      readonly ok: false;
      readonly reason: "not-found";
    }
  | {
      readonly ok: false;
      readonly reason: "no-pending-change";
    }
  | {
      readonly ok: false;
      readonly reason: "stale-generation";
    }
  | {
      readonly ok: false;
      readonly reason: "stale-server-revision";
      readonly currentRevision: number;
    };
