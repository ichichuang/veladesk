import { afterEach, describe, expect, it } from "vitest";

import type { WorkspaceSnapshot } from "@veladesk/domain";

import { openDatabase } from "./connection";
import { createWorkspaceRepository } from "./repository";
import { buildRichWorkspaceSnapshot, createRepositoryContext } from "./repository-fixtures";
import type { RepositoryTestContext } from "./repository-fixtures";
import { MIGRATIONS_FOLDER, createTempDatabaseFile } from "./test-support";
import { applyMigrations } from "./migrations";

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

describe("saveWorkspace", () => {
  it("bumps to revision 2, changes updatedAt and preserves createdAt", () => {
    const { repository, clock } = context();
    repository.createWorkspace(buildRichWorkspaceSnapshot());

    clock.value = 9_999;
    const result = repository.saveWorkspace(renamed(buildRichWorkspaceSnapshot(), "Renamed"), 1);

    expect(result).toEqual({
      ok: true,
      workspace: {
        snapshot: renamed(buildRichWorkspaceSnapshot(), "Renamed"),
        revision: 2,
        createdAt: 1_700_000_000_000,
        updatedAt: 9_999,
      },
    });
  });

  it("reads the clock exactly once per save", () => {
    const { repository, clock } = context();
    repository.createWorkspace(buildRichWorkspaceSnapshot());
    const callsBefore = clock.calls;

    repository.saveWorkspace(buildRichWorkspaceSnapshot(), 1);

    expect(clock.calls - callsBefore).toBe(1);
  });

  it("updates the listing projection name", () => {
    const { repository } = context();
    repository.createWorkspace(buildRichWorkspaceSnapshot());

    repository.saveWorkspace(renamed(buildRichWorkspaceSnapshot(), "Desk v2"), 1);

    expect(repository.listWorkspaces()[0]?.name).toBe("Desk v2");
    expect(repository.loadWorkspace("workspace-1")?.snapshot.name).toBe("Desk v2");
  });

  it("increases the revision monotonically across saves", () => {
    const { repository } = context();
    repository.createWorkspace(buildRichWorkspaceSnapshot());

    const second = repository.saveWorkspace(buildRichWorkspaceSnapshot(), 1);
    const third = repository.saveWorkspace(buildRichWorkspaceSnapshot(), 2);

    expect(second.ok && second.workspace.revision).toBe(2);
    expect(third.ok && third.workspace.revision).toBe(3);
    expect(repository.loadWorkspace("workspace-1")?.revision).toBe(3);
  });

  it("bumps the revision even when the snapshot content is identical", () => {
    const { repository } = context();
    repository.createWorkspace(buildRichWorkspaceSnapshot());

    const result = repository.saveWorkspace(buildRichWorkspaceSnapshot(), 1);

    expect(result.ok && result.workspace.revision).toBe(2);
    expect(repository.listWorkspaceRevisions("workspace-1")).toHaveLength(2);
  });

  it("rejects an invalid snapshot without touching the database", () => {
    const { repository, database } = context();
    repository.createWorkspace(buildRichWorkspaceSnapshot());
    const invalid = { ...buildRichWorkspaceSnapshot(), name: " " };

    const result = repository.saveWorkspace(invalid, 1);

    expect(result).toMatchObject({ ok: false, reason: "invalid-workspace" });
    const row = database.sqlite
      .prepare("select revision, name from workspaces where id = ?")
      .get("workspace-1") as { revision: number; name: string };
    expect(row.revision).toBe(1);
    expect(row.name).toBe("My Desk");
  });

  it("reports not-found for an unknown workspace", () => {
    const { repository } = context();

    expect(repository.saveWorkspace(buildRichWorkspaceSnapshot(), 1)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("reports a revision conflict with the actual revision", () => {
    const { repository } = context();
    repository.createWorkspace(buildRichWorkspaceSnapshot());
    repository.saveWorkspace(buildRichWorkspaceSnapshot(), 1);

    const stale = repository.saveWorkspace(buildRichWorkspaceSnapshot(), 1);

    expect(stale).toEqual({ ok: false, reason: "revision-conflict", actualRevision: 2 });
  });

  it("rejects a non-positive or fractional expectedRevision", () => {
    const { repository } = context();
    repository.createWorkspace(buildRichWorkspaceSnapshot());

    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => repository.saveWorkspace(buildRichWorkspaceSnapshot(), bad)).toThrow(RangeError);
    }
  });

  it("rejects an invalid clock value without writing", () => {
    const { repository, clock, database } = context();
    repository.createWorkspace(buildRichWorkspaceSnapshot());

    clock.value = Number.POSITIVE_INFINITY;
    expect(() => repository.saveWorkspace(buildRichWorkspaceSnapshot(), 1)).toThrow(RangeError);

    const row = database.sqlite
      .prepare("select revision from workspaces where id = ?")
      .get("workspace-1") as { revision: number };
    expect(row.revision).toBe(1);
  });

  it("does not mutate the input snapshot", () => {
    const { repository } = context();
    repository.createWorkspace(buildRichWorkspaceSnapshot());
    const snapshot = buildRichWorkspaceSnapshot();
    const before = structuredClone(snapshot);

    repository.saveWorkspace(snapshot, 1);

    expect(snapshot).toEqual(before);
  });
});

describe("optimistic concurrency across two connections", () => {
  it("lets the first save win and reports a conflict to the second", () => {
    const tempFile = createTempDatabaseFile("two-connections.db");
    let connectionA: ReturnType<typeof openDatabase> | undefined;
    let connectionB: ReturnType<typeof openDatabase> | undefined;
    try {
      connectionA = openDatabase({ filename: tempFile.filename });
      connectionB = openDatabase({ filename: tempFile.filename });
      applyMigrations(connectionA, MIGRATIONS_FOLDER);
      applyMigrations(connectionB, MIGRATIONS_FOLDER);

      const repoA = createWorkspaceRepository(connectionA, { now: () => 1_000 });
      const repoB = createWorkspaceRepository(connectionB, { now: () => 1_000 });

      const snapshot = buildRichWorkspaceSnapshot();
      expect(repoA.createWorkspace(snapshot).ok).toBe(true);

      const loadedA = repoA.loadWorkspace("workspace-1");
      const loadedB = repoB.loadWorkspace("workspace-1");
      expect(loadedA?.revision).toBe(1);
      expect(loadedB?.revision).toBe(1);

      const first = repoA.saveWorkspace(renamed(snapshot, "Saved by A"), 1);
      expect(first.ok && first.workspace.revision).toBe(2);

      const second = repoB.saveWorkspace(renamed(snapshot, "Saved by B"), 1);
      expect(second).toEqual({ ok: false, reason: "revision-conflict", actualRevision: 2 });

      // B did not overwrite A's revision.
      const current = repoA.loadWorkspace("workspace-1");
      expect(current?.snapshot.name).toBe("Saved by A");
      expect(current?.revision).toBe(2);
    } finally {
      connectionA?.close();
      connectionB?.close();
      tempFile.cleanup();
    }
  });
});

describe("transaction atomicity", () => {
  it("rolls the current row back when the revision insert fails", () => {
    const { repository, database } = context();
    const snapshot = buildRichWorkspaceSnapshot();
    repository.createWorkspace(snapshot);

    // Sabotage: occupy the (workspace_id, revision = 2) slot that save wants,
    // so the transaction's INSERT fails after its UPDATE succeeded.
    database.sqlite
      .prepare(
        "insert into workspace_revisions (workspace_id, revision, snapshot_version, snapshot_json, created_at) values (?, ?, ?, ?, ?)",
      )
      .run("workspace-1", 2, 1, "{}", 0);

    expect(() => repository.saveWorkspace(renamed(snapshot, "Must Roll Back"), 1)).toThrow();

    const current = repository.loadWorkspace("workspace-1");
    expect(current?.revision).toBe(1);
    expect(current?.snapshot.name).toBe("My Desk");
    expect(current?.updatedAt).toBe(1_700_000_000_000);
  });
});

describe("appearance preferences persistence", () => {
  const nonDefaultAppearance = {
    colorMode: "light",
    accentHue: 310,
    wallpaperPreset: "mist",
    surfaceOpacity: 0.7,
    blurPx: 8,
    radiusPx: 20,
    iconSize: "large",
  } as const;

  function withAppearance(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
    return {
      ...snapshot,
      preferences: { ...snapshot.preferences, appearance: nonDefaultAppearance },
    };
  }

  function legacySnapshot(): WorkspaceSnapshot {
    const snapshot = buildRichWorkspaceSnapshot();
    const preferences = { ...snapshot.preferences };
    delete (preferences as { appearance?: unknown }).appearance;
    return { ...snapshot, preferences };
  }

  it("persists a non-default appearance through create/save/load as part of the JSON snapshot", () => {
    const { repository } = context();
    repository.createWorkspace(withAppearance(buildRichWorkspaceSnapshot()));

    const saved = repository.saveWorkspace(
      withAppearance(renamed(buildRichWorkspaceSnapshot(), "Desk v2")),
      1
    );
    expect(saved.ok).toBe(true);

    const loaded = repository.loadWorkspace("workspace-1");
    expect(loaded?.snapshot.preferences.appearance).toEqual(nonDefaultAppearance);

    // History rows keep the appearance too (JSON snapshot storage).
    const revision2 = repository.loadWorkspaceRevision("workspace-1", 2);
    expect(revision2?.snapshot.preferences.appearance).toEqual(nonDefaultAppearance);
  });

  it("round-trips a legacy snapshot without appearance untouched", () => {
    const { repository } = context();
    repository.createWorkspace(legacySnapshot());

    repository.saveWorkspace(legacySnapshot(), 1);

    const loaded = repository.loadWorkspace("workspace-1");
    expect(loaded?.snapshot.preferences.appearance).toBeUndefined();
    expect(loaded?.snapshot.preferences.defaultPageId).toBe("page-1");
  });
});
