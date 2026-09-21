import { describe, expect, it } from "vitest";

import type { CanvasLayout, CanvasRect } from "@veladesk/canvas-engine";
import type { GridDefinition, LayoutItem } from "@veladesk/desktop-engine";
import {
  DEFAULT_GRID_GAP_PX,
  addAppToPage,
  addFolderToPage,
  createEmptyWorkspace,
  decodeWorkspaceSnapshot,
  deleteApp,
  dissolveFolderToPage,
  isCanvasPage,
  isValidGridGapPx,
  materializePagePlacement,
  newCanvasItemRect,
  pageItemIds,
  placePageItem,
  relocateAppToPage,
  replacePageCanvas,
  replaceWorkspacePreferences,
  resolveGridGapPx,
  resolvePagePlacement,
  validateWorkspace,
} from "@veladesk/domain";
import type { AppShortcut, DesktopPage, Folder, WorkspaceSnapshot } from "@veladesk/domain";

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

function folder(id: string, children: readonly string[] = []): Folder {
  return { kind: "folder", id, name: id, children };
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
  mode: "snap" | "freeform" = "snap",
  grid: GridDefinition = GRID,
): DesktopPage {
  return {
    id,
    name: id,
    layout: { id, grid, items: [] },
    canvas: { version: 1, mode, items },
  };
}

function gridPage(
  id: string,
  items: readonly { readonly id: string; readonly column: number; readonly row: number; readonly columnSpan?: number; readonly rowSpan?: number }[],
  columns = 3,
  grid: GridDefinition = GRID,
): DesktopPage {
  return {
    id,
    name: id,
    layout: { id, grid, items: [] },
    canvas: {
      version: 2,
      mode: "grid",
      columns,
      items: items.map((item) => ({
        id: item.id,
        column: item.column,
        row: item.row,
        columnSpan: item.columnSpan ?? 1,
        rowSpan: item.rowSpan ?? 1,
      })),
    },
  };
}

function freeformPage(
  id: string,
  items: readonly { readonly id: string; readonly rect: CanvasRect }[],
  grid: GridDefinition = GRID,
): DesktopPage {
  return {
    id,
    name: id,
    layout: { id, grid, items: [] },
    canvas: { version: 2, mode: "freeform", items },
  };
}

function workspaceWith(
  pages: readonly DesktopPage[],
  entities: readonly (AppShortcut | Folder)[] = [],
): WorkspaceSnapshot {
  const base = emptyWorkspace();
  return { ...base, pages, entities };
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

  it("validates a v2 grid-native workspace clean", () => {
    const workspace = createEmptyWorkspace({
      workspaceId: "workspace-1",
      workspaceName: "Desk",
      pageId: "page-1",
      pageName: "Home",
      grid: GRID,
    });

    expect(workspace.pages[0]?.canvas).toEqual({ version: 2, mode: "grid", columns: 3, items: [] });
    expect(validateWorkspace(workspace)).toEqual([]);
  });

  it("validates v2 grid and freeform pages with content", () => {
    const workspace = workspaceWith(
      [
        gridPage("page-1", [
          { id: "app-a", column: 0, row: 0 },
          { id: "app-b", column: 2, row: 7, columnSpan: 1, rowSpan: 3 },
        ]),
        freeformPage("page-2", [{ id: "app-c", rect: { x: 137, y: 991, width: 2000, height: 1500 } }]),
      ],
      [app("app-a"), app("app-b"), app("app-c")],
    );
    expect(validateWorkspace(workspace)).toEqual([]);
  });

  it("reports a grid item past the columns", () => {
    const workspace = workspaceWith(
      [gridPage("page-1", [{ id: "app-a", column: 2, row: 0, columnSpan: 2 }])],
      [app("app-a")],
    );
    expect(validateWorkspace(workspace)).toContainEqual({
      type: "page-canvas-invalid",
      pageId: "page-1",
      issue: { type: "invalid-grid-item", itemId: "app-a", problems: ["exceeds-columns"] },
    });
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

  it("works identically for v1, v2 grid and v2 freeform canvases", () => {
    expect(pageItemIds(canvasPage("p", [{ id: "a", rect: CELL_0_0 }]))).toEqual(["a"]);
    expect(pageItemIds(gridPage("p", [{ id: "a", column: 0, row: 0 }, { id: "b", column: 1, row: 2 }]))).toEqual(["a", "b"]);
    expect(pageItemIds(freeformPage("p", [{ id: "a", rect: CELL_0_0 }]))).toEqual(["a"]);
  });
});

describe("resolvePagePlacement — the canonical resolver", () => {
  it("derives legacy grid geometry exactly from GridPosition/GridSpan", () => {
    const page: DesktopPage = {
      id: "page-1",
      name: "Home",
      layout: {
        id: "page-1",
        grid: GRID,
        items: [
          { id: "app-a", position: { column: 1, row: 2 }, span: { columns: 2, rows: 1 } },
        ],
      },
    };
    const before = JSON.parse(JSON.stringify(page));

    const placement = resolvePagePlacement(page);

    expect(placement).toEqual({
      version: 2,
      mode: "grid",
      columns: 3,
      items: [{ id: "app-a", column: 1, row: 2, columnSpan: 2, rowSpan: 1 }],
    });
    // Pure derivation: nothing is written back to the page.
    expect(page.canvas).toBeUndefined();
    expect(JSON.parse(JSON.stringify(page))).toEqual(before);
  });

  it("lazily converts a v1 snap canvas to v2 grid through the lattice", () => {
    const page = canvasPage(
      "page-1",
      [
        // Half of the second cell on both axes → cell (1,1), span 1x1.
        { id: "app-a", rect: { x: 3500, y: 3500, width: 1600, height: 1600 } },
        // Nearly two cells wide → span 2.
        { id: "app-b", rect: { x: 0, y: 3333, width: 6600, height: 3300 } },
      ],
      "snap",
      { columns: 3, rows: 3 },
    );

    expect(resolvePagePlacement(page)).toEqual({
      version: 2,
      mode: "grid",
      columns: 3,
      items: [
        { id: "app-a", column: 1, row: 1, columnSpan: 1, rowSpan: 1 },
        { id: "app-b", column: 0, row: 1, columnSpan: 2, rowSpan: 1 },
      ],
    });
  });

  it("keeps v1 freeform rects unchanged in the derived v2 freeform", () => {
    const page = canvasPage(
      "page-1",
      [{ id: "app-a", rect: { x: 137, y: 991, width: 1234, height: 567 } }],
      "freeform",
    );
    expect(resolvePagePlacement(page)).toEqual({
      version: 2,
      mode: "freeform",
      items: [{ id: "app-a", rect: { x: 137, y: 991, width: 1234, height: 567 } }],
    });
  });

  it("uses stored v2 placements directly (identity)", () => {
    const grid = gridPage("p", [{ id: "a", column: 0, row: 4, columnSpan: 3, rowSpan: 2 }]);
    expect(resolvePagePlacement(grid)).toBe(grid.canvas);
    const freeform = freeformPage("p", [{ id: "a", rect: CELL_1_1 }]);
    expect(resolvePagePlacement(freeform)).toBe(freeform.canvas);
  });
});

describe("materializePagePlacement", () => {
  it("freezes legacy geometry into a stored v2 grid and empties legacy items", () => {
    const legacy = legacyWorkspace([
      { id: "app-a", position: { column: 2, row: 1 }, span: { columns: 1, rows: 2 } },
    ]);
    const page = legacy.pages[0]!;
    const derived = resolvePagePlacement(page);

    const materialized = materializePagePlacement(page);

    // The frozen placement renders exactly what the virtual one did before.
    expect(materialized.canvas).toEqual(derived);
    expect(pageItemIds(materialized)).toEqual(["app-a"]);
    expect(materialized.layout.items).toEqual([]);
    expect(materialized.layout.grid).toEqual(page.layout.grid);
    // The source page is left untouched.
    expect(page.canvas).toBeUndefined();
    expect(page.layout.items).toHaveLength(1);

    // A page that already carries a v2 canvas keeps its exact reference
    // (identity, not a re-derivation).
    const again = materializePagePlacement(materialized);
    expect(isCanvasPage(again)).toBe(true);
    expect(again.canvas).toBe(materialized.canvas);
    expect(again.layout).toBe(materialized.layout);
  });

  it("materializes a v1 snap page to v2 grid without membership loss", () => {
    const page = canvasPage(
      "page-1",
      [{ id: "app-a", rect: CELL_1_1 }, { id: "app-b", rect: CELL_2_2 }],
      "snap",
    );
    const materialized = materializePagePlacement(page);
    expect(materialized.canvas.version).toBe(2);
    expect(materialized.canvas.mode).toBe("grid");
    expect(pageItemIds(materialized)).toEqual(["app-a", "app-b"]);
  });
});

describe("newCanvasItemRect — freeform cascade", () => {
  it("cascades by an eighth of a cell and clamps at the canvas edge", () => {
    // Cell width 3333 → step round(3333/8) = 417.
    expect(newCanvasItemRect({ grid: GRID, index: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 3333,
      height: 3333,
    });
    expect(newCanvasItemRect({ grid: GRID, index: 1 })).toEqual({
      x: 417,
      y: 417,
      width: 3333,
      height: 3333,
    });
    // 16 * 417 = 6672 exceeds 10000 - 3333 = 6667 and clamps.
    expect(newCanvasItemRect({ grid: GRID, index: 16 })).toEqual({
      x: 6667,
      y: 6667,
      width: 3333,
      height: 3333,
    });
    // An anchor offsets the cascade origin.
    expect(
      newCanvasItemRect({ grid: GRID, index: 0, anchor: { x: 1000, y: 2000, width: 1, height: 1 } }),
    ).toEqual({ x: 1000, y: 2000, width: 3333, height: 3333 });
  });
});

describe("placePageItem", () => {
  it("places grid items at the first free row-major location and materializes v2", () => {
    const occupied = gridPage("page-1", [
      { id: "existing-a", column: 0, row: 0 },
      { id: "existing-b", column: 1, row: 0 },
      { id: "existing-c", column: 2, row: 0 },
    ]);
    const placed = placePageItem(occupied, "app-a", { index: 0 });
    expect(placed.canvas).toEqual({
      version: 2,
      mode: "grid",
      columns: 3,
      items: [
        ...(occupied.canvas?.items ?? []),
        { id: "app-a", column: 0, row: 1, columnSpan: 1, rowSpan: 1 },
      ],
    });
    expect(placed.layout.items).toEqual([]);
  });

  it("never fails for space on grid pages — rows are unbounded", () => {
    const full = gridPage(
      "page-1",
      Array.from({ length: 30 }, (_, index) => ({
        id: `c${index}`,
        column: index % 3,
        row: Math.floor(index / 3),
      })),
    );
    const placed = placePageItem(full, "app-a", { index: 0 });
    const last = placed.canvas.items.at(-1);
    expect(last).toMatchObject({ id: "app-a", column: 0, row: 10 });
  });

  it("clamps a preserved span into the target columns", () => {
    const target = gridPage("page-1", [], 3);
    const placed = placePageItem(target, "app-a", {
      index: 0,
      span: { columnSpan: 9, rowSpan: 2 },
    });
    expect(placed.canvas.items[0]).toMatchObject({ columnSpan: 3, rowSpan: 2 });
  });

  it("preserves and clamps a freeform size", () => {
    const freeform = freeformPage("page-1", []);
    const placed = placePageItem(freeform, "app-d", {
      index: 16,
      size: { width: 5000, height: 5000 },
    });
    const item = placed.canvas.items[0];
    if (item === undefined || !("rect" in item)) throw new Error("expected rect item");
    expect(item.rect).toEqual({ x: 5000, y: 5000, width: 5000, height: 5000 });

    const oversized = placePageItem(freeform, "app-b", {
      index: 0,
      size: { width: 99999, height: 1 },
    });
    const oversizedItem = oversized.canvas.items[0];
    if (oversizedItem === undefined || !("rect" in oversizedItem)) throw new Error("expected rect item");
    expect(oversizedItem.rect).toEqual({ x: 0, y: 0, width: 10000, height: 1 });

    const degenerate = placePageItem(freeform, "app-c", {
      index: 0,
      size: { width: 0, height: -5 },
    });
    const degenerateItem = degenerate.canvas.items[0];
    if (degenerateItem === undefined || !("rect" in degenerateItem)) throw new Error("expected rect item");
    expect(degenerateItem.rect).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("uses an anchor cell for grid dissolves", () => {
    const page = gridPage("page-1", [
      { id: "f", column: 2, row: 2 },
      { id: "other", column: 2, row: 3 },
    ]);
    const first = placePageItem(page, "child-1", {
      index: 0,
      anchorCell: { column: 2, row: 2 },
    });
    // The anchor cell itself is occupied by the folder shell's neighbours —
    // child-1 lands at the first free spot scanning from the anchor.
    const placed = first.canvas.items.at(-1);
    expect(placed).toMatchObject({ id: "child-1", column: 0, row: 3 });
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

  it("re-decodes a serialized v1 canvas workspace and still validates clean", () => {
    const workspace: WorkspaceSnapshot = {
      ...emptyWorkspace(),
      entities: [app("app-a")],
      pages: [canvasPage("page-1", [{ id: "app-a", rect: CELL_0_0 }], "freeform")],
    };

    const decoded = decodeWorkspaceSnapshot(JSON.parse(JSON.stringify(workspace)));

    expect(decoded).toBeDefined();
    expect(decoded?.pages[0]?.canvas?.version).toBe(1);
    expect(validateWorkspace(decoded!)).toEqual([]);
  });

  it("re-decodes serialized v2 grid and freeform workspaces", () => {
    const gridWorkspace = workspaceWith(
      [gridPage("page-1", [{ id: "app-a", column: 0, row: 0, columnSpan: 2, rowSpan: 2 }])],
      [app("app-a")],
    );
    const gridDecoded = decodeWorkspaceSnapshot(JSON.parse(JSON.stringify(gridWorkspace)));
    expect(gridDecoded?.pages[0]?.canvas).toEqual(gridWorkspace.pages[0]?.canvas);
    expect(validateWorkspace(gridDecoded!)).toEqual([]);

    const freeformWorkspace = workspaceWith(
      [freeformPage("page-1", [{ id: "app-a", rect: CELL_0_0 }])],
      [app("app-a")],
    );
    const freeformDecoded = decodeWorkspaceSnapshot(JSON.parse(JSON.stringify(freeformWorkspace)));
    expect(freeformDecoded?.pages[0]?.canvas).toEqual(freeformWorkspace.pages[0]?.canvas);
    expect(validateWorkspace(freeformDecoded!)).toEqual([]);
  });

  it("rejects a structurally broken v2 grid canvas", () => {
    const broken = JSON.parse(
      JSON.stringify(
        workspaceWith([gridPage("page-1", [{ id: "app-a", column: 0, row: 0 }])], [app("app-a")]),
      ),
    );
    broken.pages[0].canvas.items[0].columnSpan = "two";
    expect(decodeWorkspaceSnapshot(broken)).toBeUndefined();

    const noColumns = JSON.parse(
      JSON.stringify(
        workspaceWith([gridPage("page-1", [{ id: "app-a", column: 0, row: 0 }])], [app("app-a")]),
      ),
    );
    delete noColumns.pages[0].canvas.columns;
    expect(decodeWorkspaceSnapshot(noColumns)).toBeUndefined();
  });
});

describe("replacePageCanvas", () => {
  it("rejects an unknown page and an invalid canvas", () => {
    const workspace = canvasWorkspaceWithApp();

    expect(
      replacePageCanvas(workspace, "page-x", { version: 2, mode: "grid", columns: 3, items: [] }),
    ).toEqual({ ok: false, reason: "page-not-found" });
    expect(
      replacePageCanvas(workspace, "page-1", {
        version: 2,
        mode: "grid",
        columns: 3,
        items: [{ id: "app-a", column: 3, row: 0, columnSpan: 1, rowSpan: 1 }],
      }),
    ).toEqual({ ok: false, reason: "invalid-page-layout" });
  });

  it("rejects a canvas that drops or adds an id", () => {
    const workspace = canvasWorkspaceWithApp();

    expect(
      replacePageCanvas(workspace, "page-1", { version: 2, mode: "grid", columns: 3, items: [] }),
    ).toEqual({ ok: false, reason: "invalid-page-layout" });
    expect(
      replacePageCanvas(workspace, "page-1", {
        version: 2,
        mode: "grid",
        columns: 3,
        items: [
          { id: "app-a", column: 0, row: 0, columnSpan: 1, rowSpan: 1 },
          { id: "app-b", column: 1, row: 0, columnSpan: 1, rowSpan: 1 },
        ],
      }),
    ).toEqual({ ok: false, reason: "invalid-page-layout" });
  });

  it("materializes a legacy page into v2 and empties layout.items", () => {
    const workspace = legacyWorkspace([
      { id: "app-a", position: { column: 1, row: 1 }, span: { columns: 1, rows: 1 } },
    ]);
    const source = workspace.pages[0]!;
    const next: CanvasLayout = {
      version: 2,
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
      version: 2,
      mode: "grid",
      columns: 3,
      items: [{ id: "app-a", column: 1, row: 1, columnSpan: 1, rowSpan: 1 }],
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

describe("editing ops with Grid v2 pages", () => {
  function gridWorkspace(): WorkspaceSnapshot {
    return workspaceWith(
      [
        gridPage("page-1", [
          { id: "app-a", column: 0, row: 0 },
          { id: "app-b", column: 1, row: 0 },
        ]),
        gridPage("page-2", []),
      ],
      [app("app-a"), app("app-b")],
    );
  }

  it("adds an app at the first free row-major location", () => {
    const result = addAppToPage(gridWorkspace(), "page-1", app("app-new"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = result.workspace.pages[0]?.canvas?.items ?? [];
    expect(items.at(-1)).toMatchObject({ id: "app-new", column: 2, row: 0 });
  });

  it("adds a folder like an app", () => {
    const result = addFolderToPage(gridWorkspace(), "page-2", folder("folder-x"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = result.workspace.pages[1]?.canvas?.items ?? [];
    expect(items).toEqual([{ id: "folder-x", column: 0, row: 0, columnSpan: 1, rowSpan: 1 }]);
  });

  it("deletes an app from a grid page", () => {
    const result = deleteApp(gridWorkspace(), "app-a");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pageItemIds(result.workspace.pages[0]!)).toEqual(["app-b"]);
  });

  it("dissolves a grid folder around its shell cell", () => {
    const workspace = workspaceWith(
      [
        gridPage("page-1", [
          { id: "app-a", column: 0, row: 0 },
          { id: "f", column: 1, row: 0 },
          { id: "app-b", column: 2, row: 0 },
        ]),
      ],
      [app("app-a"), app("app-b"), folder("f", ["app-c"])],
    );
    // app-c lives inside the folder, not on the page.
    const withChild = { ...workspace, entities: [...workspace.entities, app("app-c")] };

    const result = dissolveFolderToPage(withChild, "f", "page-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = result.workspace.pages[0]?.canvas?.items ?? [];
    // The folder shell is gone; app-c takes the first free spot scanning
    // from the shell's cell — the vacated cell itself.
    expect(items.map((item) => item.id)).toEqual(["app-a", "app-b", "app-c"]);
    expect(items.at(-1)).toMatchObject({ column: 1, row: 0 });
  });

  it("relocates between grid pages preserving the span, clamped", () => {
    const workspace = workspaceWith(
      [
        gridPage("page-1", [{ id: "app-a", column: 0, row: 0, columnSpan: 2, rowSpan: 2 }]),
        gridPage("page-2", [], 3),
      ],
      [app("app-a")],
    );
    const result = relocateAppToPage(workspace, "app-a", "page-2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = result.workspace.pages[1]?.canvas?.items?.[0];
    expect(item).toMatchObject({ id: "app-a", columnSpan: 2, rowSpan: 2 });
  });

  it("no-space is unreachable for grid creation", () => {
    // Fill page-1 completely; adding still succeeds on a new row.
    const items = Array.from({ length: 9 }, (_, index) => ({
      id: `fill-${index}`,
      column: index % 3,
      row: Math.floor(index / 3),
    }));
    const workspace = workspaceWith(
      [gridPage("page-1", items)],
      items.map((item) => app(item.id)),
    );
    const result = addAppToPage(workspace, "page-1", app("app-new"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.pages[0]?.canvas?.items?.at(-1)).toMatchObject({
      id: "app-new",
      column: 0,
      row: 3,
    });
  });
});

describe("gridGapPx preference", () => {
  it("defaults to 16 for legacy snapshots and reads valid values", () => {
    const legacy = emptyWorkspace();
    expect(legacy.preferences.gridGapPx).toBeUndefined();
    expect(resolveGridGapPx(legacy.preferences)).toBe(DEFAULT_GRID_GAP_PX);
    expect(DEFAULT_GRID_GAP_PX).toBe(16);

    expect(resolveGridGapPx({ ...legacy.preferences, gridGapPx: 0 })).toBe(0);
    expect(resolveGridGapPx({ ...legacy.preferences, gridGapPx: 32 })).toBe(32);
    // Out-of-range values resolve to the default (validation reports them).
    expect(resolveGridGapPx({ ...legacy.preferences, gridGapPx: 33 })).toBe(16);
  });

  it("validates the integer 0..32 range", () => {
    expect(isValidGridGapPx(0)).toBe(true);
    expect(isValidGridGapPx(16)).toBe(true);
    expect(isValidGridGapPx(32)).toBe(true);
    expect(isValidGridGapPx(-1)).toBe(false);
    expect(isValidGridGapPx(33)).toBe(false);
    expect(isValidGridGapPx(8.5)).toBe(false);
  });

  it("persists through replaceWorkspacePreferences and reports invalid values", () => {
    const workspace = emptyWorkspace();
    const saved = replaceWorkspacePreferences(workspace, {
      ...workspace.preferences,
      gridGapPx: 24,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.workspace.preferences.gridGapPx).toBe(24);
    expect(resolveGridGapPx(saved.workspace.preferences)).toBe(24);
    expect(validateWorkspace(saved.workspace)).toEqual([]);

    const invalid = replaceWorkspacePreferences(workspace, {
      ...workspace.preferences,
      gridGapPx: 40,
    });
    expect(invalid).toEqual({ ok: false, reason: "invalid-grid-gap" });

    // A snapshot that carries an out-of-range gap directly is reported.
    const broken: WorkspaceSnapshot = {
      ...workspace,
      preferences: { ...workspace.preferences, gridGapPx: -2 },
    };
    expect(validateWorkspace(broken)).toContainEqual({ type: "invalid-grid-gap" });
  });
});
