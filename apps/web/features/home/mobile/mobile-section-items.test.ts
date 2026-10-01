import { describe, expect, it } from "vitest";
import { createEmptyWorkspace } from "@veladesk/domain";
import type {
  AppShortcut,
  DesktopPage,
  Folder,
  WidgetInstance,
  WorkspaceSnapshot,
} from "@veladesk/domain";

import { resolveMobileFolderApps, resolveMobileSectionItems } from "./mobile-section-items";

/**
 * Task 026 §22/§69: the mobile item projection — stable, deterministic
 * reading order that mirrors the desktop arrangement without consuming its
 * geometry; widgets skipped; dangling references safe; input untouched.
 */

function app(id: string, name = id): AppShortcut {
  return {
    kind: "app",
    id,
    name,
    url: `https://${id}.example.com/`,
    icon: { kind: "generated", text: name.slice(0, 2).toUpperCase() },
    openMode: "new-tab",
    tags: [],
  };
}

function folder(id: string, name: string, children: readonly string[]): Folder {
  return { kind: "folder", id, name, children };
}

function widget(id: string): WidgetInstance {
  return { kind: "widget", id, widgetType: "builtin.clock", config: {} };
}

function baseWorkspace(): WorkspaceSnapshot {
  return createEmptyWorkspace({
    workspaceId: "ws-m",
    workspaceName: "Mobile",
    pageId: "page-1",
    pageName: "Home",
    grid: { columns: 6, rows: 4 },
  });
}

function gridPage(items: readonly { id: string; column: number; row: number }[]): DesktopPage {
  return {
    id: "page-1",
    name: "Home",
    layout: { id: "page-1", grid: { columns: 6, rows: 4 }, items: [] },
    canvas: {
      version: 2 as const,
      mode: "grid" as const,
      columns: 6,
      items: items.map((item) => ({
        id: item.id,
        column: item.column,
        row: item.row,
        columnSpan: 1,
        rowSpan: 1,
      })),
    },
  };
}

function freeformPage(
  items: readonly { id: string; x: number; y: number }[],
): DesktopPage {
  return {
    id: "page-1",
    name: "Home",
    layout: { id: "page-1", grid: { columns: 6, rows: 4 }, items: [] },
    canvas: {
      version: 2 as const,
      mode: "freeform" as const,
      items: items.map((item) => ({
        id: item.id,
        rect: { x: item.x, y: item.y, width: 1000, height: 1000 },
      })),
    },
  };
}

describe("resolveMobileSectionItems — grid order (§22)", () => {
  it("orders row-major: top rows first, left first — the desktop reading order", () => {
    const workspace: WorkspaceSnapshot = {
      ...baseWorkspace(),
      pages: [
        gridPage([
          { id: "d", column: 3, row: 1 },
          { id: "b", column: 1, row: 0 },
          { id: "a", column: 0, row: 0 },
          { id: "c", column: 2, row: 0 },
        ]),
      ],
      entities: [app("a"), app("b"), app("c"), app("d")],
    };
    expect(
      resolveMobileSectionItems({ workspace, pageId: "page-1" }).map((item) => item.entityId),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("breaks same-geometry ties by stable id", () => {
    const workspace: WorkspaceSnapshot = {
      ...baseWorkspace(),
      pages: [gridPage([{ id: "z", column: 0, row: 0 }, { id: "a", column: 0, row: 0 }])],
      entities: [app("z"), app("a")],
    };
    expect(
      resolveMobileSectionItems({ workspace, pageId: "page-1" }).map((item) => item.entityId),
    ).toEqual(["a", "z"]);
  });
});

describe("resolveMobileSectionItems — freeform order (§22)", () => {
  it("orders top → left → id (visual reading order of the canvas)", () => {
    const workspace: WorkspaceSnapshot = {
      ...baseWorkspace(),
      pages: [
        freeformPage([
          { id: "low-right", x: 900, y: 500 },
          { id: "top-left", x: 10, y: 10 },
          { id: "top-right", x: 800, y: 10 },
          { id: "mid-left", x: 10, y: 300 },
        ]),
      ],
      entities: [app("low-right"), app("top-left"), app("top-right"), app("mid-left")],
    };
    expect(
      resolveMobileSectionItems({ workspace, pageId: "page-1" }).map((item) => item.entityId),
    ).toEqual(["top-left", "top-right", "mid-left", "low-right"]);
  });
});

describe("resolveMobileSectionItems — entity policy (§21)", () => {
  it("retains apps AND folders with their kinds", () => {
    const workspace: WorkspaceSnapshot = {
      ...baseWorkspace(),
      pages: [gridPage([{ id: "app-1", column: 0, row: 0 }, { id: "folder-1", column: 1, row: 0 }])],
      entities: [app("app-1"), folder("folder-1", "Tools", ["app-1"])],
    };
    expect(resolveMobileSectionItems({ workspace, pageId: "page-1" })).toEqual([
      { kind: "app", entityId: "app-1" },
      { kind: "folder", entityId: "folder-1" },
    ]);
  });

  it("quietly skips widgets — desktop-only presentation, never deleted", () => {
    const workspace: WorkspaceSnapshot = {
      ...baseWorkspace(),
      pages: [
        gridPage([
          { id: "app-1", column: 0, row: 0 },
          { id: "widget-1", column: 1, row: 0 },
          { id: "app-2", column: 2, row: 0 },
        ]),
      ],
      entities: [app("app-1"), widget("widget-1"), app("app-2")],
    };
    expect(
      resolveMobileSectionItems({ workspace, pageId: "page-1" }).map((item) => item.entityId),
    ).toEqual(["app-1", "app-2"]);
    // The widget is untouched in the snapshot — skipped, never removed.
    expect(workspace.entities.map((entity) => entity.id)).toContain("widget-1");
  });

  it("skips dangling member references safely", () => {
    const workspace: WorkspaceSnapshot = {
      ...baseWorkspace(),
      pages: [
        gridPage([{ id: "gone", column: 0, row: 0 }, { id: "app-1", column: 1, row: 0 }]),
      ],
      entities: [app("app-1")],
    };
    expect(
      resolveMobileSectionItems({ workspace, pageId: "page-1" }).map((item) => item.entityId),
    ).toEqual(["app-1"]);
  });

  it("returns [] for an unknown page and for a null page id", () => {
    const workspace = baseWorkspace();
    expect(resolveMobileSectionItems({ workspace, pageId: "nope" })).toEqual([]);
    expect(resolveMobileSectionItems({ workspace, pageId: null })).toEqual([]);
  });

  it("never mutates the input snapshot", () => {
    const workspace: WorkspaceSnapshot = {
      ...baseWorkspace(),
      pages: [
        gridPage([
          { id: "b", column: 1, row: 0 },
          { id: "a", column: 0, row: 0 },
        ]),
      ],
      entities: [app("a"), app("b")],
    };
    const before = JSON.stringify(workspace);
    resolveMobileSectionItems({ workspace, pageId: "page-1" });
    expect(JSON.stringify(workspace)).toBe(before);
  });

  it("derives legacy layout pages (no canvas) with the same row-major order", () => {
    const workspace: WorkspaceSnapshot = {
      ...baseWorkspace(),
      pages: [
        {
          id: "page-1",
          name: "Home",
          layout: {
            id: "page-1",
            grid: { columns: 6, rows: 4 },
            items: [
              { id: "b", position: { column: 2, row: 0 }, span: { columns: 1, rows: 1 } },
              { id: "a", position: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } },
              { id: "c", position: { column: 0, row: 1 }, span: { columns: 1, rows: 1 } },
            ],
          },
        },
      ],
      entities: [app("a"), app("b"), app("c")],
    };
    expect(
      resolveMobileSectionItems({ workspace, pageId: "page-1" }).map((item) => item.entityId),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("resolveMobileFolderApps", () => {
  it("resolves children in stored order, apps only", () => {
    const workspace: WorkspaceSnapshot = {
      ...baseWorkspace(),
      entities: [
        folder("folder-1", "Tools", ["app-2", "app-1", "ghost"]),
        app("app-1"),
        app("app-2"),
      ],
    };
    expect(
      resolveMobileFolderApps(workspace, "folder-1").map((entry) => entry.app.id),
    ).toEqual(["app-2", "app-1"]);
  });

  it("returns [] for null/unknown folders", () => {
    const workspace = baseWorkspace();
    expect(resolveMobileFolderApps(workspace, null)).toEqual([]);
    expect(resolveMobileFolderApps(workspace, "ghost")).toEqual([]);
  });
});
