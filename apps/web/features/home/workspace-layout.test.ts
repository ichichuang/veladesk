import { describe, expect, it } from "vitest";

import { createEmptyWorkspace, validateWorkspace } from "@veladesk/domain";
import type { AppShortcut, WorkspaceSnapshot } from "@veladesk/domain";
import type { PageLayout } from "@veladesk/desktop-engine";

import { addAppToPage, replacePageLayout } from "./workspace-layout";

function baseWorkspace(): WorkspaceSnapshot {
  return createEmptyWorkspace({
    workspaceId: "workspace-1",
    workspaceName: "Desk",
    pageId: "page-1",
    pageName: "Home",
    grid: { columns: 4, rows: 3 },
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

function layoutOf(workspace: WorkspaceSnapshot, pageId: string): PageLayout {
  const page = workspace.pages.find((candidate) => candidate.id === pageId);
  if (page === undefined) {
    throw new Error(`page ${pageId} missing in fixture`);
  }
  return page.layout;
}

describe("replacePageLayout", () => {
  it("replaces the target page layout and keeps everything else", () => {
    const workspace = baseWorkspace();
    const nextLayout: PageLayout = {
      id: "page-1",
      grid: { columns: 4, rows: 3 },
      items: [
        { id: "app-a", position: { column: 1, row: 0 }, span: { columns: 1, rows: 1 } },
      ],
    };

    const result = replacePageLayout(workspace, "page-1", nextLayout);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.workspace.pages).toHaveLength(1);
    expect(result.workspace.pages[0]?.layout.items[0]?.id).toBe("app-a");
    expect(result.workspace.id).toBe("workspace-1");
    expect(result.workspace.name).toBe("Desk");
    expect(result.workspace.preferences).toBe(workspace.preferences);
    expect(result.workspace.dock).toBe(workspace.dock);
  });

  it("fails with page-not-found for an unknown page and preserves order", () => {
    const workspace = baseWorkspace();
    const nextLayout: PageLayout = {
      id: "page-x",
      grid: { columns: 4, rows: 3 },
      items: [],
    };

    const result = replacePageLayout(workspace, "page-x", nextLayout);

    expect(result).toEqual({ ok: false, reason: "page-not-found" });
    // Whole input untouched.
    expect(workspace.pages).toHaveLength(1);
  });
});

describe("addAppToPage", () => {
  it("appends the entity and a matching layout item on an empty page", () => {
    const workspace = baseWorkspace();
    const entry = app("app-openai", "OpenAI");

    const result = addAppToPage(workspace, "page-1", entry, { column: 2, row: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.workspace.entities).toEqual([entry]);
    expect(layoutOf(result.workspace, "page-1").items).toEqual([
      { id: "app-openai", position: { column: 2, row: 1 }, span: { columns: 1, rows: 1 } },
    ]);
  });

  it("defaults the desired position to the top-left cell", () => {
    const workspace = baseWorkspace();

    const result = addAppToPage(workspace, "page-1", app("app-a"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(layoutOf(result.workspace, "page-1").items[0]?.position).toEqual({
      column: 0,
      row: 0,
    });
  });

  it("resolves the nearest free cell when the desired cell is occupied", () => {
    const workspace = baseWorkspace();
    const first = addAppToPage(workspace, "page-1", app("app-a"), { column: 1, row: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    const second = addAppToPage(first.workspace, "page-1", app("app-b"), { column: 1, row: 1 });

    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    const items = layoutOf(second.workspace, "page-1").items;
    expect(items).toHaveLength(2);
    expect(items[1]?.id).toBe("app-b");
    expect(items[1]?.position).not.toEqual({ column: 1, row: 1 });
  });

  it("fails with no-space on a completely full grid", () => {
    let workspace = baseWorkspace();
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const filled = addAppToPage(
          workspace,
          "page-1",
          app(`app-${row}-${column}`),
          { column, row },
        );
        expect(filled.ok).toBe(true);
        if (filled.ok) {
          workspace = filled.workspace;
        }
      }
    }

    const result = addAppToPage(workspace, "page-1", app("app-extra"));

    expect(result).toEqual({ ok: false, reason: "no-space" });
  });

  it("fails with duplicate-entity-id when the entity id already exists", () => {
    const workspace = baseWorkspace();
    const first = addAppToPage(workspace, "page-1", app("app-a"));
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    const second = addAppToPage(first.workspace, "page-1", app("app-a", "Another"));

    expect(second).toEqual({ ok: false, reason: "duplicate-entity-id" });
  });

  it("fails with page-not-found for an unknown page", () => {
    const result = addAppToPage(baseWorkspace(), "page-x", app("app-a"));

    expect(result).toEqual({ ok: false, reason: "page-not-found" });
  });

  it("preserves entity, page and dock ordering and existing entities", () => {
    const workspace = baseWorkspace();
    const seeded = addAppToPage(workspace, "page-1", app("app-first"), { column: 0, row: 2 });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) {
      return;
    }

    const result = addAppToPage(seeded.workspace, "page-1", app("app-second"), { column: 3, row: 2 });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.workspace.entities.map((entity) => entity.id)).toEqual([
      "app-first",
      "app-second",
    ]);
    expect(result.workspace.pages.map((page) => page.id)).toEqual(["page-1"]);
    expect(result.workspace.dock).toBe(workspace.dock);
    expect(result.workspace.categories).toBe(workspace.categories);
  });

  it("does not mutate the input workspace", () => {
    const workspace = baseWorkspace();
    const frozen = JSON.parse(JSON.stringify(workspace)) as WorkspaceSnapshot;

    addAppToPage(workspace, "page-1", app("app-a"), { column: 1, row: 0 });

    expect(JSON.parse(JSON.stringify(workspace))).toEqual(frozen);
  });

  it("accepts a custom-protocol app and keeps the workspace valid", () => {
    const workspace = baseWorkspace();
    const entry: AppShortcut = {
      kind: "app",
      id: "app-notes",
      name: "Notes",
      url: "obsidian://open?vault=Notes",
      icon: { kind: "generated", text: "NO" },
      openMode: "new-tab",
      tags: [],
    };

    const result = addAppToPage(workspace, "page-1", entry);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.workspace.entities[0]).toEqual(entry);
    expect(entry.url).toBe("obsidian://open?vault=Notes");
    expect(validateWorkspace(result.workspace)).toEqual([]);
  });

  it("keeps the workspace valid after a nearest-free placement", () => {
    const workspace = baseWorkspace();
    const first = addAppToPage(workspace, "page-1", app("app-a"), { column: 0, row: 0 });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    const moved = replacePageLayout(first.workspace, "page-1", {
      id: "page-1",
      grid: { columns: 4, rows: 3 },
      items: [
        { id: "app-a", position: { column: 2, row: 1 }, span: { columns: 1, rows: 1 } },
      ],
    });
    expect(moved.ok).toBe(true);

    const second = addAppToPage(first.workspace, "page-1", app("app-b"), { column: 0, row: 0 });

    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(validateWorkspace(second.workspace)).toEqual([]);
  });
});
