import { describe, expect, it } from "vitest";

import {
  createEmptyWorkspace,
  pageItemIds,
  resolvePageCanvas,
  validateWorkspace,
} from "@veladesk/domain";
import type {
  AppShortcut,
  Folder,
  WidgetInstance,
  WorkspaceAppearancePreferences,
  WorkspacePreferences,
  WorkspaceSnapshot,
} from "@veladesk/domain";
import type { CanvasLayout } from "@veladesk/canvas-engine";

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
  replacePageCanvas,
  replaceWorkspacePreferences,
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

// Lattice cells of the 3x3 grid used across these tests. Edges are
// [0, 3333, 6667, 10000] with per-edge rounding, so cells are gap-free.
const CELL_0_0 = { x: 0, y: 0, width: 3333, height: 3333 };
const CELL_1_1 = { x: 3333, y: 3333, width: 3334, height: 3334 };
const CELL_2_2 = { x: 6667, y: 6667, width: 3333, height: 3333 };

function pageOf(workspace: WorkspaceSnapshot, pageId = "page-1") {
  const page = workspace.pages.find((candidate) => candidate.id === pageId);
  if (page === undefined) {
    throw new Error(`page ${pageId} missing`);
  }
  return page;
}

/**
 * Items of a page from the AUTHORITATIVE source: membership from
 * `pageItemIds` (canvas when present, legacy layout otherwise) and geometry
 * from `resolvePageCanvas`. Reading `page.layout.items` directly would hide a
 * canvas page's items now that a canvas empties that list.
 */
function itemsOf(workspace: WorkspaceSnapshot, pageId = "page-1") {
  const page = pageOf(workspace, pageId);
  const canvas = resolvePageCanvas(page);
  expect(canvas.items.map((item) => item.id)).toEqual([...pageItemIds(page)]);
  return canvas.items;
}

function canvasOf(workspace: WorkspaceSnapshot, pageId = "page-1"): CanvasLayout | undefined {
  return pageOf(workspace, pageId).canvas;
}

function rectOf(workspace: WorkspaceSnapshot, id: string, pageId = "page-1") {
  return itemsOf(workspace, pageId).find((item) => item.id === id)?.rect;
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
  it("keeps the task 010 contract: entity plus one default canvas cell at the page origin", () => {
    const result = addAppToPage(baseWorkspace(), "page-1", app("app-a"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.entities.map((entity) => entity.id)).toEqual(["app-a"]);
    expect(itemsOf(result.workspace)).toEqual([{ id: "app-a", rect: CELL_0_0 }]);
    // The canvas is authoritative now: the legacy grid item list stays empty.
    expect(canvasOf(result.workspace)?.mode).toBe("snap");
    expect(pageOf(result.workspace).layout.items).toEqual([]);
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

  it("reports page-not-found and keeps adding past one grid's worth because canvas pages overlap instead of rejecting", () => {
    expect(addAppToPage(baseWorkspace(), "page-x", app("app-a"))).toEqual({
      ok: false,
      reason: "page-not-found",
    });

    let workspace = baseWorkspace();
    for (let index = 0; index < 9; index += 1) {
      const filled = addAppToPage(workspace, "page-1", app(`app-${index}`));
      if (!filled.ok) throw new Error("fixture failed");
      workspace = filled.workspace;
    }
    expect(itemsOf(workspace)).toHaveLength(9);

    const extra = addAppToPage(workspace, "page-1", app("app-extra"));
    expect(extra.ok).toBe(true);
    if (!extra.ok) return;
    expect(itemsOf(extra.workspace)).toHaveLength(10);
    // Item 10 (index 9) wraps back to the first lattice cell — overlap is legal.
    expect(rectOf(extra.workspace, "app-extra")).toEqual(CELL_0_0);
    expectValid(extra.workspace);
  });

  it("rejects blank names and blank urls (011-B regression)", () => {
    const workspace = baseWorkspace();
    const before = JSON.parse(JSON.stringify(workspace));

    expect(addAppToPage(workspace, "page-1", app("app-a", ""))).toEqual({
      ok: false,
      reason: "invalid-name",
    });
    expect(addAppToPage(workspace, "page-1", app("app-a", "   "))).toEqual({
      ok: false,
      reason: "invalid-name",
    });
    expect(addAppToPage(workspace, "page-1", { ...app("app-a"), url: "" })).toEqual({
      ok: false,
      reason: "invalid-url",
    });
    expect(addAppToPage(workspace, "page-1", { ...app("app-a"), url: "   " })).toEqual({
      ok: false,
      reason: "invalid-url",
    });
    expect(JSON.parse(JSON.stringify(workspace))).toEqual(before);
  });

  it("keeps blank-name precedence behind duplicate id and page existence", () => {
    const seeded = addAppToPage(baseWorkspace(), "page-1", app("app-a"));
    if (!seeded.ok) throw new Error("fixture failed");
    expect(addAppToPage(seeded.workspace, "page-1", app("app-a", "  "))).toEqual({
      ok: false,
      reason: "duplicate-entity-id",
    });
    expect(addAppToPage(baseWorkspace(), "page-x", app("app-a", "  "))).toEqual({
      ok: false,
      reason: "page-not-found",
    });
  });

  it("stores valid custom protocols verbatim and keeps the workspace valid", () => {
    const custom: AppShortcut = {
      ...app("app-notes", "Notes"),
      url: "obsidian://open?vault=Notes",
    };

    const result = addAppToPage(baseWorkspace(), "page-1", custom);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = result.workspace.entities[0];
    expect(stored?.kind === "app" && stored.url).toBe("obsidian://open?vault=Notes");
    expect(stored?.kind === "app" && stored.name).toBe("Notes");
    expect(validateWorkspace(result.workspace)).toEqual([]);
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
  it("appends an empty folder entity plus one default canvas cell", () => {
    const result = addFolderToPage(baseWorkspace(), "page-1", folder("folder-1", "Docs"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = result.workspace.entities[0];
    expect(stored?.kind).toBe("folder");
    expect(stored?.kind === "folder" && stored.children).toEqual([]);
    expect(itemsOf(result.workspace)).toEqual([{ id: "folder-1", rect: CELL_0_0 }]);
    expect(canvasOf(result.workspace)?.items.map((item) => item.id)).toEqual(["folder-1"]);
    expect(pageOf(result.workspace).layout.items).toEqual([]);
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

  it("rejects duplicate ids and unknown pages but keeps accepting items past a full grid", () => {
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
    for (let index = 0; index < 9; index += 1) {
      const filled = addAppToPage(full, "page-1", app(`app-${index}`));
      if (!filled.ok) throw new Error("fixture failed");
      full = filled.workspace;
    }
    const overfull = addFolderToPage(full, "page-1", folder("folder-2", "Docs"));
    expect(overfull.ok).toBe(true);
    if (!overfull.ok) return;
    expect(itemsOf(overfull.workspace)).toHaveLength(10);
    expectValid(overfull.workspace);
  });
});

describe("replaceApp", () => {
  function workspaceWithApp(): WorkspaceSnapshot {
    const placed = addAppToPage(baseWorkspace(), "page-1", app("app-a", "Old"));
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
    const folderCreated = addFolderToPage(pinned.workspace, "page-1", folder("folder-1", "Docs"));
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
    const folderB = addFolderToPage(folderA.workspace, "page-1", folder("folder-b", "B"));
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
    const folderOnly = addFolderToPage(unplaced, "page-1", folder("folder-1", "Docs"));
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

    const result = moveAppToPage(child.workspace, "app-a", "page-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const folderEntity = result.workspace.entities.find((entity) => entity.id === "folder-1");
    expect(folderEntity?.kind === "folder" && folderEntity.children).toEqual([]);
    // The folder keeps the first cell; the app cascades to the next lattice
    // diagonal cell with the default cell size.
    expect(itemsOf(result.workspace)).toEqual([
      { id: "folder-1", rect: CELL_0_0 },
      { id: "app-a", rect: CELL_1_1 },
    ]);
    expectValid(result.workspace);
  });

  it("places a folder child even on a full grid and rejects apps already on any page", () => {
    const folderCreated = addFolderToPage(baseWorkspace(), "page-1", folder("folder-1", "Docs"));
    if (!folderCreated.ok) throw new Error("fixture failed");
    const child = addAppToFolder(folderCreated.workspace, "folder-1", app("app-a"));
    if (!child.ok) throw new Error("fixture failed");

    let almostFull = child.workspace;
    for (let index = 0; index < 8; index += 1) {
      const filled = addAppToPage(almostFull, "page-1", app(`app-${index}`));
      if (!filled.ok) throw new Error("fixture failed");
      almostFull = filled.workspace;
    }
    expect(itemsOf(almostFull)).toHaveLength(9);

    // Overlap is legal, so the folder child still lands on the page.
    const moved = moveAppToPage(almostFull, "app-a", "page-1");
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(itemsOf(moved.workspace)).toHaveLength(10);
    expect(rectOf(moved.workspace, "app-a")).toEqual(CELL_0_0);
    expectValid(moved.workspace);

    const placed = addAppToPage(baseWorkspace(), "page-1", app("app-a"));
    if (!placed.ok) throw new Error("fixture failed");
    expectUnchanged(placed.workspace, () => {
      expect(moveAppToPage(placed.workspace, "app-a", "page-1")).toEqual({
        ok: false,
        reason: "already-on-page",
      });
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
    const placed = addAppToPage(baseWorkspace(), "page-1", app("app-away"));
    if (!placed.ok) throw new Error("fixture failed");
    const folderCreated = addFolderToPage(placed.workspace, "page-1", folder("folder-1", "Docs"));
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
    // The first child lands on the folder shell's cell and the rest cascade
    // from that anchor; the pinned child keeps its dock reference.
    expect(rectOf(result.workspace, "app-away")).toEqual(CELL_0_0);
    expect(rectOf(result.workspace, "app-a")).toEqual(CELL_1_1);
    expect(rectOf(result.workspace, "app-b")).toEqual(CELL_2_2);
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
    const folderCreated = addFolderToPage(secondPage, "page-1", folder("folder-1", "Docs"));
    if (!folderCreated.ok) throw new Error("fixture failed");
    const child = addAppToFolder(folderCreated.workspace, "folder-1", app("app-a"));
    if (!child.ok) throw new Error("fixture failed");

    const result = dissolveFolderToPage(child.workspace, "folder-1", "page-2");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No anchor on the target page, so the child cascades from the origin.
    expect(itemsOf(result.workspace, "page-2")).toEqual([{ id: "app-a", rect: CELL_0_0 }]);
    expect(itemsOf(result.workspace, "page-1")).toEqual([]);
    expectValid(result.workspace);
  });

  it("dissolves children even when the page already holds a full grid because canvas children overlap", () => {
    const folderCreated = addFolderToPage(baseWorkspace(), "page-1", folder("folder-1", "Docs"));
    if (!folderCreated.ok) throw new Error("fixture failed");
    let almostFull = folderCreated.workspace;
    for (let index = 0; index < 8; index += 1) {
      const filled = addAppToPage(almostFull, "page-1", app(`app-${index}`));
      if (!filled.ok) throw new Error("fixture failed");
      almostFull = filled.workspace;
    }
    expect(itemsOf(almostFull)).toHaveLength(9);
    const childA = addAppToFolder(almostFull, "folder-1", app("app-a"));
    if (!childA.ok) throw new Error("fixture failed");
    const childB = addAppToFolder(childA.workspace, "folder-1", app("app-b"));
    if (!childB.ok) throw new Error("fixture failed");

    const result = dissolveFolderToPage(childB.workspace, "folder-1", "page-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The folder shell is gone; both children overlap the existing nine items.
    expect(itemsOf(result.workspace)).toHaveLength(10);
    expect(rectOf(result.workspace, "app-a")).toEqual(CELL_0_0);
    expect(rectOf(result.workspace, "app-b")).toEqual(CELL_1_1);
    expectValid(result.workspace);
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

describe("replaceWorkspacePreferences", () => {
  function twoPageWorkspace(): WorkspaceSnapshot {
    const base = baseWorkspace();
    return {
      ...base,
      pages: [
        ...base.pages,
        {
          id: "page-2",
          name: "Work",
          layout: { id: "page-2", grid: { columns: 3, rows: 3 }, items: [] },
        },
      ],
    };
  }

  const validAppearance: WorkspaceAppearancePreferences = {
    colorMode: "light",
    accentHue: 310,
    wallpaperPreset: "mist",
    surfaceOpacity: 0.7,
    blurPx: 8,
    radiusPx: 20,
    iconSize: "large",
  };

  it("replaces the default page and keeps every other field by reference", () => {
    const workspace = twoPageWorkspace();
    const next: WorkspacePreferences = {
      ...workspace.preferences,
      defaultPageId: "page-2",
    };

    const result = replaceWorkspacePreferences(workspace, next);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspace.preferences.defaultPageId).toBe("page-2");
      expect(result.workspace.pages).toBe(workspace.pages);
      expect(result.workspace.entities).toBe(workspace.entities);
      expect(result.workspace.categories).toBe(workspace.categories);
      expect(result.workspace.dock).toBe(workspace.dock);
      expectValid(result.workspace);
    }
  });

  it("replaces layoutLocked without touching anything else", () => {
    const workspace = twoPageWorkspace();
    const next: WorkspacePreferences = {
      ...workspace.preferences,
      layoutLocked: false,
    };

    const result = replaceWorkspacePreferences(workspace, next);

    expect(result.ok && result.workspace.preferences.layoutLocked).toBe(false);
  });

  it("replaces the appearance with a valid non-default one", () => {
    const workspace = twoPageWorkspace();
    const next: WorkspacePreferences = {
      ...workspace.preferences,
      appearance: validAppearance,
    };

    const result = replaceWorkspacePreferences(workspace, next);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspace.preferences.appearance).toEqual(validAppearance);
      expectValid(result.workspace);
    }
  });

  it("accepts legacy-style preferences without an appearance field", () => {
    const workspace = twoPageWorkspace();
    const next: WorkspacePreferences = {
      defaultPageId: "page-1",
      layoutLocked: true,
    };

    const result = replaceWorkspacePreferences(workspace, next);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspace.preferences.appearance).toBeUndefined();
      expectValid(result.workspace);
    }
  });

  it("refuses a default page that does not exist and keeps the input unchanged", () => {
    const workspace = twoPageWorkspace();
    const next: WorkspacePreferences = {
      ...workspace.preferences,
      defaultPageId: "page-missing",
    };

    expect(replaceWorkspacePreferences(workspace, next)).toEqual({
      ok: false,
      reason: "default-page-not-found",
    });
    expectUnchanged(workspace, () => replaceWorkspacePreferences(workspace, next));
  });

  it("refuses an appearance with an out-of-range hue", () => {
    const workspace = twoPageWorkspace();
    const next: WorkspacePreferences = {
      ...workspace.preferences,
      appearance: { ...validAppearance, accentHue: 999 },
    };

    expect(replaceWorkspacePreferences(workspace, next)).toEqual({
      ok: false,
      reason: "invalid-appearance",
    });
  });

  it("refuses an appearance with an out-of-range surface opacity", () => {
    const workspace = twoPageWorkspace();
    const next: WorkspacePreferences = {
      ...workspace.preferences,
      appearance: { ...validAppearance, surfaceOpacity: 5 },
    };

    expect(replaceWorkspacePreferences(workspace, next)).toEqual({
      ok: false,
      reason: "invalid-appearance",
    });
  });
});

// ---------------------------------------------------------------------------
// Task 015 — Sections (DesktopPage CRUD) + app relocation
// ---------------------------------------------------------------------------

import {
  addPage,
  deleteEmptyPage,
  movePage,
  relocateAppToPage,
  renamePage,
  setDefaultPage,
} from "./editing";
import type { DesktopPage } from "@veladesk/domain";

function emptyPage(id: string, name: string, grid = { columns: 3, rows: 3 }): DesktopPage {
  return { id, name, layout: { id, grid, items: [] } };
}

/** page-1 (Home) with one placed app, page-2 (Work) empty, page-3 (Lab) empty. */
function sectionedWorkspace(): WorkspaceSnapshot {
  const base = baseWorkspace();
  const withApp = addAppToPage(
    {
      ...base,
      pages: [base.pages[0]!, emptyPage("page-2", "Work"), emptyPage("page-3", "Lab")],
    },
    "page-1",
    app("app-a")
  );
  if (!withApp.ok) throw new Error("fixture failed");
  return withApp.workspace;
}

describe("relocateAppToPage", () => {
  it("moves an app from page A to page B: source ref removed, target canvas item added", () => {
    const workspace = sectionedWorkspace();

    const result = relocateAppToPage(workspace, "app-a", "page-2");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(itemsOf(result.workspace, "page-1")).toEqual([]);
    // The app keeps its canvas size and cascades to the target's first cell.
    expect(itemsOf(result.workspace, "page-2")).toEqual([{ id: "app-a", rect: CELL_0_0 }]);
    expect(result.workspace.entities.map((entity) => entity.id)).toEqual(["app-a"]);
    expectValid(result.workspace);
  });

  it("keeps the dock pin and never touches the dock", () => {
    const pinned = pinEntityToDock(sectionedWorkspace(), "app-a");
    if (!pinned.ok) throw new Error("fixture failed");

    const result = relocateAppToPage(pinned.workspace, "app-a", "page-3");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.dock.items).toEqual(["app-a"]);
    expectValid(result.workspace);
  });

  it("moves an app out of a folder: folder survives without the child", () => {
    const base = sectionedWorkspace();
    const withFolder = addFolderToPage(base, "page-2", folder("folder-1", "Stuff"));
    if (!withFolder.ok) throw new Error("fixture failed");
    const moved = moveAppToFolder(withFolder.workspace, "app-a", "folder-1");
    if (!moved.ok) throw new Error("fixture failed");

    const result = relocateAppToPage(moved.workspace, "app-a", "page-2");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const survivingFolder = result.workspace.entities.find(
      (entity) => entity.kind === "folder"
    );
    expect(survivingFolder).toMatchObject({ id: "folder-1", children: [] });
    // The folder keeps the first cell; the relocated app cascades to the next
    // lattice diagonal cell (a folder child has no rect of its own to keep).
    expect(itemsOf(result.workspace, "page-2")).toEqual([
      { id: "folder-1", rect: CELL_0_0 },
      { id: "app-a", rect: CELL_1_1 },
    ]);
    expectValid(result.workspace);
  });

  it("places a previously unplaced app", () => {
    const workspace = {
      ...sectionedWorkspace(),
      entities: [...sectionedWorkspace().entities, app("app-lost")],
    };

    const result = relocateAppToPage(workspace, "app-lost", "page-2");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(itemsOf(result.workspace, "page-2").map((item) => item.id)).toEqual(["app-lost"]);
    expect(rectOf(result.workspace, "app-lost", "page-2")).toEqual(CELL_0_0);
    expectValid(result.workspace);
  });

  it("preserves the source rect size when relocating from another canvas page", () => {
    const workspace = sectionedWorkspace();
    const resized = replacePageCanvas(workspace, "page-1", {
      version: 1,
      mode: "snap",
      items: [{ id: "app-a", rect: { x: 1000, y: 2000, width: 5000, height: 4000 } }],
    });
    if (!resized.ok) throw new Error("fixture failed");

    const result = relocateAppToPage(resized.workspace, "app-a", "page-3");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The size is preserved; only the position comes from the cascade.
    expect(rectOf(result.workspace, "app-a", "page-3")).toEqual({
      x: 0,
      y: 0,
      width: 5000,
      height: 4000,
    });
    expectValid(result.workspace);
  });

  it("refuses an app that already sits on the target page and never mutates the input", () => {
    const workspace = sectionedWorkspace();

    expectUnchanged(workspace, () => {
      expect(relocateAppToPage(workspace, "app-a", "page-1")).toEqual({
        ok: false,
        reason: "already-on-page",
      });
    });
  });

  it("refuses a missing app and a missing target page", () => {
    const workspace = sectionedWorkspace();

    expect(relocateAppToPage(workspace, "app-x", "page-2")).toEqual({
      ok: false,
      reason: "app-not-found",
    });
    expect(relocateAppToPage(workspace, "app-a", "page-x")).toEqual({
      ok: false,
      reason: "page-not-found",
    });
  });

  it("relocates onto a page that already holds a full grid because canvas items overlap", () => {
    const workspace = sectionedWorkspace();
    // Fill page-2 completely (3x3 = 9 items).
    let full = workspace;
    for (let index = 0; index < 9; index += 1) {
      const filled = addAppToPage(full, "page-2", app(`fill-${index}`));
      if (!filled.ok) throw new Error("fixture failed");
      full = filled.workspace;
    }
    expect(canvasOf(full, "page-2")?.items).toHaveLength(9);

    const result = relocateAppToPage(full, "app-a", "page-2");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(itemsOf(result.workspace, "page-2")).toHaveLength(10);
    expect(itemsOf(result.workspace, "page-1")).toEqual([]);
    // Item 10 (index 9) wraps back to the first cell with the preserved size.
    expect(rectOf(result.workspace, "app-a", "page-2")).toEqual(CELL_0_0);
    expect(itemsOf(result.workspace, "page-2").map((item) => item.id)).toContain("app-a");
    expectValid(result.workspace);
  });

  it("never mutates the input workspace", () => {
    const workspace = sectionedWorkspace();

    expectUnchanged(workspace, () => relocateAppToPage(workspace, "app-a", "page-2"));
  });
});

describe("addPage", () => {
  it("appends an empty page and keeps every other workspace field", () => {
    const workspace = sectionedWorkspace();

    const result = addPage(workspace, emptyPage("page-9", "Play"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.pages.map((page) => page.id)).toEqual([
      "page-1",
      "page-2",
      "page-3",
      "page-9",
    ]);
    expect(result.workspace.entities).toBe(workspace.entities);
    expect(result.workspace.dock).toBe(workspace.dock);
    expect(result.workspace.preferences).toBe(workspace.preferences);
    expectValid(result.workspace);
  });

  it("refuses a duplicate page id", () => {
    expect(addPage(sectionedWorkspace(), emptyPage("page-2", "Dup"))).toEqual({
      ok: false,
      reason: "duplicate-page-id",
    });
  });

  it("refuses a blank name", () => {
    expect(addPage(sectionedWorkspace(), emptyPage("page-9", "   "))).toEqual({
      ok: false,
      reason: "invalid-page-name",
    });
  });

  it("refuses a layout whose id differs from the page id", () => {
    const page: DesktopPage = {
      id: "page-9",
      name: "Play",
      layout: { id: "layout-other", grid: { columns: 3, rows: 3 }, items: [] },
    };
    expect(addPage(sectionedWorkspace(), page)).toEqual({
      ok: false,
      reason: "page-layout-id-mismatch",
    });
  });

  it("refuses a non-empty layout", () => {
    const page: DesktopPage = {
      id: "page-9",
      name: "Play",
      layout: {
        id: "page-9",
        grid: { columns: 3, rows: 3 },
        items: [{ id: "app-a", position: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } }],
      },
    };
    expect(addPage(sectionedWorkspace(), page)).toEqual({
      ok: false,
      reason: "page-must-be-empty",
    });
  });

  it("refuses a semantically invalid grid through the engine validation", () => {
    expect(addPage(sectionedWorkspace(), emptyPage("page-9", "Play", { columns: 0, rows: 3 }))).toEqual(
      {
        ok: false,
        reason: "invalid-page-layout",
      }
    );
  });

  it("accepts a canvas page whose canvas is empty and valid", () => {
    const page: DesktopPage = {
      id: "page-9",
      name: "Play",
      layout: { id: "page-9", grid: { columns: 3, rows: 3 }, items: [] },
      canvas: { version: 1, mode: "freeform", items: [] },
    };

    const result = addPage(sectionedWorkspace(), page);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(canvasOf(result.workspace, "page-9")).toEqual({
      version: 1,
      mode: "freeform",
      items: [],
    });
    expectValid(result.workspace);
  });

  it("refuses a canvas page whose canvas holds items as page-must-be-empty", () => {
    const page: DesktopPage = {
      id: "page-9",
      name: "Play",
      layout: { id: "page-9", grid: { columns: 3, rows: 3 }, items: [] },
      canvas: {
        version: 1,
        mode: "snap",
        items: [{ id: "app-a", rect: { x: 0, y: 0, width: 3333, height: 3333 } }],
      },
    };

    expect(addPage(sectionedWorkspace(), page)).toEqual({
      ok: false,
      reason: "page-must-be-empty",
    });
  });

  it("refuses a canvas page with an invalid canvas as invalid-page-layout", () => {
    const page: DesktopPage = {
      id: "page-9",
      name: "Play",
      layout: { id: "page-9", grid: { columns: 3, rows: 3 }, items: [] },
      // An empty item list keeps hasPageItems false, so the canvas semantics
      // are what rejects the page. A wrong version is unreachable from the
      // public type, hence the cast.
      canvas: { version: 2, mode: "snap", items: [] } as unknown as CanvasLayout,
    };

    expect(addPage(sectionedWorkspace(), page)).toEqual({
      ok: false,
      reason: "invalid-page-layout",
    });
  });

  it("never mutates the input workspace", () => {
    const workspace = sectionedWorkspace();

    expectUnchanged(workspace, () => addPage(workspace, emptyPage("page-9", "Play")));
  });
});

describe("renamePage", () => {
  it("stores the next name verbatim and keeps layout and array position", () => {
    const workspace = sectionedWorkspace();

    const result = renamePage(workspace, "page-2", "  Deep Work  ");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.pages[1]?.name).toBe("  Deep Work  ");
    expect(result.workspace.pages[1]?.layout).toBe(workspace.pages[1]?.layout);
    expect(result.workspace.pages.map((page) => page.id)).toEqual(
      workspace.pages.map((page) => page.id)
    );
    expectValid(result.workspace);
  });

  it("refuses a missing page and a blank name", () => {
    expect(renamePage(sectionedWorkspace(), "page-x", "Nope")).toEqual({
      ok: false,
      reason: "page-not-found",
    });
    expect(renamePage(sectionedWorkspace(), "page-2", " ")).toEqual({
      ok: false,
      reason: "invalid-page-name",
    });
  });

  it("never mutates the input workspace", () => {
    const workspace = sectionedWorkspace();

    expectUnchanged(workspace, () => renamePage(workspace, "page-2", "Renamed"));
  });
});

describe("movePage", () => {
  it("moves a page up and down within the pages array", () => {
    const workspace = sectionedWorkspace();

    const down = movePage(workspace, "page-1", "down");
    expect(down.ok).toBe(true);
    if (down.ok) {
      expect(down.workspace.pages.map((page) => page.id)).toEqual([
        "page-2",
        "page-1",
        "page-3",
      ]);
      expectValid(down.workspace);
    }

    const up = movePage(workspace, "page-2", "up");
    expect(up.ok).toBe(true);
    if (up.ok) {
      expect(up.workspace.pages.map((page) => page.id)).toEqual([
        "page-2",
        "page-1",
        "page-3",
      ]);
    }
  });

  it("refuses the first-up and last-down boundaries", () => {
    const workspace = sectionedWorkspace();

    expect(movePage(workspace, "page-1", "up")).toEqual({
      ok: false,
      reason: "page-order-boundary",
    });
    expect(movePage(workspace, "page-3", "down")).toEqual({
      ok: false,
      reason: "page-order-boundary",
    });
  });

  it("keeps the default page and page contents untouched", () => {
    const workspace = sectionedWorkspace();

    const result = movePage(workspace, "page-2", "up");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspace.preferences.defaultPageId).toBe(
        workspace.preferences.defaultPageId
      );
      expect(itemsOf(result.workspace, "page-1")).toEqual(itemsOf(workspace, "page-1"));
    }
  });

  it("refuses a missing page and never mutates the input", () => {
    const workspace = sectionedWorkspace();

    expect(movePage(workspace, "page-x", "up")).toEqual({
      ok: false,
      reason: "page-not-found",
    });
    expectUnchanged(workspace, () => movePage(workspace, "page-2", "up"));
  });
});

describe("setDefaultPage", () => {
  it("changes only preferences.defaultPageId and preserves appearance + layoutLocked", () => {
    const workspace = sectionedWorkspace();

    const result = setDefaultPage(workspace, "page-3");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.preferences.defaultPageId).toBe("page-3");
    expect(result.workspace.preferences.layoutLocked).toBe(workspace.preferences.layoutLocked);
    expect(result.workspace.preferences.appearance).toBe(workspace.preferences.appearance);
    expectValid(result.workspace);
  });

  it("refuses a missing page", () => {
    expect(setDefaultPage(sectionedWorkspace(), "page-x")).toEqual({
      ok: false,
      reason: "page-not-found",
    });
  });

  it("never mutates the input workspace", () => {
    const workspace = sectionedWorkspace();

    expectUnchanged(workspace, () => setDefaultPage(workspace, "page-2"));
  });
});

describe("deleteEmptyPage", () => {
  it("deletes an empty page and validates cleanly", () => {
    const workspace = sectionedWorkspace();

    const result = deleteEmptyPage(workspace, "page-2");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.pages.map((page) => page.id)).toEqual(["page-1", "page-3"]);
    expectValid(result.workspace);
  });

  it("refuses a non-empty page and the last remaining page", () => {
    const workspace = sectionedWorkspace();
    expect(deleteEmptyPage(workspace, "page-1")).toEqual({
      ok: false,
      reason: "page-not-empty",
    });

    // A workspace whose LAST surviving page is empty (page-1 starts empty
    // here — no apps at all) refuses with cannot-delete-last-page.
    const withTwo = addPage(baseWorkspace(), emptyPage("page-2", "Work"));
    if (!withTwo.ok) throw new Error("fixture failed");
    const extended = addPage(withTwo.workspace, emptyPage("page-3", "Lab"));
    if (!extended.ok) throw new Error("fixture failed");
    const oneLeft = deleteEmptyPage(extended.workspace, "page-3");
    expect(oneLeft.ok).toBe(true);
    if (oneLeft.ok) {
      const twoLeft = deleteEmptyPage(oneLeft.workspace, "page-2");
      expect(twoLeft.ok).toBe(true);
      if (twoLeft.ok) {
        expect(deleteEmptyPage(twoLeft.workspace, "page-1")).toEqual({
          ok: false,
          reason: "cannot-delete-last-page",
        });
      }
    }
  });

  it("re-targets the default to the NEXT page when deleting a middle default", () => {
    const workspace = sectionedWorkspace();
    const defaulted = setDefaultPage(workspace, "page-2");
    if (!defaulted.ok) throw new Error("fixture failed");

    const result = deleteEmptyPage(defaulted.workspace, "page-2");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspace.preferences.defaultPageId).toBe("page-3");
      expectValid(result.workspace);
    }
  });

  it("re-targets the default to the PREVIOUS page when deleting the last default", () => {
    const workspace = sectionedWorkspace();
    const defaulted = setDefaultPage(workspace, "page-3");
    if (!defaulted.ok) throw new Error("fixture failed");

    const result = deleteEmptyPage(defaulted.workspace, "page-3");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspace.preferences.defaultPageId).toBe("page-2");
    }
  });

  it("keeps the default untouched when deleting a non-default page and refuses missing pages", () => {
    const workspace = sectionedWorkspace();

    const result = deleteEmptyPage(workspace, "page-3");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspace.preferences.defaultPageId).toBe("page-1");
    }

    expect(deleteEmptyPage(workspace, "page-x")).toEqual({
      ok: false,
      reason: "page-not-found",
    });
  });

  it("never mutates the input workspace", () => {
    const workspace = sectionedWorkspace();

    expectUnchanged(workspace, () => deleteEmptyPage(workspace, "page-2"));
  });
});
