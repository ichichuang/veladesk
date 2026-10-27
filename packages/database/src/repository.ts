import { and, asc, eq, lt } from "drizzle-orm";
import { validateWorkspace } from "@veladesk/domain";
import type { WorkspaceId, WorkspaceSnapshot } from "@veladesk/domain";

import type { VelaDeskDatabase } from "./connection";
import { workspaceRevisions, workspaces } from "./schema";
import {
  WORKSPACE_SNAPSHOT_VERSION,
  deserializeWorkspaceSnapshot,
  serializeWorkspaceSnapshot,
} from "./serialization";
import { DEFAULT_MAX_REVISIONS_PER_WORKSPACE } from "./types";
import type {
  CreateWorkspaceResult,
  RenameWorkspaceResult,
  DeleteWorkspaceResult,
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
 * an immutable revision row in the same transaction; that transaction also
 * prunes revisions older than the retention window (default 50). Revisions
 * are never compared or deduplicated by content: a save is a persistence
 * commit boundary, so identical snapshots still produce revision + 1.
 *
 * Concurrency is resolved by the database, not by JavaScript pre-reads:
 * creation races are settled by `ON CONFLICT DO NOTHING` on the primary
 * key (surfaced as `already-exists`), and saves are a compare-and-swap —
 * a conditional UPDATE whose WHERE clause carries both the workspace id
 * and the expected revision (misses surface as `revision-conflict` or
 * `not-found`). Business races never escape as SQLite exceptions.
 */
export interface WorkspaceRepository {
  createWorkspace(snapshot: WorkspaceSnapshot): CreateWorkspaceResult;
  loadWorkspace(id: WorkspaceId): StoredWorkspace | undefined;
  saveWorkspace(snapshot: WorkspaceSnapshot, expectedRevision: number): SaveWorkspaceResult;
  renameWorkspace(id: WorkspaceId, name: string, expectedRevision?: number): RenameWorkspaceResult;
  deleteWorkspace(id: WorkspaceId, expectedRevision?: number): DeleteWorkspaceResult;
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
  const maxRevisions = options.maxRevisionsPerWorkspace ?? DEFAULT_MAX_REVISIONS_PER_WORKSPACE;
  if (!Number.isInteger(maxRevisions) || maxRevisions < 1) {
    throw new RangeError(`maxRevisionsPerWorkspace must be an integer >= 1, received: ${maxRevisions}`);
  }

  const repository: WorkspaceRepository = {
    createWorkspace(snapshot): CreateWorkspaceResult {
      const issues = validateWorkspace(snapshot);
      if (snapshot.name.trim().length > 40) {
        return { ok: false, reason: "invalid-workspace", issues: [{ type: "invalid-workspace-name" }] };
      }
      if (issues.length > 0) {
        return { ok: false, reason: "invalid-workspace", issues };
      }

      const timestamp = nextTimestamp(clock);
      const snapshotJson = serializeWorkspaceSnapshot(snapshot);

      // Atomic create: the database, not a prior SELECT, decides whether
      // the id is free. ON CONFLICT DO NOTHING keeps the insert race-free;
      // changes === 0 means another writer committed this id first.
      const inserted = orm
        .transaction((tx): "created" | "already-exists" | "workspace-limit" | "name-conflict" => {
          const existing = tx.select().from(workspaces).all();
          if (existing.some(row => row.id === snapshot.id)) return "already-exists";
          if (existing.length >= 10) return "workspace-limit";
          const result = tx
            .insert(workspaces)
            .values({
              id: snapshot.id,
              name: snapshot.name,
              revision: 1,
              snapshotVersion: WORKSPACE_SNAPSHOT_VERSION,
              snapshotJson,
              createdAt: timestamp,
              updatedAt: timestamp,
            })
            .onConflictDoNothing({ target: workspaces.id })
            .run();

          if (result.changes === 0) {
            return "already-exists";
          }

          tx.insert(workspaceRevisions)
            .values({
              workspaceId: snapshot.id,
              revision: 1,
              snapshotVersion: WORKSPACE_SNAPSHOT_VERSION,
              snapshotJson,
              createdAt: timestamp,
            })
            .run();
          // No retention pruning here by design: creation just inserted
          // revision 1 of a brand-new id (revisions of other ids never
          // exist without their workspace row), so there is nothing older
          // than the window to prune.
          return "created";
        }, { behavior: "immediate" });

      if (inserted !== "created") {
        return { ok: false, reason: inserted };
      }

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

      const timestamp = nextTimestamp(clock);
      const snapshotJson = serializeWorkspaceSnapshot(snapshot);
      const newRevision = expectedRevision + 1;

      // Database-level compare-and-swap: the UPDATE only lands when the row
      // still carries expectedRevision. A JavaScript pre-read is never the
      // concurrency boundary; changes === 0 means not-found or a lost race.
      const cas = orm.transaction((tx): { updated: true; createdAt: number } | { updated: false } => {
        const result = tx
          .update(workspaces)
          .set({
            name: snapshot.name,
            revision: newRevision,
            snapshotVersion: WORKSPACE_SNAPSHOT_VERSION,
            snapshotJson,
            updatedAt: timestamp,
          })
          .where(and(eq(workspaces.id, snapshot.id), eq(workspaces.revision, expectedRevision)))
          .run();

        if (result.changes === 0) {
          return { updated: false };
        }

        const row = tx
          .select({ createdAt: workspaces.createdAt })
          .from(workspaces)
          .where(eq(workspaces.id, snapshot.id))
          .get();

        tx.insert(workspaceRevisions)
          .values({
            workspaceId: snapshot.id,
            revision: newRevision,
            snapshotVersion: WORKSPACE_SNAPSHOT_VERSION,
            snapshotJson,
            createdAt: timestamp,
          })
          .run();

        // Retention (task vd-guard): prune in the SAME transaction as the
        // insert so history can never outgrow the budget, even on crash.
        // Only revisions strictly older than the retention window go; the
        // just-written current revision is never a candidate. Revision
        // numbers keep increasing and are never reused — they come from
        // the CAS above, not from the surviving rows.
        tx.delete(workspaceRevisions)
          .where(
            and(
              eq(workspaceRevisions.workspaceId, snapshot.id),
              lt(workspaceRevisions.revision, newRevision - maxRevisions + 1),
            ),
          )
          .run();

        return { updated: true, createdAt: row?.createdAt ?? timestamp };
      });

      if (!cas.updated) {
        const current = orm.select().from(workspaces).where(eq(workspaces.id, snapshot.id)).get();
        if (current === undefined) {
          return { ok: false, reason: "not-found" };
        }
        return { ok: false, reason: "revision-conflict", actualRevision: current.revision };
      }

      return {
        ok: true,
        workspace: {
          snapshot,
          revision: newRevision,
          createdAt: cas.createdAt,
          updatedAt: timestamp,
        },
      };
    },


    renameWorkspace(id, name, expectedRevision): RenameWorkspaceResult {
      if (name.trim().length === 0 || name.trim().length > 40) return { ok: false, reason: "invalid-name" };
      return orm.transaction(() => {
        const current = repository.loadWorkspace(id);
        if (current === undefined) return { ok: false, reason: "not-found" };
        if (repository.listWorkspaces().some(row => row.id !== id && row.name.trim() === name.trim())) {
          return { ok: false, reason: "name-conflict" };
        }
        return repository.saveWorkspace({ ...current.snapshot, name: name.trim() }, expectedRevision ?? current.revision);
      }, { behavior: "immediate" });
    },

    deleteWorkspace(id, expectedRevision): DeleteWorkspaceResult {
      if (expectedRevision !== undefined) assertPositiveIntegerRevision(expectedRevision, "expectedRevision");
      let cleanup: ReturnType<NonNullable<WorkspaceRepositoryOptions["prepareAssetCleanup"]>> | undefined;
      let result: DeleteWorkspaceResult;
      try {
        result = orm.transaction((tx): DeleteWorkspaceResult => {
          const rows = tx.select().from(workspaces).all();
          const current = rows.find(row => row.id === id);
          if (current === undefined) return { ok: false, reason: "not-found" };
          if (rows.length === 1) return { ok: false, reason: "last-workspace" };
          if (expectedRevision !== undefined && current.revision !== expectedRevision) {
            return { ok: false, reason: "revision-conflict", actualRevision: current.revision };
          }
          const revisions = tx.select().from(workspaceRevisions).all();
          const owned = new Set<string>();
          const retained = new Set<string>();
          for (const row of [...rows.map(row => ({ ...row, workspaceId: row.id })), ...revisions]) {
            const target = row.workspaceId === id ? owned : retained;
            for (const assetId of snapshotAssetIds(deserializeWorkspaceSnapshot(row.snapshotJson, row.snapshotVersion))) target.add(assetId);
          }
          const deletedAssetIds = [...owned].filter(assetId => !retained.has(assetId));
          cleanup = options.prepareAssetCleanup?.(deletedAssetIds);
          tx.delete(workspaceRevisions).where(eq(workspaceRevisions.workspaceId, id)).run();
          tx.delete(workspaces).where(eq(workspaces.id, id)).run();
          return { ok: true, deletedAssetIds };
        }, { behavior: "immediate" });
      } catch (error) {
        cleanup?.rollback();
        throw error;
      }
      cleanup?.commit();
      return result;
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
  return repository;
}

/** Include historical references: revisions are still restorable data. */
function snapshotAssetIds(snapshot: WorkspaceSnapshot): string[] {
  const ids = snapshot.entities.flatMap(entity => entity.kind === "app" && entity.icon.kind === "asset" ? [entity.icon.assetId] : []);
  const wallpaper = snapshot.preferences.appearance?.wallpaper;
  if (wallpaper?.kind === "asset") ids.push(wallpaper.assetId);
  for (const page of snapshot.pages) if (page.wallpaper?.kind === "asset") ids.push(page.wallpaper.assetId);
  return ids;
}
