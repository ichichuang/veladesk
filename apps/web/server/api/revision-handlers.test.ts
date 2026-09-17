import { createEmptyWorkspace } from "@veladesk/domain";
import type {
  StoredWorkspace,
  WorkspaceRepository,
  WorkspaceRevision,
  WorkspaceRevisionSummary,
} from "@veladesk/database";
import { describe, expect, it } from "vitest";

import {
  handleGetWorkspaceRevision,
  handleListWorkspaceRevisions,
} from "./revision-handlers";

function makeFakeRepository(overrides: {
  loaded?: StoredWorkspace | undefined;
  revisions?: readonly WorkspaceRevisionSummary[];
  revision?: WorkspaceRevision | undefined;
} = {}): WorkspaceRepository {
  return {
    createWorkspace() {
      throw new Error("not expected");
    },
    loadWorkspace() {
      return overrides.loaded;
    },
    saveWorkspace() {
      throw new Error("not expected");
    },
    listWorkspaces() {
      return [];
    },
    loadWorkspaceRevision() {
      return overrides.revision;
    },
    listWorkspaceRevisions() {
      return overrides.revisions ?? [];
    },
  };
}

function storedWorkspace(): StoredWorkspace {
  return {
    snapshot: createEmptyWorkspace({
      workspaceId: "workspace-1",
      workspaceName: "My Desk",
      pageId: "page-1",
      pageName: "Home",
      grid: { columns: 12, rows: 8 },
    }),
    revision: 2,
    createdAt: 1,
    updatedAt: 5,
  };
}

describe("handleListWorkspaceRevisions", () => {
  it("returns 200 with the revision summaries for an existing workspace", async () => {
    const summaries: WorkspaceRevisionSummary[] = [
      { workspaceId: "workspace-1", revision: 1, createdAt: 1 },
      { workspaceId: "workspace-1", revision: 2, createdAt: 5 },
    ];
    const repository = makeFakeRepository({ loaded: storedWorkspace(), revisions: summaries });

    const response = handleListWorkspaceRevisions(repository, "workspace-1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revisions: summaries });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("maps a missing workspace to 404 instead of an empty list", async () => {
    const repository = makeFakeRepository({ loaded: undefined });

    const response = handleListWorkspaceRevisions(repository, "ghost");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "workspace-not-found" } });
  });
});

describe("handleGetWorkspaceRevision", () => {
  it("returns 200 with the revision", async () => {
    const revision: WorkspaceRevision = {
      snapshot: storedWorkspace().snapshot,
      revision: 1,
      createdAt: 1,
    };
    const repository = makeFakeRepository({ loaded: storedWorkspace(), revision });

    const response = handleGetWorkspaceRevision(repository, "workspace-1", "1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each(["0", "-1", "01", "abc", "1.5", ""])(
    "maps the invalid revision segment %s to 400 invalid-revision",
    async (segment) => {
      const repository = makeFakeRepository({ loaded: storedWorkspace() });

      const response = handleGetWorkspaceRevision(repository, "workspace-1", segment);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "invalid-revision" } });
    },
  );

  it("maps a missing workspace to 404 workspace-not-found", async () => {
    const repository = makeFakeRepository({ loaded: undefined });

    const response = handleGetWorkspaceRevision(repository, "ghost", "1");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "workspace-not-found" } });
  });

  it("maps a missing revision of an existing workspace to 404 revision-not-found", async () => {
    const repository = makeFakeRepository({
      loaded: storedWorkspace(),
      revision: undefined,
    });

    const response = handleGetWorkspaceRevision(repository, "workspace-1", "9");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "revision-not-found" } });
  });
});
