import { describe, expect, it } from "vitest";
import { validateWorkspace } from "@veladesk/domain";
import { resolvePagePlacement, pageItemIds } from "@veladesk/domain";

import { buildSampleWorkspace, findSampleFolder, SAMPLE_WORKSPACE_NAME } from "./sample-workspace";

/**
 * The built-in sample workspace (一键体验示例工作区): a static curated
 * document built through the CANONICAL import pipeline. These tests pin
 * the structure users get on first run: exactly the four category
 * sections, 9–10 real sites each, one folder example and a curated dock —
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

  it("gives every category 9–10 real, unique https sites", () => {
    const urlKeys = new Set<string>();
    for (const page of SAMPLE.pages) {
      const apps = appsOnPage(page.id);
      expect(apps.length).toBeGreaterThanOrEqual(9);
      expect(apps.length).toBeLessThanOrEqual(10);
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
    expect(dockedNames).toEqual(["GitHub", "MDN", "ChatGPT", "Figma"]);
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

describe("localized sample", () => {
  it("creates readable English categories and folder names without changing the structure", () => {
    const sample = buildSampleWorkspace(makeIdFactory(), "en-US");
    expect(sample.name).toBe("Sample workspace");
    expect(sample.pages.map((page) => page.name)).toEqual(["Frontend development", "WeChat mini programs", "AI tools", "Design inspiration"]);
    expect(findSampleFolder(sample)?.name).toBe("Docs");
    expect(sample.entities.some((entity) => entity.kind === "app" && entity.name === "React")).toBe(true);
    expect(sample.pages.every((page) => pageItemIds(page).length > 0)).toBe(true);
    expect(sample.preferences.defaultPageId).toBe(sample.pages[0]?.id);
    expect(validateWorkspace(sample)).toEqual([]);
    expect(sample.entities).toHaveLength(SAMPLE.entities.length);
    expect(sample.dock.items).toHaveLength(SAMPLE.dock.items.length);
  });
});


describe("sample presentation", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    it(`${locale}: groups ten icons into two rows of five, folder first`, () => {
      const sample = buildSampleWorkspace(makeIdFactory(), locale);
      for (const page of sample.pages) {
        const placement = resolvePagePlacement(page);
        expect(placement.mode).toBe("grid");
        if (placement.mode !== "grid") throw new Error("expected grid");
        expect(placement.items).toHaveLength(10);
        expect(placement.items.filter((item) => item.row === 0)).toHaveLength(5);
        expect(placement.items.filter((item) => item.row === 1)).toHaveLength(5);
        expect(placement.items.every((item) => item.column < 5)).toBe(true);
      }
      const folder = findSampleFolder(sample)!;
      expect(pageItemIds(sample.pages[0]!)[0]).toBe(folder.id);
    });
    it(`${locale}: uses short names and distinct solid colors with accessible white glyphs`, () => {
      const sample = buildSampleWorkspace(makeIdFactory(), locale);
      const colors = new Set<string>();
      for (const entity of sample.entities) {
        if (entity.kind === "widget") continue;
        expect([...entity.name].length).toBeLessThanOrEqual(/[\u4e00-\u9fff]/.test(entity.name) ? 6 : 8);
        if (entity.kind !== "app") continue;
        expect(entity.visual?.decorationStyle).toBe("solid");
        expect(entity.visual?.foregroundColor).toBe("#FFFFFF");
        const hex = entity.visual!.decorationColor!;
        colors.add(hex);
        const rgb = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
          .map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        const luminance = rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
        expect(1.05 / (luminance + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
      expect(colors.size).toBeGreaterThanOrEqual(15);
    });
  }
});
