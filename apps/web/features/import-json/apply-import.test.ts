import { describe, expect, it } from "vitest";

import type { GridCanvasItem } from "@veladesk/canvas-engine";
import { validateWorkspace } from "@veladesk/domain";

import { applyImportPlan, resolveImportAppIcon } from "./apply-import";
import { parseImportDocument } from "./parser";
import { planImport } from "./planner";
import { addApp, findPage, makeTestIdFactory, officeWorkspace } from "./fixtures";
import type { VelaDeskImportDocumentV1 } from "./contract";

function documentOf(
  sections: { name: string; apps: { name: string; url: string }[] }[]
): VelaDeskImportDocumentV1 {
  return { format: "veladesk-import", version: 1, sections };
}

describe("applyImportPlan", () => {
  it("does not mutate the input snapshot", () => {
    const { workspace } = officeWorkspace();
    const before = JSON.stringify(workspace);
    const document = documentOf([
      { name: "Office", apps: [{ name: "Notion", url: "https://www.notion.so/" }] },
      { name: "AI", apps: [{ name: "ChatGPT", url: "https://chatgpt.com/" }] },
    ]);
    const applied = applyImportPlan(workspace, planImport(workspace, document), makeTestIdFactory());
    expect(applied.ok).toBe(true);
    expect(JSON.stringify(workspace)).toBe(before);
    expect(applied.ok && applied.workspace).not.toBe(workspace);
  });

  it("preserves every existing entity, section, dock item and preference", () => {
    const { workspace } = officeWorkspace();
    const document = documentOf([{ name: "AI", apps: [{ name: "ChatGPT", url: "https://chatgpt.com/" }] }]);
    const applied = applyImportPlan(workspace, planImport(workspace, document), makeTestIdFactory());
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    const next = applied.workspace;
    expect(next.entities.find((entity) => entity.id === "app-github")).toBeDefined();
    expect(next.pages.find((page) => page.id === "page-home")).toBeDefined();
    expect(next.pages.find((page) => page.id === "page-office")).toBeDefined();
    expect(next.dock).toEqual(workspace.dock);
    expect(next.preferences).toEqual(workspace.preferences);
    for (const page of workspace.pages) {
      expect(next.pages.find((candidate) => candidate.id === page.id)?.wallpaper).toEqual(page.wallpaper);
    }
  });

  it("creates new sections with the New Section construction defaults", () => {
    const { workspace } = officeWorkspace();
    const document = documentOf([{ name: "AI", apps: [{ name: "ChatGPT", url: "https://chatgpt.com/" }] }]);
    const applied = applyImportPlan(workspace, planImport(workspace, document), makeTestIdFactory());
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    const created = applied.workspace.pages.find((page) => page.name === "AI");
    expect(created).toBeDefined();
    expect(created?.canvas?.version).toBe(2);
    expect(created?.canvas?.mode).toBe("grid");
    expect(created?.layout.grid.columns).toBe(workspace.pages[0]?.layout.grid.columns);
  });

  it("merges imported apps into the existing canonical-name section", () => {
    const { workspace, officePageId } = officeWorkspace();
    const document = documentOf([{ name: " office", apps: [{ name: "Notion", url: "https://www.notion.so/" }] }]);
    const applied = applyImportPlan(workspace, planImport(workspace, document), makeTestIdFactory());
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    const page = findPage(applied.workspace, officePageId);
    const canvas = page.canvas;
    expect(canvas).toBeDefined();
    if (canvas && canvas.version === 2 && canvas.mode === "grid") {
      expect(canvas.items.map((item) => item.id)).toContain("app-1");
    } else {
      throw new Error("expected a v2 grid canvas on the merged page");
    }
    const notion = applied.workspace.entities.find((entity) => entity.id === "app-1");
    expect(notion && notion.kind === "app" && notion.name).toBe("Notion");
  });

  it("never creates a duplicate app (URL identity)", () => {
    const { workspace } = officeWorkspace();
    const document = documentOf([
      {
        name: "Office",
        apps: [
          { name: "GitHub", url: "https://github.com/" },
          { name: "GitHub Again", url: "https://github.com/#top" },
        ],
      },
    ]);
    const applied = applyImportPlan(workspace, planImport(workspace, document), makeTestIdFactory());
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    const githubApps = applied.workspace.entities.filter(
      (entity) => entity.kind === "app" && entity.url.startsWith("https://github.com")
    );
    expect(githubApps).toHaveLength(1);
    expect(githubApps[0]?.id).toBe("app-github");
  });

  it("persists the normalized URL and the Add App defaults on new apps", () => {
    const { workspace } = officeWorkspace();
    // Through the real production path (parse → plan → apply) so URL
    // normalization happens exactly as it does for the user.
    const parsed = parseImportDocument(
      JSON.stringify({
        format: "veladesk-import",
        version: 1,
        sections: [{ name: "Dev", apps: [{ name: "Example", url: "example.com" }] }],
      })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const applied = applyImportPlan(
      workspace,
      planImport(workspace, parsed.parsed.document),
      makeTestIdFactory()
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    const app = applied.workspace.entities.find((entity) => entity.id === "app-1");
    expect(app && app.kind === "app" && app.url).toBe("https://example.com/");
    if (app && app.kind === "app") {
      expect(app.openMode).toBe("new-tab");
      expect(app.tags).toEqual([]);
      expect(app.visual).toBeUndefined();
      expect(app.categoryId).toBeUndefined();
    }
  });

  it("places multiple imported apps on non-conflicting grid slots", () => {
    const { workspace } = officeWorkspace();
    const apps = Array.from({ length: 12 }, (_unused, index) => ({
      name: `Tool ${index + 1}`,
      url: `https://tool${index + 1}.example.com/`,
    }));
    const document = documentOf([{ name: "Tools", apps }]);
    const applied = applyImportPlan(workspace, planImport(workspace, document), makeTestIdFactory());
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    const page = applied.workspace.pages.find((candidate) => candidate.name === "Tools");
    expect(page).toBeDefined();
    const canvas = page?.canvas;
    if (!canvas || canvas.version !== 2 || canvas.mode !== "grid") {
      throw new Error("expected a v2 grid canvas");
    }
    const occupied = new Set(canvas.items.map((item: GridCanvasItem) => `${item.column}:${item.row}`));
    expect(occupied.size).toBe(canvas.items.length);
    expect(canvas.items.every((item) => item.columnSpan === 1 && item.rowSpan === 1)).toBe(true);
  });

  it("appends imported apps after a merged section's existing items", () => {
    const { workspace, officePageId } = officeWorkspace();
    const document = documentOf([{ name: "Office", apps: [{ name: "Notion", url: "https://www.notion.so/" }] }]);
    const applied = applyImportPlan(workspace, planImport(workspace, document), makeTestIdFactory());
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    const page = findPage(applied.workspace, officePageId);
    if (!page.canvas || page.canvas.version !== 2 || page.canvas.mode !== "grid") {
      throw new Error("expected a v2 grid canvas");
    }
    expect(page.canvas.items.map((item) => item.id)).toEqual(["app-github", "app-1"]);
  });

  it("produces a snapshot that passes whole-workspace validation", () => {
    const { workspace } = officeWorkspace();
    const withIntranet = addApp(workspace, "page-home", "app-wiki", "Wiki", "http://wiki.internal/");
    const document = documentOf([
      {
        name: "内部",
        apps: [
          { name: "Docs", url: "http://docs.internal/" },
          { name: "Obsidian", url: "obsidian://vault/notes" },
        ],
      },
      { name: "AI", apps: [{ name: "ChatGPT", url: "https://chatgpt.com/" }] },
    ]);
    const applied = applyImportPlan(withIntranet, planImport(withIntranet, document), makeTestIdFactory());
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    expect(validateWorkspace(applied.workspace)).toEqual([]);
  });
});

describe("resolveImportAppIcon (task 024 §25–§26)", () => {
  it("uses the bundled catalog icon for a known brand URL", () => {
    expect(resolveImportAppIcon("GitHub", "https://github.com/")).toEqual({
      kind: "iconify",
      icon: "simple-icons:github",
    });
    expect(resolveImportAppIcon("GitHub Gist", "https://gist.github.com/")).toEqual({
      kind: "iconify",
      icon: "simple-icons:github",
    });
  });

  it("uses the shared generated-text helper for unknown apps", () => {
    expect(resolveImportAppIcon("Internal Dashboard", "http://wiki.internal/")).toEqual({
      kind: "generated",
      text: "IN",
      source: "auto",
    });
    expect(resolveImportAppIcon("Beta", "https://beta.example.com/")).toEqual({
      kind: "generated",
      text: "BE",
      source: "auto",
    });
  });

  it("falls back to generated text when the URL cannot be parsed at all", () => {
    expect(resolveImportAppIcon("Weird", "my-tool://thing")).toEqual({
      kind: "generated",
      text: "WE",
      source: "auto",
    });
  });
});
