import { and, asc, eq } from "drizzle-orm";
import { validateWorkspace } from "@veladesk/domain";
import type { WorkspaceId, WorkspaceSnapshot } from "@veladesk/domain";

import type { VelaDeskDatabase } from "./connection";
import { workspaceRevisions, workspaces } from "./schema";
import {
  WORKSPACE_SNAPSHOT_VERSION,
  deserializeWorkspaceSnapshot,
  serializeWorkspaceSnapshot,
} from "./serialization";
import type {
  CreateWorkspaceResult,
  SaveWorkspaceResult,
  StoredWorkspace,
  WorkspaceRepositoryOptions,
  WorkspaceRevision,
  WorkspaceRevisionSummary,
  WorkspaceSummary,
} from "./types";

/**
 * Persistence boundary of VelaDesk workspaces.
 *
 * Every write validates the snapshot with the domain validator first, and
 * every successful create/save bumps the per-workspace revision and appends
 * an immutable revision row in the same transaction. Revisions are never
 * compared or deduplicated by content: a save is a persistence commit
 * boundary, so identical snapshots still produce revision + 1.
 */
export interface WorkspaceRepository {
  createWorkspace(snapshot: WorkspaceSnapshot): CreateWorkspaceResult;
  loadWorkspace(id: WorkspaceId): StoredWorkspace | undefined;
  saveWorkspace(snapshot: WorkspaceSnapshot, expectedRevision: number): SaveWorkspaceResult;
  listWorkspaces(): readonly WorkspaceSummary[];
  loadWorkspaceRevision(
    workspaceId: WorkspaceId,
    revision: number,
  ): WorkspaceRevision | undefined;
  listWorkspaceRevisions(workspaceId: WorkspaceId): readonly WorkspaceRevisionSummary[];
}

interface WorkspaceRow {
  readonly id: string;
  readonly name: string;
  readonly revision: number;
  readonly snapshotVersion: number;
  readonly snapshotJson: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

function readClock(options: WorkspaceRepositoryOptions): () => number {
  return options.now ?? Date.now;
}

/** One clock read per write: finite integer >= 0, else RangeError. */
function nextTimestamp(clock: () => number): number {
  const value = clock();
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`clock must return a finite integer >= 0, received: ${value}`);
  }
  return value;
}

function toStoredWorkspace(row: WorkspaceRow): StoredWorkspace {
  return {
    snapshot: deserializeWorkspaceSnapshot(row.snapshotJson, row.snapshotVersion),
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Positive-integer guard for user-supplied revision arguments. */
function assertPositiveIntegerRevision(revision: number, name: string): void {
  if (!Number.isInteger(revision) || revision <= 0) {
    throw new RangeError(`${name} must be a positive integer, received: ${revision}`);
  }
}

export function createWorkspaceRepository(
  database: VelaDeskDatabase,
  options: WorkspaceRepositoryOptions = {},
): WorkspaceRepository {
  const clock = readClock(options);
  const orm = database.orm;

  return {
    createWorkspace(snapshot): CreateWorkspaceResult {
      const issues = validateWorkspace(snapshot);
      if (issues.length > 0) {
        return { ok: false, reason: "invalid-workspace", issues };
      }

      const existing = orm.select().from(workspaces).where(eq(workspaces.id, snapshot.id)).get();
      if (existing !== undefined) {
        return { ok: false, reason: "already-exists" };
      }

      const timestamp = nextTimestamp(clock);
      const snapshotJson = serializeWorkspaceSnapshot(snapshot);

      orm.transaction((tx) => {
        tx.insert(workspaces)
          .values({
            id: snapshot.id,
            name: snapshot.name,
            revision: 1,
            snapshotVersion: WORKSPACE_SNAPSHOT_VERSION,
            snapshotJson,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .run();
        tx.insert(workspaceRevisions)
          .values({
            workspaceId: snapshot.id,
            revision: 1,
            snapshotVersion: WORKSPACE_SNAPSHOT_VERSION,
            snapshotJson,
            createdAt: timestamp,
          })
          .run();
      });

      return {
        ok: true,
        workspace: {
          snapshot,
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      };
    },

    loadWorkspace(id) {
      const row = orm.select().from(workspaces).where(eq(workspaces.id, id)).get();
      return row === undefined ? undefined : toStoredWorkspace(row);
    },

    saveWorkspace(snapshot, expectedRevision): SaveWorkspaceResult {
      assertPositiveIntegerRevision(expectedRevision, "expectedRevision");

      const issues = validateWorkspace(snapshot);
      if (issues.length > 0) {
        return { ok: false, reason: "invalid-workspace", issues };
      }

      const current = orm.select().from(workspaces).where(eq(workspaces.id, snapshot.id)).get();
      if (current === undefined) {
        return { ok: false, reason: "not-found" };
      }
      if (current.revision !== expectedRevision) {
        return { ok: false, reason: "revision-conflict", actualRevision: current.revision };
      }

      const timestamp = nextTimestamp(clock);
      const snapshotJson = serializeWorkspaceSnapshot(snapshot);
      const newRevision = current.revision + 1;

      orm.transaction((tx) => {
        tx.update(workspaces)
          .set({
            name: snapshot.name,
            revision: newRevision,
            snapshotVersion: WORKSPACE_SNAPSHOT_VERSION,
            snapshotJson,
            updatedAt: timestamp,
          })
          .where(eq(workspaces.id, snapshot.id))
          .run();
        tx.insert(workspaceRevisions)
          .values({
            workspaceId: snapshot.id,
            revision: newRevision,
            snapshotVersion: WORKSPACE_SNAPSHOT_VERSION,
            snapshotJson,
            createdAt: timestamp,
          })
          .run();
      });

      return {
        ok: true,
        workspace: {
          snapshot,
          revision: newRevision,
          createdAt: current.createdAt,
          updatedAt: timestamp,
        },
      };
    },

    listWorkspaces(): readonly WorkspaceSummary[] {
      const rows = orm
        .select({
          id: workspaces.id,
          name: workspaces.name,
          revision: workspaces.revision,
          createdAt: workspaces.createdAt,
          updatedAt: workspaces.updatedAt,
        })
        .from(workspaces)
        .orderBy(asc(workspaces.createdAt), asc(workspaces.id))
        .all();

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        revision: row.revision,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
    },

    loadWorkspaceRevision(workspaceId, revision) {
      assertPositiveIntegerRevision(revision, "revision");

      const row = orm
        .select()
        .from(workspaceRevisions)
        .where(
          and(
            eq(workspaceRevisions.workspaceId, workspaceId),
            eq(workspaceRevisions.revision, revision),
          ),
        )
        .get();

      if (row === undefined) {
        return undefined;
      }

      return {
        snapshot: deserializeWorkspaceSnapshot(row.snapshotJson, row.snapshotVersion),
        revision: row.revision,
        createdAt: row.createdAt,
      };
    },

    listWorkspaceRevisions(workspaceId): readonly WorkspaceRevisionSummary[] {
      const rows = orm
        .select({
          workspaceId: workspaceRevisions.workspaceId,
          revision: workspaceRevisions.revision,
          createdAt: workspaceRevisions.createdAt,
        })
        .from(workspaceRevisions)
        .where(eq(workspaceRevisions.workspaceId, workspaceId))
        .orderBy(asc(workspaceRevisions.revision))
        .all();

      return rows.map((row) => ({
        workspaceId: row.workspaceId,
        revision: row.revision,
        createdAt: row.createdAt,
      }));
    },
  };
}
