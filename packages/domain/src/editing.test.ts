import { describe, expect, it } from "vitest";

import { createEmptyWorkspace, validateWorkspace } from "@veladesk/domain";
import type { AppShortcut, Folder, WidgetInstance, WorkspaceSnapshot } from "@veladesk/domain";

import {
  addAppToFolder,
  addAppToPage,
  addFolderToPage,
  deleteApp,
  dissolveFolderToPage,
  moveAppToFolder,
  moveAppToPage,
  pinEntityToDock,
  renameFolder,
  replaceApp,
  unpinEntityFromDock,
} from "./editing";

function baseWorkspace(): WorkspaceSnapshot {
  return createEmptyWorkspace({
    workspaceId: "workspace-1",
    workspaceName: "Desk",
    pageId: "page-1",
    pageName: "Home",
    grid: { columns: 3, rows: 3 },
  });
}

function app(id: string, name = id): AppShortcut {
  return {
    kind: "app",
    id,
    name,
    url: "https://example.com/",
    icon: { kind: "generated", text: name.slice(0, 2).toUpperCase() },
    openMode: "new-tab",
    tags: [],
  };
}

function folder(id: string, name: string, children: readonly string[] = []): Folder {
  return { kind: "folder", id, name, children };
}

function widget(id: string): WidgetInstance {
  return { kind: "widget", id, widgetType: "builtin.clock", config: {} };
}

function itemsOf(workspace: WorkspaceSnapshot, pageId = "page-1") {
  const page = workspace.pages.find((candidate) => candidate.id === pageId);
  if (page === undefined) {
    throw new Error(`page ${pageId} missing`);
  }
  return page.layout.items;
}

function expectValid(workspace: WorkspaceSnapshot): void {
  expect(validateWorkspace(workspace)).toEqual([]);
}

function expectUnchanged(input: WorkspaceSnapshot, run: () => unknown): void {
  const before = JSON.parse(JSON.stringify(input));
  run();
  expect(JSON.parse(JSON.stringify(input))).toEqual(before);
}

describe("addAppToPage", () => {
  it("keeps the task 010 contract: entity plus 1x1 item at the desired cell", () => {
    const result = addAppToPage(baseWorkspace(), "page-1", app("app-a"), { column: 2, row: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.entities.map((entity) => entity.id)).toEqual(["app-a"]);
    expect(itemsOf(result.workspace)).toEqual([
      { id: "app-a", position: { column: 2, row: 1 }, span: { columns: 1, rows: 1 } },
    ]);
    expectValid(result.workspace);
  });

  it("rejects duplicate entity ids", () => {
    const workspace = baseWorkspace();
    const first = addAppToPage(workspace, "page-1", app("app-a"));
    if (!first.ok) throw new Error("fixture failed");

    expect(addAppToPage(first.workspace, "page-1", app("app-a"))).toEqual({
      ok: false,
      reason: "duplicate-entity-id",
    });
  });

  it("fails with page-not-found and no-space", () => {
    expect(addAppToPage(baseWorkspace(), "page-x", app("app-a"))).toEqual({
      ok: false,
      reason: "page-not-found",
    });

    let workspace = baseWorkspace();
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        const filled = addAppToPage(workspace, "page-1", app(`app-${row}${column}`), { column, row });
        if (!filled.ok) throw new Error("fixture failed");
        workspace = filled.workspace;
      }
    }
    expect(addAppToPage(workspace, "page-1", app("app-extra"))).toEqual({
      ok: false,
      reason: "no-space",
    });
  });
});

describe("addAppToFolder", () => {
  function workspaceWithFolder(): WorkspaceSnapshot {
    const created = addFolderToPage(baseWorkspace(), "page-1", folder("folder-1", "Docs"));
    if (!created.ok) throw new Error("fixture failed");
    return created.workspace;
  }

  it("appends the app entity and the folder child without any layout item", () => {
    const result = addAppToFolder(workspaceWithFolder(), "folder-1", app("app-a"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.entities.map((entity) => entity.id)).toEqual(["folder-1", "app-a"]);
    expect(itemsOf(result.workspace)).toHaveLength(1);
    expect(itemsOf(result.workspace)[0]?.id).toBe("folder-1");
    const stored = result.workspace.entities.find((entity) => entity.id === "folder-1");
    expect(stored?.kind === "folder" && stored.children).toEqual(["app-a"]);
    expectValid(result.workspace);
  });

  it("rejects a missing folder and a non-folder target", () => {
    expect(addAppToFolder(baseWorkspace(), "folder-x", app("app-a"))).toEqual({
      ok: false,
      reason: "folder-not-found",
    });
    const withApp = addAppToPage(baseWorkspace(), "page-1", app("app-a"));
    if (!withApp.ok) throw new Error("fixture failed");
    expect(addAppToFolder(withApp.workspace, "app-a", app("app-b"))).toEqual({
      ok: false,
      reason: "folder-not-found",
    });
  });

  it("rejects duplicate app ids", () => {
    const workspace = workspaceWithFolder();
    const first = addAppToFolder(workspace, "folder-1", app("app-a"));
    if (!first.ok) throw new Error("fixture failed");

    expect(addAppToFolder(first.workspace, "folder-1", app("app-a"))).toEqual({
      ok: false,
      reason: "duplicate-entity-id",
    });
  });

  it("rejects blank names and blank urls", () => {
    const workspace = workspaceWithFolder();
    expect(addAppToFolder(workspace, "folder-1", app("app-a", "   "))).toEqual({
      ok: false,
      reason: "invalid-name",
    });
    expect(
      addAppToFolder(workspace, "folder-1", {
        ...app("app-a"),
        url: "   ",
      })
    ).toEqual({ ok: false, reason: "invalid-url" });
  });

  it("does not auto-pin the dock and leaves other ordering untouched", () => {
    const workspace = workspaceWithFolder();
    const seeded = addAppToPage(workspace, "page-1", app("app-page"));
    if (!seeded.ok) throw new Error("fixture failed");

    const result = addAppToFolder(seeded.workspace, "folder-1", app("app-in"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.dock.items).toEqual([]);
    expect(result.workspace.entities.map((entity) => entity.id)).toEqual([
      "folder-1",
      "app-page",
      "app-in",
    ]);
  });
});

describe("addFolderToPage", () => {
  it("appends an empty folder entity plus a 1x1 layout item", () => {
    const result = addFolderToPage(baseWorkspace(), "page-1", folder("folder-1", "Docs"), {
      column: 1,
      row: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = result.workspace.entities[0];
    expect(stored?.kind).toBe("folder");
    expect(stored?.kind === "folder" && stored.children).toEqual([]);
    expect(itemsOf(result.workspace)).toEqual([
      { id: "folder-1", position: { column: 1, row: 2 }, span: { columns: 1, rows: 1 } },
    ]);
    expectValid(result.workspace);
  });

  it("rejects blank names", () => {
    expect(addFolderToPage(baseWorkspace(), "page-1", folder("folder-1", "  "))).toEqual({
      ok: false,
      reason: "invalid-name",
    });
  });

  it("rejects creating a non-empty folder", () => {
    expect(
      addFolderToPage(baseWorkspace(), "page-1", folder("folder-1", "Docs", ["app-a"]))
    ).toEqual({ ok: false, reason: "folder-must-be-empty" });
  });

  it("rejects duplicate ids, unknown pages and full grids", () => {
    const workspace = baseWorkspace();
    const seeded = addFolderToPage(workspace, "page-1", folder("folder-1", "Docs"));
    if (!seeded.ok) throw new Error("fixture failed");
    expect(addFolderToPage(seeded.workspace, "page-1", folder("folder-1", "Again"))).toEqual({
      ok: false,
      reason: "duplicate-entity-id",
    });
    expect(addFolderToPage(baseWorkspace(), "page-x", folder("folder-2", "Docs"))).toEqual({
      ok: false,
      reason: "page-not-found",
    });

    let full = baseWorkspace();
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        const filled = addAppToPage(full, "page-1", app(`app-${row}${column}`), { column, row });
        if (!filled.ok) throw new Error("fixture failed");
        full = filled.workspace;
      }
    }
    expect(addFolderToPage(full, "page-1", folder("folder-2", "Docs"))).toEqual({
      ok: false,
      reason: "no-space",
    });
  });
});

describe("replaceApp", () => {
  function workspaceWithApp(): WorkspaceSnapshot {
    const placed = addAppToPage(baseWorkspace(), "page-1", app("app-a", "Old"), { column: 1, row: 0 });
    if (!placed.ok) throw new Error("fixture failed");
    const pinned = pinEntityToDock(placed.workspace, "app-a");
    if (!pinned.ok) throw new Error("fixture failed");
    const withFolder = addFolderToPage(pinned.workspace, "page-1", folder("folder-1", "Docs"));
    if (!withFolder.ok) throw new Error("fixture failed");
    const moved = moveAppToFolder(withFolder.workspace, "app-a", "folder-1");
    if (!moved.ok) throw new Error("fixture failed");
    return moved.workspace;
  }

  it("replaces name/url/openMode in place and keeps container, dock and ordering", () => {
    const workspace = workspaceWithApp();
    const result = replaceApp(workspace, {
      ...app("app-a", "New Name"),
      url: "obsidian://open?vault=New",
      openMode: "popup",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.entities.map((entity) => entity.id)).toEqual(["app-a", "folder-1"]);
    const stored = result.workspace.entities[0];
    expect(stored?.kind === "app" && stored.name).toBe("New Name");
    expect(stored?.kind === "app" && stored.url).toBe("obsidian://open?vault=New");
    expect(stored?.kind === "app" && stored.openMode).toBe("popup");
    expect(itemsOf(result.workspace).map((item) => item.id)).toEqual(["folder-1"]);
    const folderEntity = result.workspace.entities[1];
    expect(folderEntity?.kind === "folder" && folderEntity.children).toEqual(["app-a"]);
    expect(result.workspace.dock.items).toEqual(["app-a"]);
    expectValid(result.workspace);
  });

  it("rejects missing and non-app targets plus blank scalars", () => {
    expect(replaceApp(baseWorkspace(), app("app-x"))).toEqual({
      ok: false,
      reason: "app-not-found",
    });
    const withFolder = addFolderToPage(baseWorkspace(), "page-1", folder("folder-1", "Docs"));
    if (!withFolder.ok) throw new Error("fixture failed");
    expect(
      replaceApp(withFolder.workspace, { ...app("folder-1"), kind: "app" })
    ).toEqual({ ok: false, reason: "app-not-found" });

    const placed = addAppToPage(baseWorkspace(), "page-1", app("app-a"));
    if (!placed.ok) throw new Error("fixture failed");
    expect(replaceApp(placed.workspace, app("app-a", "  "))).toEqual({
      ok: false,
      reason: "invalid-name",
    });
    expect(replaceApp(placed.workspace, { ...app("app-a"), url: " " })).toEqual({
      ok: false,
      reason: "invalid-url",
    });
  });
});

describe("renameFolder", () => {
  it("stores the next name verbatim and keeps everything else", () => {
    const created = addFolderToPage(baseWorkspace(), "page-1", folder("folder-1", "Docs"));
    if (!created.ok) throw new Error("fixture failed");

    const result = renameFolder(created.workspace, "folder-1", "  Deep Docs  ");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = result.workspace.entities[0];
    expect(stored?.kind === "folder" && stored.name).toBe("  Deep Docs  ");
    expect(itemsOf(result.workspace)).toHaveLength(1);
    expectValid(result.workspace);
  });

  it("rejects missing folders and blank names", () => {
    expect(renameFolder(baseWorkspace(), "folder-x", "Name")).toEqual({
      ok: false,
      reason: "folder-not-found",
    });
    const created = addFolderToPage(baseWorkspace(), "page-1", folder("folder-1", "Docs"));
    if (!created.ok) throw new Error("fixture failed");
    expect(renameFolder(created.workspace, "folder-1", "   ")).toEqual({
      ok: false,
      reason: "invalid-name",
    });
  });
});

describe("moveAppToFolder", () => {
  it("moves a page app into a folder and keeps its entities index and dock pin", () => {
    const placed = addAppToPage(baseWorkspace(), "page-1", app("app-a"));
    if (!placed.ok) throw new Error("fixture failed");
    const pinned = pinEntityToDock(placed.workspace, "app-a");
    if (!pinned.ok) throw new Error("fixture failed");
    const folderCreated = addFolderToPage(pinned.workspace, "page-1", folder("folder-1", "Docs"), {
      column: 2,
      row: 2,
    });
    if (!folderCreated.ok) throw new Error("fixture failed");

    const result = moveAppToFolder(folderCreated.workspace, "app-a", "folder-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(itemsOf(result.workspace).map((item) => item.id)).toEqual(["folder-1"]);
    const folderEntity = result.workspace.entities.find((entity) => entity.id === "folder-1");
    expect(folderEntity?.kind === "folder" && folderEntity.children).toEqual(["app-a"]);
    expect(result.workspace.entities.map((entity) => entity.id)).toEqual(["app-a", "folder-1"]);
    expect(result.workspace.dock.items).toEqual(["app-a"]);
    expectValid(result.workspace);
  });

  it("moves an app from folder A to folder B and accepts unplaced apps", () => {
    const folderA = addFolderToPage(baseWorkspace(), "page-1", folder("folder-a", "A"));
    if (!folderA.ok) throw new Error("fixture failed");
    const folderB = addFolderToPage(folderA.workspace, "page-1", folder("folder-b", "B"), {
      column: 1,
      row: 0,
    });
    if (!folderB.ok) throw new Error("fixture failed");
    const child = addAppToFolder(folderB.workspace, "folder-a", app("app-a"));
    if (!child.ok) throw new Error("fixture failed");

    const moved = moveAppToFolder(child.workspace, "app-a", "folder-b");
    expect(moved.ok).toBe(true);
    if (!moved.ok) throw new Error("unexpected failure");
    const folders = moved.workspace.entities.filter((entity) => entity.kind === "folder");
    expect(folders.map((entity) => entity.kind === "folder" && entity.children)).toEqual([
      [],
      ["app-a"],
    ]);
    expectValid(moved.workspace);

    const unplaced: WorkspaceSnapshot = { ...baseWorkspace(), entities: [app("app-u")] };
    const folderOnly = addFolderToPage(unplaced, "page-1", folder("folder-1", "Docs"), {
      column: 1,
      row: 1,
    });
    if (!folderOnly.ok) throw new Error("fixture failed");
    expect(moveAppToFolder(folderOnly.workspace, "app-u", "folder-1").ok).toBe(true);
  });

  it("rejects moving into the same folder and reports missing ids", () => {
    const folderCreated = addFolderToPage(baseWorkspace(), "page-1", folder("folder-1", "Docs"));
    if (!folderCreated.ok) throw new Error("fixture failed");
    const child = addAppToFolder(folderCreated.workspace, "folder-1", app("app-a"));
    if (!child.ok) throw new Error("fixture failed");

    expect(moveAppToFolder(child.workspace, "app-a", "folder-1")).toEqual({
      ok: false,
      reason: "already-in-folder",
    });
    expect(moveAppToFolder(child.workspace, "app-x", "folder-1")).toEqual({
      ok: false,
      reason: "app-not-found",
    });
    expect(moveAppToFolder(child.workspace, "app-a", "folder-x")).toEqual({
      ok: false,
      reason: "folder-not-found",
    });
  });
});

describe("moveAppToPage", () => {
  it("moves a folder child back to the page and clears the folder reference", () => {
    const folderCreated = addFolderToPage(baseWorkspace(), "page-1", folder("folder-1", "Docs"));
    if (!folderCreated.ok) throw new Error("fixture failed");
    const child = addAppToFolder(folderCreated.workspace, "folder-1", app("app-a"));
    if (!child.ok) throw new Error("fixture failed");

    const result = moveAppToPage(child.workspace, "app-a", "page-1", { column: 2, row: 2 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const folderEntity = result.workspace.entities.find((entity) => entity.id === "folder-1");
    expect(folderEntity?.kind === "folder" && folderEntity.children).toEqual([]);
    expect(itemsOf(result.workspace)).toEqual([
      { id: "folder-1", position: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } },
      { id: "app-a", position: { column: 2, row: 2 }, span: { columns: 1, rows: 1 } },
    ]);
    expectValid(result.workspace);
  });

  it("fails atomically with no-space and rejects apps already on any page", () => {
    const folderCreated = addFolderToPage(baseWorkspace(), "page-1", folder("folder-1", "Docs"));
    if (!folderCreated.ok) throw new Error("fixture failed");
    const child = addAppToFolder(folderCreated.workspace, "folder-1", app("app-a"));
    if (!child.ok) throw new Error("fixture failed");

    let almostFull = child.workspace;
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        if (row === 0 && column === 0) continue; // folder occupies this cell
        const filled = addAppToPage(almostFull, "page-1", app(`app-${row}${column}`), {
          column,
          row,
        });
        if (!filled.ok) throw new Error("fixture failed");
        almostFull = filled.workspace;
      }
    }
    expectUnchanged(almostFull, () => {
      expect(moveAppToPage(almostFull, "app-a", "page-1")).toEqual({
        ok: false,
        reason: "no-space",
      });
    });

    const placed = addAppToPage(baseWorkspace(), "page-1", app("app-a"));
    if (!placed.ok) throw new Error("fixture failed");
    expect(moveAppToPage(placed.workspace, "app-a", "page-1")).toEqual({
      ok: false,
      reason: "already-on-page",
    });
    expect(moveAppToPage(baseWorkspace(), "app-x", "page-1")).toEqual({
      ok: false,
      reason: "app-not-found",
    });
    expect(moveAppToPage(baseWorkspace(), "app-x", "page-x")).toEqual({
      ok: false,
      reason: "app-not-found",
    });
  });
});

describe("deleteApp", () => {
  it("removes a page app and every reference", () => {
    const placed = addAppToPage(baseWorkspace(), "page-1", app("app-a"));
    if (!placed.ok) throw new Error("fixture failed");
    const pinned = pinEntityToDock(placed.workspace, "app-a");
    if (!pinned.ok) throw new Error("fixture failed");

    const result = deleteApp(pinned.workspace, "app-a");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.entities).toEqual([]);
    expect(itemsOf(result.workspace)).toEqual([]);
    expect(result.workspace.dock.items).toEqual([]);
    expectValid(result.workspace);
  });

  it("removes a folder child and keeps the folder", () => {
    const folderCreated = addFolderToPage(baseWorkspace(), "page-1", folder("folder-1", "Docs"));
    if (!folderCreated.ok) throw new Error("fixture failed");
    const child = addAppToFolder(folderCreated.workspace, "folder-1", app("app-a"));
    if (!child.ok) throw new Error("fixture failed");

    const result = deleteApp(child.workspace, "app-a");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const folderEntity = result.workspace.entities[0];
    expect(folderEntity?.kind === "folder" && folderEntity.children).toEqual([]);
    expect(result.workspace.entities).toHaveLength(1);
    expectValid(result.workspace);
  });

  it("rejects missing and non-app ids", () => {
    expect(deleteApp(baseWorkspace(), "app-x")).toEqual({ ok: false, reason: "app-not-found" });
    const folderCreated = addFolderToPage(baseWorkspace(), "page-1", folder("folder-1", "Docs"));
    if (!folderCreated.ok) throw new Error("fixture failed");
    expect(deleteApp(folderCreated.workspace, "folder-1")).toEqual({
      ok: false,
      reason: "app-not-found",
    });
  });
});

describe("dock pinning", () => {
  it("pins a page app without touching its container", () => {
    const placed = addAppToPage(baseWorkspace(), "page-1", app("app-a"));
    if (!placed.ok) throw new Error("fixture failed");

    const result = pinEntityToDock(placed.workspace, "app-a");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.dock.items).toEqual(["app-a"]);
    expect(itemsOf(result.workspace)).toHaveLength(1);
    expectValid(result.workspace);
  });

  it("pins a folder child and a page folder", () => {
    const folderCreated = addFolderToPage(baseWorkspace(), "page-1", folder("folder-1", "Docs"));
    if (!folderCreated.ok) throw new Error("fixture failed");
    const child = addAppToFolder(folderCreated.workspace, "folder-1", app("app-a"));
    if (!child.ok) throw new Error("fixture failed");

    const pinnedChild = pinEntityToDock(child.workspace, "app-a");
    expect(pinnedChild.ok).toBe(true);
    if (pinnedChild.ok) {
      expect(pinnedChild.workspace.dock.items).toEqual(["app-a"]);
      expectValid(pinnedChild.workspace);
    }

    const pinnedFolder = pinEntityToDock(folderCreated.workspace, "folder-1");
    expect(pinnedFolder.ok).toBe(true);
    if (pinnedFolder.ok) {
      expect(pinnedFolder.workspace.dock.items).toEqual(["folder-1"]);
      expectValid(pinnedFolder.workspace);
    }
  });

  it("rejects widgets, duplicates and unknown ids; unpins without deleting", () => {
    const withWidget: WorkspaceSnapshot = {
      ...baseWorkspace(),
      entities: [widget("widget-1")],
      pages: [
        {
          id: "page-1",
          name: "Home",
          layout: {
            id: "page-1",
            grid: { columns: 3, rows: 3 },
            items: [
              { id: "widget-1", position: { column: 0, row: 0 }, span: { columns: 2, rows: 2 } },
            ],
          },
        },
      ],
    };
    expect(pinEntityToDock(withWidget, "widget-1")).toEqual({
      ok: false,
      reason: "dock-kind-not-allowed",
    });

    const placed = addAppToPage(baseWorkspace(), "page-1", app("app-a"));
    if (!placed.ok) throw new Error("fixture failed");
    const pinned = pinEntityToDock(placed.workspace, "app-a");
    if (!pinned.ok) throw new Error("fixture failed");
    expect(pinEntityToDock(pinned.workspace, "app-a")).toEqual({
      ok: false,
      reason: "already-pinned",
    });
    expect(pinEntityToDock(pinned.workspace, "entity-x")).toEqual({
      ok: false,
      reason: "entity-not-found",
    });

    const unpinned = unpinEntityFromDock(pinned.workspace, "app-a");
    expect(unpinned.ok).toBe(true);
    if (unpinned.ok) {
      expect(unpinned.workspace.dock.items).toEqual([]);
      expect(unpinned.workspace.entities).toHaveLength(1);
      expect(itemsOf(unpinned.workspace)).toHaveLength(1);
      expectValid(unpinned.workspace);
    }
    expect(unpinEntityFromDock(pinned.workspace, "app-b")).toEqual({
      ok: false,
      reason: "not-pinned",
    });
  });
});

describe("dissolveFolderToPage", () => {
  it("deletes an empty folder including layout item and dock pin", () => {
    const folderCreated = addFolderToPage(baseWorkspace(), "page-1", folder("folder-1", "Docs"));
    if (!folderCreated.ok) throw new Error("fixture failed");
    const pinned = pinEntityToDock(folderCreated.workspace, "folder-1");
    if (!pinned.ok) throw new Error("fixture failed");

    const result = dissolveFolderToPage(pinned.workspace, "folder-1", "page-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.entities).toEqual([]);
    expect(itemsOf(result.workspace)).toEqual([]);
    expect(result.workspace.dock.items).toEqual([]);
    expectValid(result.workspace);
  });

  it("returns children to the page in children order, starting from the folder anchor", () => {
    const placed = addAppToPage(baseWorkspace(), "page-1", app("app-away"), { column: 2, row: 2 });
    if (!placed.ok) throw new Error("fixture failed");
    const folderCreated = addFolderToPage(placed.workspace, "page-1", folder("folder-1", "Docs"), {
      column: 1,
      row: 1,
    });
    if (!folderCreated.ok) throw new Error("fixture failed");
    const childA = addAppToFolder(folderCreated.workspace, "folder-1", app("app-a"));
    if (!childA.ok) throw new Error("fixture failed");
    const childB = addAppToFolder(childA.workspace, "folder-1", app("app-b"));
    if (!childB.ok) throw new Error("fixture failed");
    const pinnedChild = pinEntityToDock(childB.workspace, "app-b");
    if (!pinnedChild.ok) throw new Error("fixture failed");

    const result = dissolveFolderToPage(pinnedChild.workspace, "folder-1", "page-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.entities.map((entity) => entity.id)).toEqual([
      "app-away",
      "app-a",
      "app-b",
    ]);
    const items = itemsOf(result.workspace);
    expect(items.find((item) => item.id === "folder-1")).toBeUndefined();
    // Children cascade outward from the folder anchor (1,1); the pinned child
    // keeps its dock reference.
    expect(items.filter((item) => item.id === "app-a" || item.id === "app-b")).toHaveLength(2);
    expect(items.find((item) => item.id === "app-a")?.position).toEqual({ column: 1, row: 1 });
    expect(result.workspace.dock.items).toEqual(["app-b"]);
    expectValid(result.workspace);
  });

  it("places children from the top-left when the folder lived on another page", () => {
    const secondPage: WorkspaceSnapshot = {
      ...baseWorkspace(),
      pages: [
        ...baseWorkspace().pages,
        {
          id: "page-2",
          name: "Second",
          layout: { id: "page-2", grid: { columns: 3, rows: 3 }, items: [] },
        },
      ],
      preferences: { ...baseWorkspace().preferences, defaultPageId: "page-1" },
    };
    const folderCreated = addFolderToPage(secondPage, "page-1", folder("folder-1", "Docs"), {
      column: 2,
      row: 2,
    });
    if (!folderCreated.ok) throw new Error("fixture failed");
    const child = addAppToFolder(folderCreated.workspace, "folder-1", app("app-a"));
    if (!child.ok) throw new Error("fixture failed");

    const result = dissolveFolderToPage(child.workspace, "folder-1", "page-2");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(itemsOf(result.workspace, "page-2")).toEqual([
      { id: "app-a", position: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } },
    ]);
    expect(itemsOf(result.workspace, "page-1")).toEqual([]);
    expectValid(result.workspace);
  });

  it("fails atomically with no-space when children do not fit", () => {
    const folderCreated = addFolderToPage(baseWorkspace(), "page-1", folder("folder-1", "Docs"));
    if (!folderCreated.ok) throw new Error("fixture failed");
    let almostFull = folderCreated.workspace;
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        if (row === 0 && column === 1) continue; // one free cell left
        const filled = addAppToPage(almostFull, "page-1", app(`app-${row}${column}`), {
          column,
          row,
        });
        if (!filled.ok) throw new Error("fixture failed");
        almostFull = filled.workspace;
      }
    }
    const childA = addAppToFolder(almostFull, "folder-1", app("app-a"));
    if (!childA.ok) throw new Error("fixture failed");
    const childB = addAppToFolder(childA.workspace, "folder-1", app("app-b"));
    if (!childB.ok) throw new Error("fixture failed");

    expectUnchanged(childB.workspace, () => {
      expect(dissolveFolderToPage(childB.workspace, "folder-1", "page-1")).toEqual({
        ok: false,
        reason: "no-space",
      });
    });
  });

  it("reports missing folders and pages", () => {
    expect(dissolveFolderToPage(baseWorkspace(), "folder-x", "page-1")).toEqual({
      ok: false,
      reason: "folder-not-found",
    });
    const folderCreated = addFolderToPage(baseWorkspace(), "page-1", folder("folder-1", "Docs"));
    if (!folderCreated.ok) throw new Error("fixture failed");
    expect(dissolveFolderToPage(folderCreated.workspace, "folder-1", "page-x")).toEqual({
      ok: false,
      reason: "page-not-found",
    });
  });
});
