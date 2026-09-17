import { describe, expect, it } from "vitest";

import { validateWorkspace } from "./validation";
import { createEmptyWorkspace } from "./workspace";
import type {
  AppShortcut,
  Folder,
  WidgetInstance,
  WorkspaceEntity,
  WorkspaceSnapshot,
} from "./types";

/**
 * Shared fixture: a fully valid workspace exercising every entity kind.
 * - folder-1 sits on page-1 and contains app-1
 * - widget-1 sits on page-1
 * - app-1 is docked (folder + dock is legal) and categorised
 * - app-2 is unplaced and lives only in the App Library
 */
function buildValidWorkspace(): WorkspaceSnapshot {
  const empty = createEmptyWorkspace({
    workspaceId: "workspace-1",
    workspaceName: "My Desk",
    pageId: "page-1",
    pageName: "Home",
    grid: { columns: 12, rows: 8 },
  });

  const appInFolder: AppShortcut = {
    kind: "app",
    id: "app-1",
    name: "Wiki",
    url: "https://wiki.example.com",
    icon: { kind: "favicon" },
    openMode: "new-tab",
    categoryId: "category-1",
    tags: ["docs"],
  };

  const unplacedApp: AppShortcut = {
    kind: "app",
    id: "app-2",
    name: "Plex",
    url: "http://plex.local:32400",
    icon: { kind: "generated", text: "PX" },
    openMode: "new-tab",
    tags: [],
  };

  const folder: Folder = {
    kind: "folder",
    id: "folder-1",
    name: "Games",
    children: ["app-1"],
  };

  const widget: WidgetInstance = {
    kind: "widget",
    id: "widget-1",
    widgetType: "builtin.clock",
    config: { timezone: "UTC" },
  };

  const entities: readonly WorkspaceEntity[] = [appInFolder, unplacedApp, folder, widget];

  return {
    ...empty,
    pages: [
      {
        id: "page-1",
        name: "Home",
        layout: {
          id: "page-1",
          grid: { columns: 12, rows: 8 },
          items: [
            { id: "folder-1", position: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } },
            { id: "widget-1", position: { column: 2, row: 0 }, span: { columns: 2, rows: 1 } },
          ],
        },
      },
    ],
    entities,
    categories: [{ id: "category-1", name: "Reading" }],
    dock: { items: ["app-1", "folder-1"] },
  };
}

describe("validateWorkspace: valid snapshots", () => {
  it("accepts an empty workspace from the factory", () => {
    const workspace = createEmptyWorkspace({
      workspaceId: "workspace-1",
      workspaceName: "My Desk",
      pageId: "page-1",
      pageName: "Home",
      grid: { columns: 12, rows: 8 },
    });

    expect(validateWorkspace(workspace)).toEqual([]);
  });

  it("accepts a rich workspace with folder, widget, dock pins and category", () => {
    expect(validateWorkspace(buildValidWorkspace())).toEqual([]);
  });

  it("accepts an unplaced app that exists only in the library", () => {
    const workspace = buildValidWorkspace();

    expect(validateWorkspace(workspace).map((issue) => issue.type)).not.toContain(
      "entity-multiple-containers",
    );
  });
});

describe("validateWorkspace: workspace and identity scalars", () => {
  it("reports a whitespace-only workspace name", () => {
    const workspace = { ...buildValidWorkspace(), name: "   " };

    expect(validateWorkspace(workspace)).toEqual([{ type: "invalid-workspace-name" }]);
  });

  it("reports duplicate page ids", () => {
    const base = buildValidWorkspace();
    const duplicated = { ...base.pages[0]!, id: "page-1", name: "Copy" };
    const workspace = { ...base, pages: [...base.pages, duplicated] };

    expect(validateWorkspace(workspace)).toContainEqual({
      type: "duplicate-page-id",
      pageId: "page-1",
    });
  });

  it("reports duplicate entity ids across kinds", () => {
    const base = buildValidWorkspace();
    const folderWithStolenId: Folder = { kind: "folder", id: "app-1", name: "Clone", children: [] };
    const workspace = { ...base, entities: [...base.entities, folderWithStolenId] };

    expect(validateWorkspace(workspace)).toContainEqual({
      type: "duplicate-entity-id",
      entityId: "app-1",
    });
  });

  it("reports duplicate category ids", () => {
    const base = buildValidWorkspace();
    const workspace = {
      ...base,
      categories: [...base.categories, { id: "category-1", name: "Again" }],
    };

    expect(validateWorkspace(workspace)).toContainEqual({
      type: "duplicate-category-id",
      categoryId: "category-1",
    });
  });
});

describe("validateWorkspace: names and entity scalars", () => {
  it("reports an empty page name", () => {
    const base = buildValidWorkspace();
    const workspace = {
      ...base,
      pages: [{ ...base.pages[0]!, name: "  " }],
    };

    expect(validateWorkspace(workspace)).toEqual([{ type: "invalid-page-name", pageId: "page-1" }]);
  });

  it("reports an empty app name", () => {
    const base = buildValidWorkspace();
    const workspace = {
      ...base,
      entities: base.entities.map((entity) =>
        entity.kind === "app" && entity.id === "app-1" ? { ...entity, name: " " } : entity,
      ),
    };

    expect(validateWorkspace(workspace)).toEqual([
      { type: "invalid-entity-name", entityId: "app-1" },
    ]);
  });

  it("reports an empty folder name", () => {
    const base = buildValidWorkspace();
    const workspace = {
      ...base,
      entities: base.entities.map((entity) =>
        entity.kind === "folder" ? { ...entity, name: "" } : entity,
      ),
    };

    expect(validateWorkspace(workspace)).toEqual([
      { type: "invalid-entity-name", entityId: "folder-1" },
    ]);
  });

  it("allows a widget without a title", () => {
    const base = buildValidWorkspace();
    const workspace = {
      ...base,
      entities: base.entities.map((entity) =>
        entity.kind === "widget" ? { ...entity, title: "" } : entity,
      ),
    };

    expect(validateWorkspace(workspace)).toEqual([]);
  });

  it("reports an empty category name", () => {
    const base = buildValidWorkspace();
    const workspace = {
      ...base,
      categories: [{ id: "category-1", name: "" }],
    };

    expect(validateWorkspace(workspace)).toEqual([
      { type: "invalid-category-name", categoryId: "category-1" },
    ]);
  });

  it("reports a whitespace-only app url", () => {
    const base = buildValidWorkspace();
    const workspace = {
      ...base,
      entities: base.entities.map((entity) =>
        entity.kind === "app" && entity.id === "app-1" ? { ...entity, url: "   " } : entity,
      ),
    };

    expect(validateWorkspace(workspace)).toEqual([{ type: "invalid-app-url", appId: "app-1" }]);
  });

  it("accepts custom protocol urls like obsidian:// without whitelisting", () => {
    const base = buildValidWorkspace();
    const workspace = {
      ...base,
      entities: base.entities.map((entity) =>
        entity.kind === "app" && entity.id === "app-1"
          ? { ...entity, url: "obsidian://open?vault=Notes" }
          : entity,
      ),
    };

    expect(validateWorkspace(workspace)).toEqual([]);
  });

  it("accepts steam protocol urls", () => {
    const base = buildValidWorkspace();
    const workspace = {
      ...base,
      entities: base.entities.map((entity) =>
        entity.kind === "app" && entity.id === "app-1" ? { ...entity, url: "steam://run/123" } : entity,
      ),
    };

    expect(validateWorkspace(workspace)).toEqual([]);
  });

  it("reports a whitespace-only widget type", () => {
    const base = buildValidWorkspace();
    const workspace = {
      ...base,
      entities: base.entities.map((entity) =>
        entity.kind === "widget" ? { ...entity, widgetType: " " } : entity,
      ),
    };

    expect(validateWorkspace(workspace)).toEqual([
      { type: "invalid-widget-type", widgetId: "widget-1" },
    ]);
  });
});

describe("validateWorkspace: purity", () => {
  it("does not mutate the workspace while reporting issues", () => {
    const base = buildValidWorkspace();
    const workspace: WorkspaceSnapshot = {
      ...base,
      name: "  ",
      pages: [
        ...base.pages,
        { id: "page-1", name: "Copy", layout: { ...base.pages[0]!.layout } },
      ],
      dock: { items: ["app-1", "app-1"] },
    };
    const before = structuredClone(workspace);

    validateWorkspace(workspace);

    expect(workspace).toEqual(before);
  });
});

describe("validateWorkspace: page layout delegation", () => {
  it("reports a layout id that does not match its page id", () => {
    const base = buildValidWorkspace();
    const workspace = {
      ...base,
      pages: [{ ...base.pages[0]!, layout: { ...base.pages[0]!.layout, id: "other-id" } }],
    };

    expect(validateWorkspace(workspace)).toEqual([
      { type: "page-layout-id-mismatch", pageId: "page-1", layoutId: "other-id" },
    ]);
  });

  it("wraps engine overlap issues as page-layout-invalid", () => {
    const base = buildValidWorkspace();
    const page = base.pages[0]!;
    const workspace = {
      ...base,
      pages: [
        {
          ...page,
          layout: {
            ...page.layout,
            items: [
              ...page.layout.items,
              { id: "app-2", position: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } },
            ],
          },
        },
      ],
    };

    expect(validateWorkspace(workspace)).toContainEqual({
      type: "page-layout-invalid",
      pageId: "page-1",
      issue: { type: "overlap", itemIds: ["folder-1", "app-2"] },
    });
  });

  it("wraps engine out-of-bounds issues as page-layout-invalid", () => {
    const base = buildValidWorkspace();
    const page = base.pages[0]!;
    const workspace = {
      ...base,
      pages: [
        {
          ...page,
          layout: {
            ...page.layout,
            items: [
              ...page.layout.items,
              { id: "app-2", position: { column: 12, row: 7 }, span: { columns: 1, rows: 1 } },
            ],
          },
        },
      ],
    };

    expect(validateWorkspace(workspace)).toContainEqual({
      type: "page-layout-invalid",
      pageId: "page-1",
      issue: { type: "out-of-bounds", itemId: "app-2" },
    });
  });

  it("reports layout items referencing unknown entities", () => {
    const base = buildValidWorkspace();
    const page = base.pages[0]!;
    const workspace = {
      ...base,
      pages: [
        {
          ...page,
          layout: {
            ...page.layout,
            items: [
              ...page.layout.items,
              { id: "ghost", position: { column: 5, row: 5 }, span: { columns: 1, rows: 1 } },
            ],
          },
        },
      ],
    };

    expect(validateWorkspace(workspace)).toContainEqual({
      type: "layout-entity-missing",
      pageId: "page-1",
      entityId: "ghost",
    });
  });
});

describe("validateWorkspace: exclusive containers", () => {
  it("reports an entity placed on two pages", () => {
    const base = buildValidWorkspace();
    const secondPage = {
      id: "page-2",
      name: "Work",
      layout: {
        id: "page-2",
        grid: { columns: 12, rows: 8 },
        items: [{ id: "folder-1", position: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } }],
      },
    };
    const workspace = { ...base, pages: [...base.pages, secondPage] };

    expect(validateWorkspace(workspace)).toContainEqual({
      type: "entity-multiple-containers",
      entityId: "folder-1",
    });
  });

  it("reports an app placed on a page and inside a folder", () => {
    const base = buildValidWorkspace();
    const page = base.pages[0]!;
    const workspace = {
      ...base,
      pages: [
        {
          ...page,
          layout: {
            ...page.layout,
            items: [
              ...page.layout.items,
              { id: "app-1", position: { column: 6, row: 6 }, span: { columns: 1, rows: 1 } },
            ],
          },
        },
      ],
    };

    expect(validateWorkspace(workspace)).toContainEqual({
      type: "entity-multiple-containers",
      entityId: "app-1",
    });
  });

  it("reports an app inside two folders", () => {
    const base = buildValidWorkspace();
    const secondFolder: Folder = {
      kind: "folder",
      id: "folder-2",
      name: "Also Games",
      children: ["app-1"],
    };
    const workspace = { ...base, entities: [...base.entities, secondFolder] };

    expect(validateWorkspace(workspace)).toContainEqual({
      type: "entity-multiple-containers",
      entityId: "app-1",
    });
  });

  it("allows an app on a page and pinned to the dock", () => {
    const base = buildValidWorkspace();
    const page = base.pages[0]!;
    const workspace = {
      ...base,
      pages: [
        {
          ...page,
          layout: {
            ...page.layout,
            items: [
              ...page.layout.items,
              { id: "app-2", position: { column: 6, row: 6 }, span: { columns: 1, rows: 1 } },
            ],
          },
        },
      ],
      dock: { items: ["app-1", "app-2", "folder-1"] },
    };

    expect(validateWorkspace(workspace)).toEqual([]);
  });

  it("allows an app inside a folder and pinned to the dock", () => {
    const workspace = buildValidWorkspace();

    expect(validateWorkspace(workspace).map((issue) => issue.type)).toEqual([]);
  });
});

describe("validateWorkspace: folder children", () => {
  it("reports a child id that matches no entity", () => {
    const base = buildValidWorkspace();
    const workspace = {
      ...base,
      entities: base.entities.map((entity) =>
        entity.kind === "folder" ? { ...entity, children: ["missing-child"] } : entity,
      ),
    };

    expect(validateWorkspace(workspace)).toEqual([
      { type: "folder-child-missing", folderId: "folder-1", childId: "missing-child" },
    ]);
  });

  it("reports a widget as folder child", () => {
    const base = buildValidWorkspace();
    const folderOnlyLayout = {
      ...base.pages[0]!.layout,
      items: [{ id: "folder-1", position: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } }],
    };
    const workspace = {
      ...base,
      pages: [{ ...base.pages[0]!, layout: folderOnlyLayout }],
      entities: base.entities.map((entity) =>
        entity.kind === "folder" ? { ...entity, children: ["widget-1"] } : entity,
      ),
    };

    expect(validateWorkspace(workspace)).toEqual([
      { type: "folder-child-not-app", folderId: "folder-1", childId: "widget-1" },
    ]);
  });

  it("reports a nested folder as folder child", () => {
    const base = buildValidWorkspace();
    const inner: Folder = { kind: "folder", id: "folder-2", name: "Inner", children: [] };
    const workspace = {
      ...base,
      entities: [
        ...base.entities.map((entity) =>
          entity.kind === "folder" ? { ...entity, children: ["folder-2"] } : entity,
        ),
        inner,
      ],
    };

    expect(validateWorkspace(workspace)).toEqual([
      { type: "folder-child-not-app", folderId: "folder-1", childId: "folder-2" },
    ]);
  });

  it("reports a duplicated child inside one folder", () => {
    const base = buildValidWorkspace();
    const workspace = {
      ...base,
      entities: base.entities.map((entity) =>
        entity.kind === "folder" ? { ...entity, children: ["app-1", "app-1"] } : entity,
      ),
    };

    expect(validateWorkspace(workspace)).toEqual([
      { type: "folder-child-duplicate", folderId: "folder-1", childId: "app-1" },
    ]);
  });
});

describe("validateWorkspace: dock", () => {
  it("reports a docked id that matches no entity", () => {
    const workspace = { ...buildValidWorkspace(), dock: { items: ["ghost"] } };

    expect(validateWorkspace(workspace)).toEqual([{ type: "dock-entity-missing", entityId: "ghost" }]);
  });

  it("reports a docked widget", () => {
    const workspace = { ...buildValidWorkspace(), dock: { items: ["widget-1"] } };

    expect(validateWorkspace(workspace)).toEqual([
      { type: "dock-widget-not-allowed", entityId: "widget-1" },
    ]);
  });

  it("reports a duplicated dock entry", () => {
    const workspace = { ...buildValidWorkspace(), dock: { items: ["app-1", "app-1"] } };

    expect(validateWorkspace(workspace)).toEqual([
      { type: "dock-entity-duplicate", entityId: "app-1" },
    ]);
  });

  it("accepts a docked app and folder", () => {
    const workspace = buildValidWorkspace();

    expect(validateWorkspace(workspace).map((issue) => issue.type)).toEqual([]);
    expect(workspace.dock.items).toEqual(["app-1", "folder-1"]);
  });
});

describe("validateWorkspace: preferences and categories", () => {
  it("reports a default page that matches no page", () => {
    const base = buildValidWorkspace();
    const workspace = {
      ...base,
      preferences: { ...base.preferences, defaultPageId: "missing-page" },
    };

    expect(validateWorkspace(workspace)).toEqual([
      { type: "default-page-missing", pageId: "missing-page" },
    ]);
  });

  it("reports an app referencing a missing category", () => {
    const base = buildValidWorkspace();
    const workspace = { ...base, categories: [] };

    expect(validateWorkspace(workspace)).toEqual([
      { type: "app-category-missing", appId: "app-1", categoryId: "category-1" },
    ]);
  });
});

describe("validateWorkspace: deterministic multi-issue order", () => {
  it("reports groups in the documented order and arrays in source order", () => {
    const workspace: WorkspaceSnapshot = {
      id: "workspace-1",
      name: "  ",
      pages: [
        {
          id: "page-1",
          name: " ",
          layout: {
            id: "page-1",
            grid: { columns: 12, rows: 8 },
            items: [
              { id: "app-1", position: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } },
              { id: "ghost", position: { column: 4, row: 4 }, span: { columns: 1, rows: 1 } },
            ],
          },
        },
        {
          id: "page-1",
          name: "Copy",
          layout: { id: "wrong", grid: { columns: 12, rows: 8 }, items: [] },
        },
      ],
      entities: [
        {
          kind: "app",
          id: "app-1",
          name: " ",
          url: " ",
          icon: { kind: "favicon" },
          openMode: "new-tab",
          tags: [],
        },
        { kind: "folder", id: "folder-1", name: "Games", children: ["app-1"] },
      ],
      categories: [
        { id: "category-1", name: "" },
        { id: "category-1", name: "Dup" },
      ],
      dock: { items: ["app-1", "app-1", "widget-1"] },
      preferences: { defaultPageId: "page-9", layoutLocked: true },
    };

    expect(validateWorkspace(workspace)).toEqual([
      // 1. workspace scalar
      { type: "invalid-workspace-name" },
      // 2. page identity/name/layout — original page first, then the copy
      { type: "invalid-page-name", pageId: "page-1" },
      { type: "duplicate-page-id", pageId: "page-1" },
      { type: "page-layout-id-mismatch", pageId: "page-1", layoutId: "wrong" },
      // 3. entity identity/name/scalars in array order
      { type: "invalid-entity-name", entityId: "app-1" },
      { type: "invalid-app-url", appId: "app-1" },
      // 4. category identity/name in array order
      { type: "invalid-category-name", categoryId: "category-1" },
      { type: "duplicate-category-id", categoryId: "category-1" },
      // 5. layout references in page/item order
      { type: "layout-entity-missing", pageId: "page-1", entityId: "ghost" },
      // 6. folder references — folder-1's only child resolves, is an app, no dup
      // 7. exclusive containers — app-1 sits on page-1 AND inside folder-1
      { type: "entity-multiple-containers", entityId: "app-1" },
      // 8. dock in array order
      { type: "dock-entity-duplicate", entityId: "app-1" },
      { type: "dock-entity-missing", entityId: "widget-1" },
      // 9. preferences/default page
      { type: "default-page-missing", pageId: "page-9" },
      // 10. app category references — app-1 has no categoryId
    ]);
  });
});
