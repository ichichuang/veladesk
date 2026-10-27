import { afterEach, describe, expect, it } from "vitest";

import type { WorkspaceSnapshot } from "@veladesk/domain";

import { openDatabase } from "./connection";
import type { VelaDeskDatabase } from "./connection";
import { applyMigrations } from "./migrations";
import { buildRichWorkspaceSnapshot, createRepositoryContext } from "./repository-fixtures";
import type { RepositoryTestContext } from "./repository-fixtures";
import { createWorkspaceRepository } from "./repository";
import { MIGRATIONS_FOLDER } from "./test-support";

/**
 * Revision retention (task vd-guard): after every save the same
 * transaction prunes revisions older than the newest minus the retention
 * count. The current revision always survives, revision numbers keep
 * increasing and are never reused, and listing/conflict behaviour is
 * unchanged.
 */

const contexts: RepositoryTestContext[] = [];

function context(): RepositoryTestContext {
  const created = createRepositoryContext();
  contexts.push(created);
  return created;
}

afterEach(() => {
  for (const item of contexts.splice(0)) {
    item.cleanup();
  }
});

function renamed(snapshot: WorkspaceSnapshot, name: string): WorkspaceSnapshot {
  return { ...snapshot, name };
}

describe("createWorkspaceRepository maxRevisionsPerWorkspace option", () => {
  it.each([0, -1, 1.5, Number.NaN])("rejects the invalid value %s", (value) => {
    const database = openDatabase({ filename: ":memory:" });
    try {
      applyMigrations(database, MIGRATIONS_FOLDER);
      expect(() =>
        createWorkspaceRepository(database, { maxRevisionsPerWorkspace: value }),
      ).toThrow(RangeError);
    } finally {
      database.close();
    }
  });
});

describe("revision pruning with the default retention of 50", () => {
  it("keeps only the newest 50 revisions across many saves", () => {
    const { repository } = context();
    const snapshot = buildRichWorkspaceSnapshot();
    repository.createWorkspace(snapshot);

    let expected = 1;
    for (let revision = 2; revision <= 56; revision += 1) {
      const result = repository.saveWorkspace(renamed(snapshot, `Rev ${revision}`), expected);
      expect(result.ok).toBe(true);
      expected = revision;
    }

    // 56 revisions written; retention keeps 7..56 (50 rows).
    const listed = repository.listWorkspaceRevisions("workspace-1");
    expect(listed).toHaveLength(50);
    expect(listed[0]?.revision).toBe(7);
    expect(listed[49]?.revision).toBe(56);
    expect(repository.loadWorkspaceRevision("workspace-1", 6)).toBeUndefined();
    expect(repository.loadWorkspaceRevision("workspace-1", 7)?.snapshot.name).toBe("Rev 7");
    // The current revision is always present and matches the live row.
    expect(repository.loadWorkspaceRevision("workspace-1", 56)?.snapshot).toEqual(
      repository.loadWorkspace("workspace-1")?.snapshot,
    );
  });

  it("prunes nothing while the workspace is inside the window", () => {
    const { repository } = context();
    const snapshot = buildRichWorkspaceSnapshot();
    repository.createWorkspace(snapshot);
    for (let revision = 2; revision <= 50; revision += 1) {
      repository.saveWorkspace(snapshot, revision - 1);
    }

    expect(repository.listWorkspaceRevisions("workspace-1")).toHaveLength(50);
    expect(repository.loadWorkspaceRevision("workspace-1", 1)?.snapshot.name).toBe("My Desk");
  });
});

describe("revision pruning with an injected small retention", () => {
  function prunedRepository(maxRevisions: number): {
    database: VelaDeskDatabase;
    repository: ReturnType<typeof createWorkspaceRepository>;
  } {
    const database = openDatabase({ filename: ":memory:" });
    applyMigrations(database, MIGRATIONS_FOLDER);
    return {
      database,
      repository: createWorkspaceRepository(database, {
        maxRevisionsPerWorkspace: maxRevisions,
        now: () => 1_000,
      }),
    };
  }

  it("keeps the newest 3 across many saves; numbers keep increasing, never reused", () => {
    const { database, repository } = prunedRepository(3);
    try {
      const snapshot = buildRichWorkspaceSnapshot();
      repository.createWorkspace(snapshot);
      for (let revision = 2; revision <= 10; revision += 1) {
        const result = repository.saveWorkspace(renamed(snapshot, `Rev ${revision}`), revision - 1);
        expect(result.ok).toBe(true);
      }

      const listed = repository.listWorkspaceRevisions("workspace-1");
      expect(listed.map((row) => row.revision)).toEqual([8, 9, 10]);
      expect(repository.loadWorkspaceRevision("workspace-1", 7)).toBeUndefined();
      expect(repository.loadWorkspace("workspace-1")?.revision).toBe(10);

      // The next save continues from the live revision, not from the rows.
      const next = repository.saveWorkspace(renamed(snapshot, "Rev 11"), 10);
      expect(next.ok && next.workspace.revision).toBe(11);
      expect(repository.listWorkspaceRevisions("workspace-1").map((row) => row.revision)).toEqual([
        9, 10, 11,
      ]);
    } finally {
      database.close();
    }
  });

  it("retention 1 keeps exactly the current revision", () => {
    const { database, repository } = prunedRepository(1);
    try {
      const snapshot = buildRichWorkspaceSnapshot();
      repository.createWorkspace(snapshot);
      repository.saveWorkspace(renamed(snapshot, "Second"), 1);

      const listed = repository.listWorkspaceRevisions("workspace-1");
      expect(listed.map((row) => row.revision)).toEqual([2]);
      expect(repository.loadWorkspaceRevision("workspace-1", 1)).toBeUndefined();
      expect(repository.loadWorkspaceRevision("workspace-1", 2)?.snapshot.name).toBe("Second");
      expect(repository.loadWorkspace("workspace-1")?.snapshot.name).toBe("Second");
    } finally {
      database.close();
    }
  });

  it("a stale expectedRevision still conflicts with the actual revision after pruning", () => {
    const { database, repository } = prunedRepository(2);
    try {
      const snapshot = buildRichWorkspaceSnapshot();
      repository.createWorkspace(snapshot);
      repository.saveWorkspace(renamed(snapshot, "Second"), 1);
      repository.saveWorkspace(renamed(snapshot, "Third"), 2);

      // Revision 1 was pruned, but the CAS compares against the live row.
      const stale = repository.saveWorkspace(renamed(snapshot, "Stale"), 1);
      expect(stale).toEqual({ ok: false, reason: "revision-conflict", actualRevision: 3 });
    } finally {
      database.close();
    }
  });

  it("renameWorkspace prunes in the same transaction (it re-saves the snapshot)", () => {
    const { database, repository } = prunedRepository(2);
    try {
      const snapshot = buildRichWorkspaceSnapshot();
      repository.createWorkspace(snapshot);
      repository.saveWorkspace(renamed(snapshot, "Second"), 1);
      repository.saveWorkspace(renamed(snapshot, "Third"), 2);

      const renamedResult = repository.renameWorkspace("workspace-1", "Fourth", 3);
      expect(renamedResult.ok).toBe(true);

      expect(repository.listWorkspaceRevisions("workspace-1").map((row) => row.revision)).toEqual([
        3, 4,
      ]);
      expect(repository.loadWorkspaceRevision("workspace-1", 4)?.snapshot.name).toBe("Fourth");
    } finally {
      database.close();
    }
  });

  it("createWorkspace does not prune its own revision 1", () => {
    const { database, repository } = prunedRepository(2);
    try {
      repository.createWorkspace(buildRichWorkspaceSnapshot());

      expect(repository.listWorkspaceRevisions("workspace-1").map((row) => row.revision)).toEqual([
        1,
      ]);
    } finally {
      database.close();
    }
  });
});
