import { describe, expect, it } from "vitest";
import { validateWorkspace } from "@veladesk/domain";
import { pageItemIds } from "@veladesk/domain";

import { buildSampleWorkspace, findSampleFolder, SAMPLE_WORKSPACE_NAME } from "./sample-workspace";

/**
 * The built-in sample workspace (一键体验示例工作区): a static curated
 * document built through the CANONICAL import pipeline. These tests pin
 * the structure users get on first run: exactly the four category
 * sections, 6–8 real sites each, one folder example and a curated dock —
 * all through a snapshot that passes full domain validation.
 */

/** Deterministic id factory — sample ids are sequential and unique. */
function makeIdFactory() {
  let next = 0;
  return (kind: string) => `${kind}-${(next += 1)}`;
}

const SAMPLE = buildSampleWorkspace(makeIdFactory());

const CATEGORY_NAMES = ["前端开发", "微信小程序", "AI 工具", "设计灵感"];

function appsOnPage(pageId: string) {
  const page = SAMPLE.pages.find((candidate) => candidate.id === pageId);
  if (page === undefined) {
    throw new Error(`page ${pageId} missing`);
  }
  const ids = new Set(pageItemIds(page));
  return SAMPLE.entities.filter(
    (entity): entity is Extract<typeof entity, { kind: "app" }> =>
      entity.kind === "app" && ids.has(entity.id)
  );
}

describe("buildSampleWorkspace", () => {
  it("produces a snapshot that passes full domain validation", () => {
    expect(validateWorkspace(SAMPLE)).toEqual([]);
  });

  it("is exactly the four category sections, seed page removed", () => {
    expect(SAMPLE.name).toBe(SAMPLE_WORKSPACE_NAME);
    expect(SAMPLE.pages.map((page) => page.name)).toEqual(CATEGORY_NAMES);
    // The seed page is gone and the first category became the default.
    expect(SAMPLE.pages.some((page) => page.name === "开始")).toBe(false);
    expect(SAMPLE.preferences.defaultPageId).toBe(SAMPLE.pages[0]?.id);
  });

  it("gives every category 6–8 real, unique https sites", () => {
    const urlKeys = new Set<string>();
    for (const page of SAMPLE.pages) {
      const apps = appsOnPage(page.id);
      expect(apps.length).toBeGreaterThanOrEqual(6);
      expect(apps.length).toBeLessThanOrEqual(8);
      for (const app of apps) {
        expect(app.url).toMatch(/^https:\/\//);
        expect(app.name.trim().length).toBeGreaterThan(0);
        const key = `${app.url}`;
        expect(urlKeys.has(key)).toBe(false);
        urlKeys.add(key);
      }
    }
  });

  it("applies the import icon policy: brand sites get brand icons", () => {
    const byName = new Map(
      SAMPLE.entities.filter((entity) => entity.kind === "app").map((entity) => [entity.name, entity])
    );
    const github = byName.get("GitHub");
    const figma = byName.get("Figma");
    const npm = byName.get("npm");
    expect(github?.icon).toEqual({ kind: "iconify", icon: "simple-icons:github" });
    expect(figma?.icon).toEqual({ kind: "iconify", icon: "simple-icons:figma" });
    // Not in the brand table → the shared generated-text icon.
    expect(npm?.icon).toMatchObject({ kind: "generated", source: "auto" });
  });

  it("includes the folder example on «前端开发» with its own apps", () => {
    const folder = findSampleFolder(SAMPLE);
    expect(folder).toBeDefined();
    expect(folder?.children.length).toBe(3);
    const frontEndPage = SAMPLE.pages.find((page) => page.name === "前端开发");
    expect(folder !== undefined && frontEndPage !== undefined).toBe(true);
    if (folder === undefined || frontEndPage === undefined) {
      return;
    }
    // The folder sits on the section's layout; its children exist as apps.
    expect(pageItemIds(frontEndPage)).toContain(folder.id);
    for (const childId of folder.children) {
      const child = SAMPLE.entities.find((entity) => entity.id === childId);
      expect(child?.kind).toBe("app");
    }
    // Folder children are NOT also placed on the page.
    const pageIds = new Set(pageItemIds(frontEndPage));
    for (const childId of folder.children) {
      expect(pageIds.has(childId)).toBe(false);
    }
  });

  it("pins the curated dock apps, each exactly once", () => {
    const dockedNames = SAMPLE.dock.items.map((itemId) => {
      const entity = SAMPLE.entities.find((candidate) => candidate.id === itemId);
      return entity?.kind === "app" ? entity.name : null;
    });
    expect(dockedNames).toEqual(["GitHub", "MDN Web Docs", "ChatGPT", "Figma"]);
  });

  it("keeps every id unique across pages and entities", () => {
    const ids = [
      ...SAMPLE.pages.map((page) => page.id),
      ...SAMPLE.entities.map((entity) => entity.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is deterministic for a given id factory", () => {
    const rebuild = buildSampleWorkspace(makeIdFactory());
    const stripIds = (workspace: typeof rebuild) =>
      JSON.stringify({
        name: workspace.name,
        pages: workspace.pages.map((page) => page.name),
        entities: workspace.entities.map((entity) =>
          entity.kind === "app"
            ? { kind: entity.kind, name: entity.name, url: entity.url }
            : { kind: entity.kind, name: "name" in entity ? entity.name : undefined }
        ),
        dock: workspace.dock.items.length,
      });
    expect(stripIds(rebuild)).toBe(stripIds(SAMPLE));
  });
});
