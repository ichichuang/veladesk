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
import { describe, expect, it } from "vitest";

import {
  handleCreateWorkspace,
  handleDeleteWorkspace,
  handleGetWorkspace,
  handleListWorkspaces,
  handleRenameWorkspace,
  handleSaveWorkspace,
} from "./workspace-handlers";
import type { WriteGuard } from "./write-guard";

const realMigrationsDir = fileURLToPath(
  new URL("../../../../packages/database/drizzle", import.meta.url),
);

const fullGuard: WriteGuard = { storageFull: true };
const openGuard: WriteGuard = { storageFull: false };

function snapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "workspace-1",
    workspaceName: "My Desk",
    pageId: "page-1",
    pageName: "Home",
    grid: { columns: 12, rows: 8 },
  });
  return { ...base, ...overrides };
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
    renameWorkspace() { throw new Error("unexpected renameWorkspace"); },
    deleteWorkspace() { throw new Error("unexpected deleteWorkspace"); },
    createWorkspace(created) {
      this.createdWith.push(created);
      return overrides.createResult ?? { ok: false, reason: "already-exists" };
    },
    loadWorkspace() {
      return overrides.loaded;
    },
    saveWorkspace(saved, expectedRevision) {
      this.savedWith.push({ snapshot: saved, expectedRevision });
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

function put(body: string): Request {
  return new Request("http://localhost/api/v1/workspaces/workspace-1", {
    method: "PUT",
    body,
  });
}

function patch(body: string): Request {
  return new Request("http://localhost/api/v1/workspaces/workspace-1", {
    method: "PATCH",
    body,
  });
}

async function errorBody(response: Response): Promise<{ error: Record<string, unknown> }> {
  return (await response.json()) as { error: Record<string, unknown> };
}

describe("storage-full guard", () => {
  it("answers 507 storage-full on POST before reading the body or the repository", async () => {
    const repository = makeFakeRepository();

    const response = await handleCreateWorkspace(repository, post("{oops"), fullGuard);

    expect(response.status).toBe(507);
    expect(await errorBody(response)).toEqual({ error: { code: "storage-full" } });
    expect(repository.createdWith).toEqual([]);
  });

  it("answers 507 storage-full on PUT and PATCH", async () => {
    const repository = makeFakeRepository();

    const saved = await handleSaveWorkspace(
      repository,
      put(JSON.stringify({ snapshot: snapshot(), expectedRevision: 1 })),
      "workspace-1",
      fullGuard,
    );
    const renamed = await handleRenameWorkspace(
      repository,
      patch(JSON.stringify({ name: "Next", expectedRevision: 1 })),
      "workspace-1",
      fullGuard,
    );

    expect(saved.status).toBe(507);
    expect(await errorBody(saved)).toEqual({ error: { code: "storage-full" } });
    expect(renamed.status).toBe(507);
    expect(await errorBody(renamed)).toEqual({ error: { code: "storage-full" } });
    expect(repository.savedWith).toEqual([]);
  });

  it("leaves reads untouched while storage is full", async () => {
    const loaded: StoredWorkspace = {
      snapshot: snapshot(),
      revision: 3,
      createdAt: 1,
      updatedAt: 2,
    };
    const repository = makeFakeRepository({ loaded });

    const got = handleGetWorkspace(repository, "workspace-1");
    const listed = handleListWorkspaces(repository);

    expect(got.status).toBe(200);
    expect(await got.json()).toEqual({ workspace: loaded });
    expect(listed.status).toBe(200);
  });

  it("lets writes through when the guard reports free storage", async () => {
    const repository = makeFakeRepository({
      createResult: {
        ok: true,
        workspace: { snapshot: snapshot(), revision: 1, createdAt: 1, updatedAt: 1 },
      },
    });

    const response = await handleCreateWorkspace(
      repository,
      post(JSON.stringify({ snapshot: snapshot() })),
      openGuard,
    );

    expect(response.status).toBe(201);
    expect(repository.createdWith).toHaveLength(1);
  });
});

describe("snapshot limit admission (POST/PUT only)", () => {
  function realRepository(): WorkspaceRepository {
    const database = openDatabase({ filename: ":memory:" });
    applyMigrations(database, realMigrationsDir);
    return createWorkspaceRepository(database);
  }

  it("rejects an over-count POST with 413 and the limit name, storing nothing", async () => {
    const repository = realRepository();
    const tooManyPages = snapshot({
      pages: Array.from({ length: 51 }, (_, index) => {
        const base = snapshot().pages[0]!;
        return {
          ...base,
          id: `page-${index}`,
          name: `Page ${index}`,
          layout: { ...base.layout, id: `page-${index}`, items: [] },
        };
      }),
      preferences: { ...snapshot().preferences, defaultPageId: "page-0" },
    });

    const response = await handleCreateWorkspace(repository, post(JSON.stringify({ snapshot: tooManyPages })));

    expect(response.status).toBe(413);
    expect(await errorBody(response)).toEqual({
      error: { code: "snapshot-limit-exceeded", limit: "max-snapshot-pages" },
    });
    expect(repository.listWorkspaces()).toEqual([]);
  });

  it("rejects an over-long url PUT with 400 and the limit name", async () => {
    const repository = makeFakeRepository();
    const withLongUrl = snapshot({
      entities: [
        {
          kind: "app",
          id: "app-1",
          name: "App",
          url: `https://x.example/${"a".repeat(4097)}`,
          icon: { kind: "favicon" },
          openMode: "new-tab",
          tags: [],
        },
      ],
    });

    const response = await handleSaveWorkspace(
      repository,
      put(JSON.stringify({ snapshot: withLongUrl, expectedRevision: 1 })),
      "workspace-1",
    );

    expect(response.status).toBe(400);
    expect(await errorBody(response)).toEqual({
      error: { code: "snapshot-limit-exceeded", limit: "max-snapshot-url-length" },
    });
    expect(repository.savedWith).toEqual([]);
  });

  it("lets a 4096-char url through to the repository", async () => {
    const repository = makeFakeRepository({
      saveResult: { ok: false, reason: "not-found" },
    });
    const atLimit = snapshot({
      entities: [
        {
          kind: "app",
          id: "app-1",
          name: "App",
          url: `https://x.example/${"a".repeat(4096 - "https://x.example/".length)}`,
          icon: { kind: "favicon" },
          openMode: "new-tab",
          tags: [],
        },
      ],
    });

    const response = await handleSaveWorkspace(
      repository,
      put(JSON.stringify({ snapshot: atLimit, expectedRevision: 1 })),
      "workspace-1",
    );

    // The limit itself passed; the fake repository's not-found decides.
    expect(response.status).toBe(404);
    expect(repository.savedWith).toHaveLength(1);
  });

  it("PATCH rename never applies snapshot limits to the stored snapshot", async () => {
    // A legacy workspace with more pages than today's limit must stay
    // renamable — existing data keeps loading and editing.
    const database = openDatabase({ filename: ":memory:" });
    applyMigrations(database, realMigrationsDir);
    const repository = createWorkspaceRepository(database);
    try {
      const legacy = snapshot({
        pages: Array.from({ length: 60 }, (_, index) => {
          const base = snapshot().pages[0]!;
          return {
            ...base,
            id: `page-${index}`,
            name: `Page ${index}`,
            layout: { ...base.layout, id: `page-${index}`, items: [] },
          };
        }),
        preferences: { ...snapshot().preferences, defaultPageId: "page-0" },
      });
      expect(repository.createWorkspace(legacy).ok).toBe(true);

      const response = await handleRenameWorkspace(
        repository,
        patch(JSON.stringify({ name: "Renamed Desk", expectedRevision: 1 })),
        "workspace-1",
      );

      expect(response.status).toBe(200);
      expect(((await response.json()) as { workspace: StoredWorkspace }).workspace.snapshot.name).toBe(
        "Renamed Desk",
      );
    } finally {
      database.close();
    }
  });

  it("rejects an over-budget POST body with 413 payload-too-large", async () => {
    const repository = makeFakeRepository();
    const big = `{"pad":"${"x".repeat(600 * 1024)}"}`;

    const response = await handleCreateWorkspace(repository, post(big));

    expect(response.status).toBe(413);
    expect(await errorBody(response)).toEqual({ error: { code: "payload-too-large" } });
    expect(repository.createdWith).toEqual([]);
  });
});

describe("JSON body decoding compatibility", () => {
  /** `{"expectedRevision":1,"ignored":"<one 0xFF byte>"}` as raw bytes. */
  function bodyWithInvalidUtf8(): Uint8Array {
    const prefix = new TextEncoder().encode('{"expectedRevision":1,"ignored":"');
    const suffix = new TextEncoder().encode('"}');
    const raw = new Uint8Array(prefix.length + 1 + suffix.length);
    raw.set(prefix, 0);
    raw[prefix.length] = 0xff;
    raw.set(suffix, prefix.length + 1);
    return raw;
  }

  it("parses invalid UTF-8 like request.json() did: DELETE of a fake id answers 404, not 500", async () => {
    const database = openDatabase({ filename: ":memory:" });
    applyMigrations(database, realMigrationsDir);
    const repository = createWorkspaceRepository(database);
    try {
      const request = new Request("http://localhost/api/v1/workspaces/missing", {
        method: "DELETE",
        body: bodyWithInvalidUtf8() as unknown as BodyInit,
        duplex: "half",
      } as RequestInit);

      const response = await handleDeleteWorkspace(repository, request, "missing");

      expect(response.status).toBe(404);
      expect(await errorBody(response)).toEqual({ error: { code: "workspace-not-found" } });
    } finally {
      database.close();
    }
  });
});
