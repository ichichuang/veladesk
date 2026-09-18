import { createEmptyWorkspace } from "@veladesk/domain";
import type { WorkspaceSnapshot } from "@veladesk/domain";
import {
  applyMigrations,
  createWorkspaceRepository,
  openDatabase,
} from "@veladesk/database";
import type {
  CreateWorkspaceResult,
  SaveWorkspaceResult,
  StoredWorkspace,
  WorkspaceRepository,
} from "@veladesk/database";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { handleCreateWorkspace, handleGetWorkspace, handleListWorkspaces, handleSaveWorkspace } from "./workspace-handlers";

const realMigrationsDir = fileURLToPath(
  new URL("../../../../packages/database/drizzle", import.meta.url),
);

function snapshotJson(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "workspace-1",
    workspaceName: "My Desk",
    pageId: "page-1",
    pageName: "Home",
    grid: { columns: 12, rows: 8 },
  });
  return {
    ...base,
    entities: [
      {
        kind: "app",
        id: "app-1",
        name: "Obsidian",
        url: "obsidian://open?vault=Notes",
        icon: { kind: "favicon" },
        openMode: "new-tab",
        tags: [],
      },
    ],
    ...overrides,
  };
}

/** Programmable in-memory fake of the persistence boundary. */
function makeFakeRepository(overrides: {
  createResult?: CreateWorkspaceResult;
  saveResult?: SaveWorkspaceResult;
  loaded?: StoredWorkspace | undefined;
} = {}): WorkspaceRepository & {
  createdWith: WorkspaceSnapshot[];
  savedWith: Array<{ snapshot: WorkspaceSnapshot; expectedRevision: number }>;
} {
  return {
    createdWith: [],
    savedWith: [],
    createWorkspace(snapshot) {
      this.createdWith.push(snapshot);
      return overrides.createResult ?? { ok: false, reason: "already-exists" };
    },
    loadWorkspace() {
      return overrides.loaded;
    },
    saveWorkspace(snapshot, expectedRevision) {
      this.savedWith.push({ snapshot, expectedRevision });
      return overrides.saveResult ?? { ok: false, reason: "not-found" };
    },
    listWorkspaces() {
      return [];
    },
    loadWorkspaceRevision() {
      return undefined;
    },
    listWorkspaceRevisions() {
      return [];
    },
  };
}

function post(body: string): Request {
  return new Request("http://localhost/api/v1/workspaces", { method: "POST", body });
}

async function errorBody(response: Response): Promise<{ error: Record<string, unknown> }> {
  return (await response.json()) as { error: Record<string, unknown> };
}

describe("handleListWorkspaces", () => {
  it("returns 200 with the repository summaries and no-store caching", async () => {
    const repository = makeFakeRepository();
    const response = handleListWorkspaces(repository);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ workspaces: [] });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("handleCreateWorkspace", () => {
  it("creates and returns 201 with a Location header", async () => {
    const snapshot = snapshotJson();
    const stored: StoredWorkspace = { snapshot, revision: 1, createdAt: 1, updatedAt: 1 };
    const repository = makeFakeRepository({
      createResult: { ok: true, workspace: stored },
    });

    const response = await handleCreateWorkspace(
      repository,
      post(JSON.stringify({ snapshot })),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ workspace: stored });
    expect(response.headers.get("Location")).toBe("/api/v1/workspaces/workspace-1");
    expect(repository.createdWith).toEqual([snapshot]);
  });

  it("encodes the workspace id in the Location header", async () => {
    const snapshot = snapshotJson({ id: "my desk/sandbox" });
    const stored: StoredWorkspace = { snapshot, revision: 1, createdAt: 1, updatedAt: 1 };
    const repository = makeFakeRepository({
      createResult: { ok: true, workspace: stored },
    });

    const response = await handleCreateWorkspace(
      repository,
      post(JSON.stringify({ snapshot })),
    );

    expect(response.headers.get("Location")).toBe(
      "/api/v1/workspaces/my%20desk%2Fsandbox",
    );
  });

  it("maps already-exists to 409", async () => {
    const repository = makeFakeRepository({
      createResult: { ok: false, reason: "already-exists" },
    });

    const response = await handleCreateWorkspace(
      repository,
      post(JSON.stringify({ snapshot: snapshotJson() })),
    );

    expect(response.status).toBe(409);
    expect(await errorBody(response)).toEqual({ error: { code: "workspace-already-exists" } });
  });

  it("maps invalid-workspace to 422 with the issues", async () => {
    const repository = makeFakeRepository({
      createResult: {
        ok: false,
        reason: "invalid-workspace",
        issues: [{ type: "invalid-workspace-name" }],
      },
    });

    const response = await handleCreateWorkspace(
      repository,
      post(JSON.stringify({ snapshot: snapshotJson() })),
    );

    expect(response.status).toBe(422);
    expect(await errorBody(response)).toEqual({
      error: { code: "invalid-workspace", issues: [{ type: "invalid-workspace-name" }] },
    });
  });

  it("maps malformed JSON to 400 invalid-json", async () => {
    const repository = makeFakeRepository();

    const response = await handleCreateWorkspace(repository, post("{oops"));

    expect(response.status).toBe(400);
    expect(await errorBody(response)).toEqual({ error: { code: "invalid-json" } });
    expect(repository.createdWith).toEqual([]);
  });

  it.each([
    ["an empty object", {}],
    ["a non-record body", "snapshot"],
    ["a snapshot that fails the structural decode", { snapshot: { id: 1 } }],
  ])("maps %s to 400 invalid-request", async (_label, body) => {
    const repository = makeFakeRepository();

    const response = await handleCreateWorkspace(repository, post(JSON.stringify(body)));

    expect(response.status).toBe(400);
    expect(await errorBody(response)).toEqual({ error: { code: "invalid-request" } });
    expect(repository.createdWith).toEqual([]);
  });
});

describe("handleGetWorkspace", () => {
  it("returns 200 with the stored workspace", async () => {
    const snapshot = snapshotJson();
    const repository = makeFakeRepository({
      loaded: { snapshot, revision: 4, createdAt: 1, updatedAt: 2 },
    });

    const response = handleGetWorkspace(repository, "workspace-1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      workspace: { snapshot, revision: 4, createdAt: 1, updatedAt: 2 },
    });
  });

  it("maps a missing workspace to 404", async () => {
    const repository = makeFakeRepository({ loaded: undefined });

    const response = handleGetWorkspace(repository, "ghost");

    expect(response.status).toBe(404);
    expect(await errorBody(response)).toEqual({ error: { code: "workspace-not-found" } });
  });
});

describe("handleSaveWorkspace", () => {
  it("saves with the decoded expectedRevision and returns 200", async () => {
    const snapshot = snapshotJson();
    const repository = makeFakeRepository({
      saveResult: { ok: true, workspace: { snapshot, revision: 2, createdAt: 1, updatedAt: 3 } },
    });

    const response = await handleSaveWorkspace(
      repository,
      new Request("http://localhost/api/v1/workspaces/workspace-1", {
        method: "PUT",
        body: JSON.stringify({ snapshot, expectedRevision: 1 }),
      }),
      "workspace-1",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      workspace: { snapshot, revision: 2, createdAt: 1, updatedAt: 3 },
    });
    expect(repository.savedWith).toEqual([{ snapshot, expectedRevision: 1 }]);
  });

  it("maps revision-conflict to 409 with actualRevision", async () => {
    const repository = makeFakeRepository({
      saveResult: { ok: false, reason: "revision-conflict", actualRevision: 2 },
    });

    const response = await handleSaveWorkspace(
      repository,
      new Request("http://localhost/x", {
        method: "PUT",
        body: JSON.stringify({ snapshot: snapshotJson(), expectedRevision: 1 }),
      }),
      "workspace-1",
    );

    expect(response.status).toBe(409);
    expect(await errorBody(response)).toEqual({
      error: { code: "revision-conflict", actualRevision: 2 },
    });
  });

  it("maps not-found to 404", async () => {
    const repository = makeFakeRepository({ saveResult: { ok: false, reason: "not-found" } });

    const response = await handleSaveWorkspace(
      repository,
      new Request("http://localhost/x", {
        method: "PUT",
        body: JSON.stringify({ snapshot: snapshotJson({ id: "ghost" }), expectedRevision: 1 }),
      }),
      "ghost",
    );

    expect(response.status).toBe(404);
    expect(await errorBody(response)).toEqual({ error: { code: "workspace-not-found" } });
  });

  it("maps a snapshot id that differs from the route id to 400 workspace-id-mismatch", async () => {
    const repository = makeFakeRepository();

    const response = await handleSaveWorkspace(
      repository,
      new Request("http://localhost/x", {
        method: "PUT",
        body: JSON.stringify({ snapshot: snapshotJson(), expectedRevision: 1 }),
      }),
      "other-id",
    );

    expect(response.status).toBe(400);
    expect(await errorBody(response)).toEqual({ error: { code: "workspace-id-mismatch" } });
    expect(repository.savedWith).toEqual([]);
  });

  it.each([
    ["0", 0],
    ['-1', -1],
    ["1.5", 1.5],
    ['"1"', "1"],
    ["a missing field", undefined],
  ])("maps an expectedRevision of %s to 400 invalid-revision", async (_label, expectedRevision) => {
    const repository = makeFakeRepository();

    const response = await handleSaveWorkspace(
      repository,
      new Request("http://localhost/x", {
        method: "PUT",
        body: JSON.stringify({ snapshot: snapshotJson(), expectedRevision }),
      }),
      "workspace-1",
    );

    expect(response.status).toBe(400);
    expect(await errorBody(response)).toEqual({ error: { code: "invalid-revision" } });
    expect(repository.savedWith).toEqual([]);
  });

  it("maps invalid-workspace to 422 with the issues", async () => {
    const repository = makeFakeRepository({
      saveResult: {
        ok: false,
        reason: "invalid-workspace",
        issues: [{ type: "invalid-workspace-name" }],
      },
    });

    const response = await handleSaveWorkspace(
      repository,
      new Request("http://localhost/x", {
        method: "PUT",
        body: JSON.stringify({ snapshot: snapshotJson(), expectedRevision: 1 }),
      }),
      "workspace-1",
    );

    expect(response.status).toBe(422);
    expect(await errorBody(response)).toEqual({
      error: { code: "invalid-workspace", issues: [{ type: "invalid-workspace-name" }] },
    });
  });

  it("maps malformed JSON to 400 invalid-json", async () => {
    const repository = makeFakeRepository();

    const response = await handleSaveWorkspace(
      repository,
      new Request("http://localhost/x", { method: "PUT", body: "nope" }),
      "workspace-1",
    );

    expect(response.status).toBe(400);
    expect(await errorBody(response)).toEqual({ error: { code: "invalid-json" } });
  });
});

describe("handlers over the real SQLite repository", () => {
  it("rejects a structurally-valid snapshot with an invalid page grid as 422 and stores nothing", async () => {
    const database = openDatabase({ filename: ":memory:" });
    try {
      applyMigrations(database, realMigrationsDir);
      const repository = createWorkspaceRepository(database);
      const base = snapshotJson();
      const page = base.pages[0]!;
      const snapshot: WorkspaceSnapshot = {
        ...base,
        pages: [
          {
            ...page,
            layout: { ...page.layout, grid: { columns: 0, rows: 4 }, items: [] },
          },
        ],
      };

      const response = await handleCreateWorkspace(
        repository,
        post(JSON.stringify({ snapshot })),
      );

      expect(response.status).toBe(422);
      expect(await errorBody(response)).toEqual({
        error: {
          code: "invalid-workspace",
          issues: [
            {
              type: "page-layout-invalid",
              pageId: "page-1",
              issue: { type: "invalid-grid" },
            },
          ],
        },
      });
      expect(repository.listWorkspaces()).toEqual([]);
      expect(handleGetWorkspace(repository, "workspace-1").status).toBe(404);
    } finally {
      database.close();
    }
  });

  it("round-trips create, get and save through SQLite with a custom protocol app", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "veladesk-handlers-"));
    const database = openDatabase({ filename: ":memory:" });
    try {
      applyMigrations(database, realMigrationsDir);
      const repository = createWorkspaceRepository(database);
      const snapshot = snapshotJson();

      const created = await handleCreateWorkspace(
        repository,
        post(JSON.stringify({ snapshot })),
      );
      expect(created.status).toBe(201);
      expect(((await created.json()) as { workspace: StoredWorkspace }).workspace.revision).toBe(1);

      const fetched = handleGetWorkspace(repository, "workspace-1");
      expect(fetched.status).toBe(200);
      expect(((await fetched.json()) as { workspace: StoredWorkspace }).workspace.snapshot.name).toBe(
        "My Desk",
      );

      const renamed = await handleSaveWorkspace(
        repository,
        new Request("http://localhost/x", {
          method: "PUT",
          body: JSON.stringify({
            snapshot: snapshotJson({ name: "Renamed Desk" }),
            expectedRevision: 1,
          }),
        }),
        "workspace-1",
      );
      expect(renamed.status).toBe(200);
      expect(((await renamed.json()) as { workspace: StoredWorkspace }).workspace.revision).toBe(2);

      const stale = await handleSaveWorkspace(
        repository,
        new Request("http://localhost/x", {
          method: "PUT",
          body: JSON.stringify({
            snapshot: snapshotJson({ name: "Stale Desk" }),
            expectedRevision: 1,
          }),
        }),
        "workspace-1",
      );
      expect(stale.status).toBe(409);
      expect(await errorBody(stale)).toEqual({
        error: { code: "revision-conflict", actualRevision: 2 },
      });
    } finally {
      database.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("appearance preferences over HTTP", () => {
  const modernAppearance = {
    colorMode: "light",
    accentHue: 310,
    wallpaperPreset: "mist",
    surfaceOpacity: 0.7,
    blurPx: 8,
    radiusPx: 20,
    iconSize: "large",
  } as const;

  function legacySnapshotJson(): WorkspaceSnapshot {
    const snapshot = snapshotJson();
    const preferences = { ...snapshot.preferences };
    delete (preferences as { appearance?: unknown }).appearance;
    return { ...snapshot, preferences };
  }

  it("rejects a structurally-valid appearance with an out-of-range hue as 422 and stores nothing", async () => {
    const database = openDatabase({ filename: ":memory:" });
    try {
      applyMigrations(database, realMigrationsDir);
      const repository = createWorkspaceRepository(database);
      const base = snapshotJson();
      const snapshot: WorkspaceSnapshot = {
        ...base,
        preferences: {
          ...base.preferences,
          appearance: { ...modernAppearance, colorMode: "dark", accentHue: 999 },
        },
      };

      const response = await handleCreateWorkspace(
        repository,
        post(JSON.stringify({ snapshot })),
      );

      expect(response.status).toBe(422);
      expect(await errorBody(response)).toEqual({
        error: {
          code: "invalid-workspace",
          issues: [
            {
              type: "invalid-appearance-preference",
              issue: { type: "invalid-accent-hue" },
            },
          ],
        },
      });
      expect(repository.listWorkspaces()).toEqual([]);
      expect(handleGetWorkspace(repository, "workspace-1").status).toBe(404);
    } finally {
      database.close();
    }
  });

  it("keeps legacy snapshots without appearance fully functional over GET and PUT", async () => {
    const database = openDatabase({ filename: ":memory:" });
    try {
      applyMigrations(database, realMigrationsDir);
      const repository = createWorkspaceRepository(database);
      const snapshot = legacySnapshotJson();

      const created = await handleCreateWorkspace(
        repository,
        post(JSON.stringify({ snapshot })),
      );
      expect(created.status).toBe(201);

      const fetched = handleGetWorkspace(repository, "workspace-1");
      expect(fetched.status).toBe(200);
      const stored = ((await fetched.json()) as { workspace: StoredWorkspace }).workspace;
      expect(stored.snapshot.preferences).toEqual({
        defaultPageId: "page-1",
        layoutLocked: true,
      });

      const saved = await handleSaveWorkspace(
        repository,
        new Request("http://localhost/x", {
          method: "PUT",
          body: JSON.stringify({
            snapshot: legacySnapshotJson(),
            expectedRevision: 1,
          }),
        }),
        "workspace-1",
      );
      expect(saved.status).toBe(200);
      const savedBody = (await saved.json()) as { workspace: StoredWorkspace };
      expect(savedBody.workspace.revision).toBe(2);
      expect(savedBody.workspace.snapshot.preferences.appearance).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("persists a valid non-default appearance through POST and GET", async () => {
    const database = openDatabase({ filename: ":memory:" });
    try {
      applyMigrations(database, realMigrationsDir);
      const repository = createWorkspaceRepository(database);
      const base = snapshotJson();
      const snapshot: WorkspaceSnapshot = {
        ...base,
        preferences: { ...base.preferences, appearance: modernAppearance },
      };

      const created = await handleCreateWorkspace(
        repository,
        post(JSON.stringify({ snapshot })),
      );
      expect(created.status).toBe(201);

      const fetched = handleGetWorkspace(repository, "workspace-1");
      expect(fetched.status).toBe(200);
      const stored = ((await fetched.json()) as { workspace: StoredWorkspace }).workspace;
      expect(stored.snapshot.preferences.appearance).toEqual(modernAppearance);
    } finally {
      database.close();
    }
  });
});
