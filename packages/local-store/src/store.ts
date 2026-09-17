/**
 * LocalWorkspaceStore implementation over Dexie/IndexedDB.
 *
 * The store is the durable browser-side working copy of workspaces: local
 * snapshot + server revision + local generation + sync state, plus a
 * coalesced one-entry-per-workspace outbox of pending server mutations.
 * Every multi-record write runs in a single Dexie transaction so the
 * working copy and outbox can never disagree.
 */

import type { DexieOptions } from "dexie";
import type { WorkspaceSnapshot } from "@veladesk/domain";

import { VelaDeskLocalDatabase } from "./database";
import {
  assertServerRevision,
  nextLocalGeneration,
  readClock,
  validateLocalSnapshot,
} from "./validation";
import type {
  AcknowledgeWorkspaceSyncInput,
  AcknowledgeWorkspaceSyncResult,
  HydrateWorkspaceResult,
  LocalWorkspaceRecord,
  LocalWorkspaceStore,
  MarkWorkspaceConflictInput,
  MarkWorkspaceConflictResult,
  OpenLocalWorkspaceStoreOptions,
  StageWorkspaceCreateResult,
  StageWorkspaceUpdateResult,
  WorkspaceOutboxEntry,
} from "./types";

const DEFAULT_DATABASE_NAME = "veladesk-local";

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function notImplemented(operation: string): never {
  throw new Error(`not implemented: ${operation}`);
}

class LocalWorkspaceStoreImpl implements LocalWorkspaceStore {
  constructor(
    private readonly db: VelaDeskLocalDatabase,
    private readonly now: () => number
  ) {}

  getWorkspace(id: string): Promise<LocalWorkspaceRecord | undefined> {
    return this.db.workspaceCopies.get(id);
  }

  async listWorkspaces(): Promise<readonly LocalWorkspaceRecord[]> {
    const records = await this.db.workspaceCopies.toArray();
    return [...records].sort((a, b) => compareStrings(a.id, b.id));
  }

  getOutboxEntry(workspaceId: string): Promise<WorkspaceOutboxEntry | undefined> {
    return this.db.workspaceOutbox.get(workspaceId);
  }

  async listOutboxEntries(): Promise<readonly WorkspaceOutboxEntry[]> {
    const entries = await this.db.workspaceOutbox.toArray();
    return [...entries].sort(
      (a, b) => a.queuedAt - b.queuedAt || compareStrings(a.workspaceId, b.workspaceId)
    );
  }

  async hydrateWorkspaceFromServer(
    snapshot: WorkspaceSnapshot,
    serverRevision: number
  ): Promise<HydrateWorkspaceResult> {
    assertServerRevision(serverRevision);
    const issues = validateLocalSnapshot(snapshot);
    if (issues.length > 0) {
      return Promise.resolve({ ok: false, reason: "invalid-workspace", issues });
    }

    return this.db.transaction(
      "rw",
      this.db.workspaceCopies,
      this.db.workspaceOutbox,
      async (): Promise<HydrateWorkspaceResult> => {
        const current = await this.db.workspaceCopies.get(snapshot.id);

        // CASE A: no local working copy yet — accept server state as-is.
        if (current === undefined) {
          const now = readClock(this.now);
          const record: LocalWorkspaceRecord = {
            id: snapshot.id,
            snapshot,
            serverRevision,
            localGeneration: 0,
            syncState: "clean",
            updatedAt: now,
            lastSyncedAt: now,
          };
          await this.db.workspaceCopies.put(record);
          await this.db.workspaceOutbox.delete(snapshot.id);
          return { ok: true, workspace: record };
        }

        // CASE C: unsynchronized local edits must never be overwritten.
        if (current.syncState !== "clean") {
          return { ok: false, reason: "local-changes-present" };
        }

        // CASE B: clean local copy — accept fresh server state, keep generation.
        if (current.serverRevision !== null && serverRevision < current.serverRevision) {
          return {
            ok: false,
            reason: "stale-server-revision",
            currentRevision: current.serverRevision,
          };
        }

        const now = readClock(this.now);
        const record: LocalWorkspaceRecord = {
          id: current.id,
          snapshot,
          serverRevision,
          localGeneration: current.localGeneration,
          syncState: "clean",
          updatedAt: now,
          lastSyncedAt: now,
        };
        await this.db.workspaceCopies.put(record);
        await this.db.workspaceOutbox.delete(snapshot.id);
        return { ok: true, workspace: record };
      }
    );
  }

  stageWorkspaceCreate(snapshot: WorkspaceSnapshot): Promise<StageWorkspaceCreateResult> {
    const issues = validateLocalSnapshot(snapshot);
    if (issues.length > 0) {
      return Promise.resolve({ ok: false, reason: "invalid-workspace", issues });
    }

    return this.db.transaction(
      "rw",
      this.db.workspaceCopies,
      this.db.workspaceOutbox,
      async (): Promise<StageWorkspaceCreateResult> => {
        const existing = await this.db.workspaceCopies.get(snapshot.id);
        if (existing !== undefined) {
          return { ok: false, reason: "already-exists" };
        }

        const now = readClock(this.now);
        const workspace: LocalWorkspaceRecord = {
          id: snapshot.id,
          snapshot,
          serverRevision: null,
          localGeneration: 1,
          syncState: "dirty",
          updatedAt: now,
          lastSyncedAt: null,
        };
        const outbox: WorkspaceOutboxEntry = {
          workspaceId: snapshot.id,
          operation: "create",
          baseRevision: null,
          snapshot,
          localGeneration: 1,
          queuedAt: now,
        };
        await this.db.workspaceCopies.put(workspace);
        await this.db.workspaceOutbox.put(outbox);
        return { ok: true, workspace, outbox };
      }
    );
  }

  stageWorkspaceUpdate(snapshot: WorkspaceSnapshot): Promise<StageWorkspaceUpdateResult> {
    const issues = validateLocalSnapshot(snapshot);
    if (issues.length > 0) {
      return Promise.resolve({ ok: false, reason: "invalid-workspace", issues });
    }

    return this.db.transaction(
      "rw",
      this.db.workspaceCopies,
      this.db.workspaceOutbox,
      async (): Promise<StageWorkspaceUpdateResult> => {
        const current = await this.db.workspaceCopies.get(snapshot.id);
        if (current === undefined) {
          return { ok: false, reason: "not-found" };
        }

        const newGeneration = nextLocalGeneration(current.localGeneration);
        const now = readClock(this.now);
        const keepConflict = current.syncState === "conflict";
        const workspace: LocalWorkspaceRecord = {
          id: current.id,
          snapshot,
          serverRevision: current.serverRevision,
          localGeneration: newGeneration,
          syncState: keepConflict ? "conflict" : "dirty",
          ...(keepConflict && current.conflictRevision !== undefined
            ? { conflictRevision: current.conflictRevision }
            : {}),
          updatedAt: now,
          lastSyncedAt: current.lastSyncedAt,
        };
        const existingOutbox = await this.db.workspaceOutbox.get(snapshot.id);
        const outbox: WorkspaceOutboxEntry = {
          workspaceId: current.id,
          operation: current.serverRevision === null ? "create" : "save",
          baseRevision: current.serverRevision,
          snapshot,
          localGeneration: newGeneration,
          queuedAt: existingOutbox !== undefined ? existingOutbox.queuedAt : now,
        };
        await this.db.workspaceCopies.put(workspace);
        await this.db.workspaceOutbox.put(outbox);
        return { ok: true, workspace, outbox };
      }
    );
  }

  acknowledgeWorkspaceSync(
    _input: AcknowledgeWorkspaceSyncInput
  ): Promise<AcknowledgeWorkspaceSyncResult> {
    return notImplemented("acknowledgeWorkspaceSync");
  }

  markWorkspaceConflict(
    _input: MarkWorkspaceConflictInput
  ): Promise<MarkWorkspaceConflictResult> {
    return notImplemented("markWorkspaceConflict");
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Open the durable local workspace store.
 *
 * Awaits the IndexedDB open explicitly, so schema/open failures surface at
 * initialization time instead of on the first query.
 */
export async function openLocalWorkspaceStore(
  options?: OpenLocalWorkspaceStoreOptions
): Promise<LocalWorkspaceStore> {
  const resolved = options ?? {};
  const databaseName = resolved.databaseName ?? DEFAULT_DATABASE_NAME;
  if (databaseName.trim().length === 0) {
    throw new RangeError(
      `databaseName must be non-empty after trimming, received: "${databaseName}"`
    );
  }

  let dexieOptions: DexieOptions | undefined;
  if (resolved.indexedDB !== undefined && resolved.IDBKeyRange !== undefined) {
    dexieOptions = {
      indexedDB: resolved.indexedDB,
      IDBKeyRange: resolved.IDBKeyRange,
    };
  } else if (resolved.indexedDB !== undefined || resolved.IDBKeyRange !== undefined) {
    throw new Error(
      "indexedDB and IDBKeyRange must be supplied together in OpenLocalWorkspaceStoreOptions"
    );
  }

  const db = new VelaDeskLocalDatabase(databaseName, dexieOptions);
  await db.open();
  return new LocalWorkspaceStoreImpl(db, resolved.now ?? Date.now);
}
