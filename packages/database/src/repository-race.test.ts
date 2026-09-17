import { describe, expect, it } from "vitest";

import type { WorkspaceSnapshot } from "@veladesk/domain";

import { openDatabase } from "./connection";
import { createWorkspaceRepository } from "./repository";
import { buildRichWorkspaceSnapshot } from "./repository-fixtures";
import { MIGRATIONS_FOLDER, createTempDatabaseFile } from "./test-support";
import { applyMigrations } from "./migrations";
import type { VelaDeskDatabase } from "./connection";

/**
 * Regression tests for check/write interleaving races between two
 * connections on the same file-backed database. The interleaving is forced
 * through repository B's injectable clock: while B is between its read and
 * its write, A commits a competing write. These races must resolve into
 * repository results (already-exists / revision-conflict), never into
 * SQLite constraint exceptions or lost updates.
 */

interface RaceHarness {
  readonly connectionA: VelaDeskDatabase;
  readonly connectionB: VelaDeskDatabase;
  readonly repositoryA: ReturnType<typeof createWorkspaceRepository>;
  readonly repositoryB: ReturnType<typeof createWorkspaceRepository>;
  dispose(): void;
}

function createRaceHarness(interleave: () => void): RaceHarness {
  const tempFile = createTempDatabaseFile("race.db");
  const connectionA = openDatabase({ filename: tempFile.filename });
  const connectionB = openDatabase({ filename: tempFile.filename });
  applyMigrations(connectionA, MIGRATIONS_FOLDER);
  applyMigrations(connectionB, MIGRATIONS_FOLDER);

  const repositoryA = createWorkspaceRepository(connectionA, { now: () => 1_000 });

  let armed = true;
  const repositoryB = createWorkspaceRepository(connectionB, {
    now: () => {
      if (armed) {
        armed = false;
        interleave();
      }
      return 1_000;
    },
  });

  return {
    connectionA,
    connectionB,
    repositoryA,
    repositoryB,
    dispose: () => {
      connectionA.close();
      connectionB.close();
      tempFile.cleanup();
    },
  };
}

describe("atomic create race", () => {
  it("resolves a concurrent create as already-exists instead of a PK exception", () => {
    const snapshot = buildRichWorkspaceSnapshot();
    const harness = createRaceHarness(() => {
      // Fires once, while B is between its existence read and its write:
      // A commits the same workspace id first.
      const result = harness?.repositoryA.createWorkspace(snapshot);
      expect(result?.ok).toBe(true);
    });

    try {
      const raced = harness.repositoryB.createWorkspace(snapshot);

      expect(raced).toEqual({ ok: false, reason: "already-exists" });

      // Final database: one workspace, only revision 1 (A's).
      const workspaceRows = harness.connectionA.sqlite
        .prepare("select id, revision from workspaces")
        .all() as Array<{ id: string; revision: number }>;
      expect(workspaceRows).toEqual([{ id: "workspace-1", revision: 1 }]);

      const revisionRows = harness.connectionA.sqlite
        .prepare("select revision from workspace_revisions order by revision")
        .all() as Array<{ revision: number }>;
      expect(revisionRows).toEqual([{ revision: 1 }]);

      expect(harness.repositoryA.loadWorkspace("workspace-1")?.snapshot.name).toBe("My Desk");
    } finally {
      harness.dispose();
    }
  });
});

describe("atomic save CAS race", () => {
  it("resolves a save interleaving as revision-conflict without losing A's write", () => {
    const snapshot = buildRichWorkspaceSnapshot();
    const renamedA: WorkspaceSnapshot = { ...snapshot, name: "Saved by A" };
    const renamedB: WorkspaceSnapshot = { ...snapshot, name: "Saved by B" };

    const harness = createRaceHarness(() => {
      // Fires once, while B is between its revision read and its write:
      // A commits revision 2 first.
      const result = harness?.repositoryA.saveWorkspace(renamedA, 1);
      expect(result?.ok).toBe(true);
    });

    try {
      expect(harness.repositoryA.createWorkspace(snapshot).ok).toBe(true);

      const raced = harness.repositoryB.saveWorkspace(renamedB, 1);

      expect(raced).toEqual({ ok: false, reason: "revision-conflict", actualRevision: 2 });

      // B did not overwrite A and no revision 3 appeared.
      const current = harness.repositoryA.loadWorkspace("workspace-1");
      expect(current?.revision).toBe(2);
      expect(current?.snapshot.name).toBe("Saved by A");

      const revisions = harness.repositoryA.listWorkspaceRevisions("workspace-1");
      expect(revisions.map((summary) => summary.revision)).toEqual([1, 2]);
      expect(harness.repositoryA.loadWorkspaceRevision("workspace-1", 2)?.snapshot.name).toBe(
        "Saved by A",
      );
    } finally {
      harness.dispose();
    }
  });
});
