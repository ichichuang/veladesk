import { describe, expect, it } from "vitest";

import type {
  CanvasLayout,
  CanvasPlacementMode,
  CanvasRect,
} from "@veladesk/canvas-engine";
import type { GridDefinition, LayoutItem } from "@veladesk/desktop-engine";
import {
  addAppToPage,
  createEmptyWorkspace,
  decodeWorkspaceSnapshot,
  isCanvasPage,
  materializePageCanvas,
  newCanvasItemRect,
  pageItemIds,
  placePageItem,
  replacePageCanvas,
  resolvePageCanvas,
  validateWorkspace,
} from "@veladesk/domain";
import type { AppShortcut, DesktopPage, WorkspaceSnapshot } from "@veladesk/domain";

// Lattice cells of the 3x3 grid (edges [0, 3333, 6667, 10000]).
const CELL_0_0: CanvasRect = { x: 0, y: 0, width: 3333, height: 3333 };
const CELL_1_1: CanvasRect = { x: 3333, y: 3333, width: 3334, height: 3334 };
const CELL_2_2: CanvasRect = { x: 6667, y: 6667, width: 3333, height: 3333 };

const GRID: GridDefinition = { columns: 3, rows: 3 };

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

function emptyWorkspace(): WorkspaceSnapshot {
  return createEmptyWorkspace({
    workspaceId: "workspace-1",
    workspaceName: "Desk",
    pageId: "page-1",
    pageName: "Home",
    grid: GRID,
  });
}

function legacyWorkspace(
  items: readonly LayoutItem[],
  grid: GridDefinition = GRID,
): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "workspace-1",
    workspaceName: "Desk",
    pageId: "page-1",
    pageName: "Home",
    grid,
  });
  return {
    ...base,
    entities: items.map((item) => app(item.id)),
    pages: [{ id: "page-1", name: "Home", layout: { id: "page-1", grid, items } }],
  };
}

function canvasPage(
  id: string,
  items: readonly { readonly id: string; readonly rect: CanvasRect }[],
  mode: CanvasPlacementMode = "snap",
  grid: GridDefinition = GRID,
): DesktopPage {
  return {
    id,
    name: id,
    layout: { id, grid, items: [] },
    canvas: { version: 1, mode, items },
  };
}

function canvasWorkspaceWithApp(): WorkspaceSnapshot {
  const placed = addAppToPage(emptyWorkspace(), "page-1", app("app-a"));
  if (!placed.ok) throw new Error("fixture failed");
  return placed.workspace;
}

describe("workspace-level canvas validation", () => {
  it("validates a legacy canvas-less workspace clean", () => {
    const workspace = legacyWorkspace([
      { id: "app-a", position: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } },
    ]);

    expect(workspace.pages[0]?.canvas).toBeUndefined();
    expect(validateWorkspace(workspace)).toEqual([]);
  });

  it("validates a canvas-native workspace clean", () => {
    const workspace = createEmptyWorkspace({
      workspaceId: "workspace-1",
      workspaceName: "Desk",
      pageId: "page-1",
      pageName: "Home",
      grid: GRID,
    });

    expect(workspace.pages[0]?.canvas).toEqual({ version: 1, mode: "snap", items: [] });
    expect(validateWorkspace(workspace)).toEqual([]);
  });
});

describe("pageItemIds", () => {
  it("resolves canvas ids when a canvas exists and legacy layout ids otherwise", () => {
    const legacy = legacyWorkspace([
      { id: "legacy-a", position: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } },
    ]);
    expect(pageItemIds(legacy.pages[0]!)).toEqual(["legacy-a"]);

    // The canvas is authoritative even if a stale legacy item is present
    // (that state is invalid, but membership must still follow the canvas).
    const mixed: DesktopPage = {
      id: "page-1",
      name: "Home",
      layout: {
        id: "page-1",
        grid: GRID,
        items: [{ id: "stale", position: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } }],
      },
      canvas: { version: 1, mode: "snap", items: [{ id: "canvas-a", rect: CELL_0_0 }] },
    };
    expect(pageItemIds(mixed)).toEqual(["canvas-a"]);
  });
});

describe("resolvePageCanvas", () => {
  it("derives snap rects per-edge with no cumulative drift and never mutates the page", () => {
    const page: DesktopPage = {
      id: "page-1",
      name: "Home",
      layout: {
        id: "page-1",
        grid: { columns: 6, rows: 6 },
        items: [
          { id: "app-top", position: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } },
          { id: "app-last", position: { column: 0, row: 5 }, span: { columns: 1, rows: 1 } },
          { id: "app-wide", position: { column: 0, row: 1 }, span: { columns: 6, rows: 1 } },
        ],
      },
    };
    const before = JSON.parse(JSON.stringify(page));

    const canvas = resolvePageCanvas(page);

    expect(canvas.version).toBe(1);
    expect(canvas.mode).toBe("snap");
    expect(canvas.items).toEqual([
      { id: "app-top", rect: { x: 0, y: 0, width: 1667, height: 1667 } },
      // Row 5 starts at round(5/6*10000)=8333, never 1667*5=8335.
      { id: "app-last", rect: { x: 0, y: 8333, width: 1667, height: 1667 } },
      // A row-1 cell is 3333-1667=1666 tall.
      { id: "app-wide", rect: { x: 0, y: 1667, width: 10000, height: 1666 } },
    ]);
    expect(canvas.items[1]?.rect.y).toBe(8333);
    // Pure derivation: nothing is written back to the page.
    expect(page.canvas).toBeUndefined();
    expect(JSON.parse(JSON.stringify(page))).toEqual(before);
  });
});

describe("materializePageCanvas", () => {
  it("is identity for canvas pages and freezes legacy geometry otherwise", () => {
    const legacy = legacyWorkspace([
      { id: "app-a", position: { column: 2, row: 1 }, span: { columns: 1, rows: 2 } },
    ]);
    const page = legacy.pages[0]!;
    const derived = resolvePageCanvas(page);

    const materialized = materializePageCanvas(page);

    // The frozen canvas renders exactly what the virtual canvas did before.
    expect(materialized.canvas).toEqual(derived);
    expect(pageItemIds(materialized)).toEqual(["app-a"]);
    expect(materialized.layout.items).toEqual([]);
    expect(materialized.layout.grid).toEqual(page.layout.grid);
    // The source page is left untouched.
    expect(page.canvas).toBeUndefined();
    expect(page.layout.items).toHaveLength(1);

    // A page that already carries a canvas keeps its exact canvas reference
    // (identity, not a re-derivation).
    const again = materializePageCanvas(materialized);
    expect(isCanvasPage(again)).toBe(true);
    expect(again.canvas).toBe(materialized.canvas);
    expect(again.layout).toBe(materialized.layout);
  });
});

describe("newCanvasItemRect", () => {
  it("cascades snap items along the lattice diagonal", () => {
    const args = { grid: GRID, mode: "snap" as const };

    expect(newCanvasItemRect({ ...args, index: 0 })).toEqual(CELL_0_0);
    expect(newCanvasItemRect({ ...args, index: 1 })).toEqual(CELL_1_1);
    expect(newCanvasItemRect({ ...args, index: 2 })).toEqual(CELL_2_2);
    // Index 3 wraps back to the first cell.
    expect(newCanvasItemRect({ ...args, index: 3 })).toEqual(CELL_0_0);
    // An anchor starts the diagonal at the anchor's lattice cell.
    expect(newCanvasItemRect({ ...args, index: 0, anchor: CELL_2_2 })).toEqual(CELL_2_2);
    expect(newCanvasItemRect({ ...args, index: 1, anchor: CELL_2_2 })).toEqual(CELL_0_0);
  });

  it("cascades freeform items by an eighth of a cell and clamps at the canvas edge", () => {
    const args = { grid: GRID, mode: "freeform" as const };
    // Cell width 3333 → step round(3333/8) = 417.
    expect(newCanvasItemRect({ ...args, index: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 3333,
      height: 3333,
    });
    expect(newCanvasItemRect({ ...args, index: 1 })).toEqual({
      x: 417,
      y: 417,
      width: 3333,
      height: 3333,
    });
    expect(newCanvasItemRect({ ...args, index: 2 })).toEqual({
      x: 834,
      y: 834,
      width: 3333,
      height: 3333,
    });
    // 16 * 417 = 6672 exceeds 10000 - 3333 = 6667 and clamps.
    expect(newCanvasItemRect({ ...args, index: 16 })).toEqual({
      x: 6667,
      y: 6667,
      width: 3333,
      height: 3333,
    });
    expect(newCanvasItemRect({ ...args, index: 100 })).toEqual({
      x: 6667,
      y: 6667,
      width: 3333,
      height: 3333,
    });
    // An anchor offsets the cascade origin.
    expect(newCanvasItemRect({ ...args, index: 0, anchor: { x: 1000, y: 2000, width: 1, height: 1 } })).toEqual(
      { x: 1000, y: 2000, width: 3333, height: 3333 },
    );
  });
});

describe("placePageItem", () => {
  it("preserves a given size and clamps it into the canvas", () => {
    const placed = placePageItem(legacyWorkspace([]).pages[0]!, "app-a", {
      index: 0,
      size: { width: 5000, height: 4000 },
    });
    expect(placed.canvas.items).toEqual([
      { id: "app-a", rect: { x: 0, y: 0, width: 5000, height: 4000 } },
    ]);
    expect(placed.layout.items).toEqual([]);

    // An oversized size clamps to the canvas extent; a degenerate one clamps
    // up to the minimum rect size.
    const oversized = placePageItem(legacyWorkspace([]).pages[0]!, "app-b", {
      index: 0,
      size: { width: 99999, height: 1 },
    });
    expect(oversized.canvas.items[0]?.rect).toEqual({
      x: 0,
      y: 0,
      width: 10000,
      height: 1,
    });
    const degenerate = placePageItem(legacyWorkspace([]).pages[0]!, "app-c", {
      index: 0,
      size: { width: 0, height: -5 },
    });
    expect(degenerate.canvas.items[0]?.rect).toEqual({ x: 0, y: 0, width: 1, height: 1 });

    // A size that fits is repositioned so it never leaves the canvas.
    const freeform = placePageItem(canvasPage("page-1", [], "freeform"), "app-d", {
      index: 16,
      size: { width: 5000, height: 5000 },
    });
    expect(freeform.canvas.items[0]?.rect).toEqual({
      x: 5000,
      y: 5000,
      width: 5000,
      height: 5000,
    });
  });
});

describe("canvas-aware validation issues", () => {
  it("reports canvas-page-has-legacy-items when a canvas page still holds legacy items", () => {
    const page: DesktopPage = {
      id: "page-1",
      name: "Home",
      layout: {
        id: "page-1",
        grid: GRID,
        items: [{ id: "app-a", position: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } }],
      },
      canvas: { version: 1, mode: "snap", items: [{ id: "app-a", rect: CELL_0_0 }] },
    };
    const workspace: WorkspaceSnapshot = { ...emptyWorkspace(), entities: [app("app-a")], pages: [page] };

    expect(validateWorkspace(workspace)).toContainEqual({
      type: "canvas-page-has-legacy-items",
      pageId: "page-1",
    });
  });

  it("reports page-canvas-invalid for an invalid canvas", () => {
    const workspace: WorkspaceSnapshot = {
      ...emptyWorkspace(),
      entities: [app("app-a")],
      pages: [canvasPage("page-1", [{ id: "app-a", rect: { x: 0, y: 0, width: 0, height: 3333 } }])],
    };

    expect(validateWorkspace(workspace)).toContainEqual({
      type: "page-canvas-invalid",
      pageId: "page-1",
      issue: { type: "invalid-rect", itemId: "app-a", problems: ["size-below-minimum"] },
    });
  });

  it("reports layout-entity-missing when a canvas item resolves to no entity", () => {
    const workspace: WorkspaceSnapshot = {
      ...emptyWorkspace(),
      pages: [canvasPage("page-1", [{ id: "ghost", rect: CELL_0_0 }])],
    };

    expect(validateWorkspace(workspace)).toContainEqual({
      type: "layout-entity-missing",
      pageId: "page-1",
      entityId: "ghost",
    });
  });

  it("reports entity-multiple-containers when one entity sits on two canvas pages", () => {
    const workspace: WorkspaceSnapshot = {
      ...emptyWorkspace(),
      entities: [app("app-a")],
      pages: [
        canvasPage("page-1", [{ id: "app-a", rect: CELL_0_0 }]),
        canvasPage("page-2", [{ id: "app-a", rect: CELL_1_1 }]),
      ],
    };

    expect(validateWorkspace(workspace)).toContainEqual({
      type: "entity-multiple-containers",
      entityId: "app-a",
    });
  });
});

describe("decoding round-trip", () => {
  it("re-decodes a serialized legacy workspace and still validates clean", () => {
    const workspace = legacyWorkspace([
      { id: "app-a", position: { column: 1, row: 1 }, span: { columns: 2, rows: 2 } },
    ]);

    const decoded = decodeWorkspaceSnapshot(JSON.parse(JSON.stringify(workspace)));

    expect(decoded).toBeDefined();
    expect(decoded?.pages[0]?.canvas).toBeUndefined();
    expect(pageItemIds(decoded!.pages[0]!)).toEqual(["app-a"]);
    expect(validateWorkspace(decoded!)).toEqual([]);
  });

  it("re-decodes a serialized canvas workspace and still validates clean", () => {
    const workspace = canvasWorkspaceWithApp();

    const decoded = decodeWorkspaceSnapshot(JSON.parse(JSON.stringify(workspace)));

    expect(decoded).toBeDefined();
    expect(decoded?.pages[0]?.canvas?.items.map((item) => item.id)).toEqual(["app-a"]);
    expect(validateWorkspace(decoded!)).toEqual([]);
  });
});

describe("replacePageCanvas", () => {
  it("rejects an unknown page and an invalid canvas", () => {
    const workspace = canvasWorkspaceWithApp();

    expect(
      replacePageCanvas(workspace, "page-x", { version: 1, mode: "snap", items: [] }),
    ).toEqual({ ok: false, reason: "page-not-found" });
    expect(
      replacePageCanvas(workspace, "page-1", {
        version: 1,
        mode: "snap",
        items: [{ id: "app-a", rect: { x: 0, y: 0, width: 0, height: 3333 } }],
      }),
    ).toEqual({ ok: false, reason: "invalid-page-layout" });
  });

  it("rejects a canvas that drops or adds an id", () => {
    const workspace = canvasWorkspaceWithApp();

    expect(
      replacePageCanvas(workspace, "page-1", { version: 1, mode: "snap", items: [] }),
    ).toEqual({ ok: false, reason: "invalid-page-layout" });
    expect(
      replacePageCanvas(workspace, "page-1", {
        version: 1,
        mode: "snap",
        items: [
          { id: "app-a", rect: CELL_0_0 },
          { id: "app-b", rect: CELL_1_1 },
        ],
      }),
    ).toEqual({ ok: false, reason: "invalid-page-layout" });
  });

  it("materializes a legacy page, stores the canvas and empties layout.items", () => {
    const workspace = legacyWorkspace([
      { id: "app-a", position: { column: 1, row: 1 }, span: { columns: 1, rows: 1 } },
    ]);
    const source = workspace.pages[0]!;
    const next: CanvasLayout = {
      version: 1,
      mode: "freeform",
      items: [{ id: "app-a", rect: { x: 1000, y: 1500, width: 4000, height: 3000 } }],
    };

    const result = replacePageCanvas(workspace, "page-1", next);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const updated = result.workspace.pages[0]!;
    expect(updated.canvas).toEqual(next);
    expect(updated.layout.items).toEqual([]);
    expect(updated.layout.grid).toEqual(source.layout.grid);
    expect(validateWorkspace(result.workspace)).toEqual([]);
    // The input is untouched.
    expect(source.canvas).toBeUndefined();
    expect(source.layout.items).toHaveLength(1);
  });

  it("replaces the canvas of a canvas page and keeps every other field by reference", () => {
    const workspace = canvasWorkspaceWithApp();
    const before = JSON.parse(JSON.stringify(workspace));
    const next: CanvasLayout = {
      version: 1,
      mode: "snap",
      items: [{ id: "app-a", rect: { x: 2000, y: 2000, width: 2000, height: 2000 } }],
    };

    const result = replacePageCanvas(workspace, "page-1", next);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.pages[0]?.canvas).toEqual(next);
    expect(result.workspace.pages[0]?.layout.items).toEqual([]);
    expect(result.workspace.entities).toBe(workspace.entities);
    expect(result.workspace.dock).toBe(workspace.dock);
    expect(result.workspace.preferences).toBe(workspace.preferences);
    expect(validateWorkspace(result.workspace)).toEqual([]);
    // Never mutates the input snapshot.
    expect(JSON.parse(JSON.stringify(workspace))).toEqual(before);
  });
});
