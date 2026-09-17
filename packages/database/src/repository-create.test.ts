import { afterEach, describe, expect, it } from "vitest";

import { validateWorkspace } from "@veladesk/domain";

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

describe("createWorkspace", () => {
  it("persists a valid workspace as revision 1 with one clock read", () => {
    const { repository, clock } = context();
    const snapshot = buildRichWorkspaceSnapshot();

    const result = repository.createWorkspace(snapshot);

    expect(result).toEqual({
      ok: true,
      workspace: {
        snapshot,
        revision: 1,
        createdAt: clock.value,
        updatedAt: clock.value,
      },
    });
    expect(clock.calls).toBe(1);
  });

  it("stores the rich snapshot so every ordering and custom value survives load", () => {
    const { repository } = context();
    const snapshot = buildRichWorkspaceSnapshot();
    repository.createWorkspace(snapshot);

    const loaded = repository.loadWorkspace("workspace-1");

    expect(validateWorkspace(loaded?.snapshot ?? snapshot)).toEqual([]);
    expect(loaded?.snapshot).toEqual(snapshot);
    // Spot-check what the round-trip must never flatten.
    const obsidian = loaded?.snapshot.entities.find((entity) => entity.id === "app-1");
    expect(obsidian).toMatchObject({ kind: "app", url: "obsidian://open?vault=Notes" });
    expect(loaded?.snapshot.pages.map((page) => page.id)).toEqual(["page-1", "page-2"]);
    expect(loaded?.snapshot.categories.map((category) => category.id)).toEqual([
      "category-1",
      "category-2",
    ]);
    expect(loaded?.snapshot.dock.items).toEqual(["app-2", "folder-1", "app-4"]);
    expect(
      loaded?.snapshot.entities.find((entity) => entity.id === "folder-1"),
    ).toMatchObject({ children: ["app-2", "app-3"] });
    expect(loaded?.snapshot.preferences.layoutLocked).toBe(false);
  });

  it("returns issues and writes nothing for an invalid snapshot", () => {
    const { repository, database } = context();
    const snapshot = {
      ...buildRichWorkspaceSnapshot(),
      name: "  ",
      dock: { items: ["ghost"] },
    };

    const result = repository.createWorkspace(snapshot);

    expect(result).toMatchObject({ ok: false, reason: "invalid-workspace" });
    if (result.ok || result.reason !== "invalid-workspace") {
      throw new Error("expected an invalid-workspace result");
    }
    expect(result.issues.length).toBeGreaterThan(0);
    expect(
      (database.sqlite.prepare("select count(*) as count from workspaces").get() as { count: number })
        .count,
    ).toBe(0);
    expect(
      (
        database.sqlite
          .prepare("select count(*) as count from workspace_revisions")
          .get() as { count: number }
      ).count,
    ).toBe(0);
  });

  it("rejects a duplicate workspace id", () => {
    const { repository } = context();
    const snapshot = buildRichWorkspaceSnapshot();

    expect(repository.createWorkspace(snapshot).ok).toBe(true);
    expect(repository.createWorkspace(snapshot)).toEqual({ ok: false, reason: "already-exists" });
  });

  it("does not mutate the input snapshot", () => {
    const { repository } = context();
    const snapshot = buildRichWorkspaceSnapshot();
    const before = structuredClone(snapshot);

    repository.createWorkspace(snapshot);

    expect(snapshot).toEqual(before);
  });

  it("rejects an invalid clock value", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 100.5, -1]) {
      const failing = createRepositoryContext({ now: value });
      try {
        expect(() => failing.repository.createWorkspace(buildRichWorkspaceSnapshot())).toThrow(
          RangeError,
        );
      } finally {
        failing.cleanup();
      }
    }
  });
});

describe("loadWorkspace", () => {
  it("returns undefined for a missing workspace", () => {
    const { repository } = context();

    expect(repository.loadWorkspace("missing")).toBeUndefined();
  });

  it("returns the current snapshot with row metadata", () => {
    const { repository, clock } = context();
    repository.createWorkspace(buildRichWorkspaceSnapshot());

    const loaded = repository.loadWorkspace("workspace-1");

    expect(loaded).toBeDefined();
    expect(loaded?.revision).toBe(1);
    expect(loaded?.createdAt).toBe(clock.value);
    expect(loaded?.updatedAt).toBe(clock.value);
  });
});

describe("listWorkspaces", () => {
  it("orders by createdAt ascending, then id ascending", () => {
    const { repository, clock } = context();
    const snapshot = buildRichWorkspaceSnapshot();

    clock.value = 3_000;
    repository.createWorkspace({ ...snapshot, id: "ws-z" });
    clock.value = 1_000;
    repository.createWorkspace({ ...snapshot, id: "ws-a" });
    clock.value = 2_000;
    repository.createWorkspace({ ...snapshot, id: "ws-m" });

    const listed = repository.listWorkspaces();

    expect(listed.map((summary) => summary.id)).toEqual(["ws-a", "ws-m", "ws-z"]);
    expect(listed.map((summary) => summary.createdAt)).toEqual([1_000, 2_000, 3_000]);
  });

  it("breaks createdAt ties with id ascending", () => {
    const { repository } = context();
    const snapshot = buildRichWorkspaceSnapshot();

    repository.createWorkspace({ ...snapshot, id: "ws-z" });
    repository.createWorkspace({ ...snapshot, id: "ws-a" });

    expect(repository.listWorkspaces().map((summary) => summary.id)).toEqual(["ws-a", "ws-z"]);
  });

  it("summarizes id, name, revision and timestamps without parsing snapshots", () => {
    const { repository, clock } = context();
    repository.createWorkspace(buildRichWorkspaceSnapshot());

    expect(repository.listWorkspaces()).toEqual([
      {
        id: "workspace-1",
        name: "My Desk",
        revision: 1,
        createdAt: clock.value,
        updatedAt: clock.value,
      },
    ]);
  });
});
