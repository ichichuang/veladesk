import { afterEach, describe, expect, it } from "vitest";

import type { WorkspaceSnapshot } from "@veladesk/domain";

import { buildRichWorkspaceSnapshot, createRepositoryContext } from "./repository-fixtures";
import type { RepositoryTestContext } from "./repository-fixtures";

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

function workspaceWithThreeRevisions(): RepositoryTestContext {
  const created = context();
  const snapshot = buildRichWorkspaceSnapshot();
  created.repository.createWorkspace(snapshot);
  created.clock.value = 2_000;
  created.repository.saveWorkspace(renamed(snapshot, "Second"), 1);
  created.clock.value = 3_000;
  created.repository.saveWorkspace(renamed(snapshot, "Third"), 2);
  return created;
}

describe("loadWorkspaceRevision", () => {
  it("returns the immutable snapshot of an old revision", () => {
    const { repository } = workspaceWithThreeRevisions();

    const first = repository.loadWorkspaceRevision("workspace-1", 1);

    expect(first?.revision).toBe(1);
    expect(first?.snapshot.name).toBe("My Desk");
    expect(first?.snapshot).toEqual(buildRichWorkspaceSnapshot());
  });

  it("returns the snapshot as it was at that revision, not the current one", () => {
    const { repository } = workspaceWithThreeRevisions();

    expect(repository.loadWorkspaceRevision("workspace-1", 2)?.snapshot.name).toBe("Second");
    expect(repository.loadWorkspaceRevision("workspace-1", 3)?.snapshot.name).toBe("Third");
    expect(repository.loadWorkspace("workspace-1")?.snapshot.name).toBe("Third");
  });

  it("keeps custom protocol urls, widget config, layout and ordering in history", () => {
    const { repository } = workspaceWithThreeRevisions();

    const first = repository.loadWorkspaceRevision("workspace-1", 1);
    const snapshot = first?.snapshot;

    expect(snapshot).toEqual(buildRichWorkspaceSnapshot());
    const obsidian = snapshot?.entities.find((entity) => entity.id === "app-1");
    expect(obsidian).toMatchObject({ url: "obsidian://open?vault=Notes" });
    const clock = snapshot?.entities.find((entity) => entity.id === "widget-1");
    expect(clock).toMatchObject({
      config: { timezone: "Europe/Berlin", showSeconds: false, fallbackLabel: null },
    });
    expect(
      snapshot?.entities.find((entity) => entity.id === "widget-1"),
    ).toMatchObject({ config: { schedule: { days: [1, 2, 3, 4, 5] } } });
    expect(snapshot?.pages[1]?.layout.items[0]).toEqual({
      id: "app-1",
      position: { column: 0, row: 0 },
      span: { columns: 1, rows: 2 },
    });
    expect(
      snapshot?.entities.find((entity) => entity.id === "folder-1"),
    ).toMatchObject({ children: ["app-2", "app-3"] });
    expect(snapshot?.dock.items).toEqual(["app-2", "folder-1", "app-4"]);
  });

  it("returns undefined for missing workspaces and revisions", () => {
    const { repository } = workspaceWithThreeRevisions();

    expect(repository.loadWorkspaceRevision("missing", 1)).toBeUndefined();
    expect(repository.loadWorkspaceRevision("workspace-1", 99)).toBeUndefined();
  });

  it("rejects a non-positive or fractional revision", () => {
    const { repository } = workspaceWithThreeRevisions();

    for (const bad of [0, -1, 2.5, Number.NaN]) {
      expect(() => repository.loadWorkspaceRevision("workspace-1", bad)).toThrow(RangeError);
    }
  });
});

describe("listWorkspaceRevisions", () => {
  it("lists revision summaries ordered by revision ascending", () => {
    const { repository } = workspaceWithThreeRevisions();

    expect(repository.listWorkspaceRevisions("workspace-1")).toEqual([
      { workspaceId: "workspace-1", revision: 1, createdAt: 1_700_000_000_000 },
      { workspaceId: "workspace-1", revision: 2, createdAt: 2_000 },
      { workspaceId: "workspace-1", revision: 3, createdAt: 3_000 },
    ]);
  });

  it("returns an empty list for a missing workspace instead of throwing", () => {
    const { repository } = context();

    expect(repository.listWorkspaceRevisions("missing")).toEqual([]);
  });
});
