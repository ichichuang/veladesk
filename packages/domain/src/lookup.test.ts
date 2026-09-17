import { describe, expect, it } from "vitest";

import { findCategory, findDesktopPage, findWorkspaceEntity } from "./lookup";
import { createEmptyWorkspace } from "./workspace";
import type { WorkspaceSnapshot } from "./types";

function buildWorkspace(): WorkspaceSnapshot {
  const workspace = createEmptyWorkspace({
    workspaceId: "workspace-1",
    workspaceName: "My Desk",
    pageId: "page-1",
    pageName: "Home",
    grid: { columns: 12, rows: 8 },
  });

  return {
    ...workspace,
    pages: [
      ...workspace.pages,
      { id: "page-2", name: "Work", layout: { ...workspace.pages[0]!.layout, id: "page-2" } },
    ],
    entities: [
      {
        kind: "app",
        id: "app-1",
        name: "Wiki",
        url: "https://wiki.example.com",
        icon: { kind: "favicon" },
        openMode: "new-tab",
        tags: [],
      },
      { kind: "folder", id: "folder-1", name: "Games", children: ["app-1"] },
      {
        kind: "widget",
        id: "widget-1",
        widgetType: "builtin.clock",
        config: { timezone: "UTC" },
      },
    ],
    categories: [{ id: "category-1", name: "Reading" }],
  };
}

describe("findWorkspaceEntity", () => {
  it("finds an app entity by id", () => {
    const workspace = buildWorkspace();

    expect(findWorkspaceEntity(workspace, "app-1")?.kind).toBe("app");
  });

  it("finds folder and widget entities by id", () => {
    const workspace = buildWorkspace();

    expect(findWorkspaceEntity(workspace, "folder-1")?.kind).toBe("folder");
    expect(findWorkspaceEntity(workspace, "widget-1")?.kind).toBe("widget");
  });

  it("returns undefined for a missing entity id", () => {
    const workspace = buildWorkspace();

    expect(findWorkspaceEntity(workspace, "missing")).toBeUndefined();
  });
});

describe("findDesktopPage", () => {
  it("finds a page by id", () => {
    const workspace = buildWorkspace();

    expect(findDesktopPage(workspace, "page-2")?.name).toBe("Work");
  });

  it("returns undefined for a missing page id", () => {
    const workspace = buildWorkspace();

    expect(findDesktopPage(workspace, "missing")).toBeUndefined();
  });
});

describe("findCategory", () => {
  it("finds a category by id", () => {
    const workspace = buildWorkspace();

    expect(findCategory(workspace, "category-1")?.name).toBe("Reading");
  });

  it("returns undefined for a missing category id", () => {
    const workspace = buildWorkspace();

    expect(findCategory(workspace, "missing")).toBeUndefined();
  });
});

describe("lookup purity", () => {
  it("does not mutate the workspace", () => {
    const workspace = buildWorkspace();
    const before = structuredClone(workspace);

    findWorkspaceEntity(workspace, "app-1");
    findDesktopPage(workspace, "page-1");
    findCategory(workspace, "category-1");

    expect(workspace).toEqual(before);
  });
});
