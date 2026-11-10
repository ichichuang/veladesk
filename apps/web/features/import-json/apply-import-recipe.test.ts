/*
 * Recipe structure through the pure apply layer (recipe B): created
 * sections restore layout mode, grid, tile geometry and light/dark
 * wallpapers; merged sections only gain apps; theme + motion are opt-in;
 * illegal geometry falls back to the engine per tile; one snapshot out.
 */
import { describe, expect, it, vi } from "vitest";

import { CANVAS_UNITS } from "@veladesk/canvas-engine";
import type { CanvasLayout } from "@veladesk/canvas-engine";
import { createContentAssetId } from "@veladesk/assets/core";
import type { DesktopPage, RecipeThemeV1, WorkspaceSnapshot } from "@veladesk/domain";
import {
  addAppToPage,
  addPage,
  createEmptyWorkspace,
  exportRecipe,
  inferInterfaceStyle,
  pageItemIds,
  replacePageCanvas,
  replacePageModeWallpaper,
  resolveInterfaceStyle,
  resolveWorkspaceAppearance,
  validateWorkspace,
} from "@veladesk/domain";

import { stageWorkspaceAndTrySync } from "../home/workspace-commit";

type WorkspaceClientRuntime = Parameters<typeof stageWorkspaceAndTrySync>[0];
import { applyImportPlan } from "./apply-import";
import type { ApplyImportOptions } from "./apply-import";
import { addApp, makeTestIdFactory, officeWorkspace } from "./fixtures";
import { parseImportDocument } from "./parser";
import { planImport } from "./planner";
import { decodeRecipeAssets } from "./recipe-assets";

const NIGHT_ID = `asset-sha256-${"b".repeat(64)}`;

function recipeDoc(spaces: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ format: "vela.recipe", version: 1, spaces, plugins: [], ...extra });
}

function importRecipeText(
  workspace: WorkspaceSnapshot,
  text: string,
  options: Omit<ApplyImportOptions, "recipe"> = {},
): WorkspaceSnapshot {
  const parsed = parseImportDocument(text);
  if (!parsed.ok) throw new Error(`parse failed: ${JSON.stringify(parsed.issues)}`);
  const plan = planImport(workspace, parsed.parsed.document, parsed.parsed.issues);
  const applied = applyImportPlan(workspace, plan, makeTestIdFactory(), { recipe: parsed.parsed.recipe, ...options });
  if (!applied.ok) throw new Error(`apply failed: ${applied.reason}`);
  expect(validateWorkspace(applied.workspace)).toEqual([]);
  return applied.workspace;
}

function pageNamed(workspace: WorkspaceSnapshot, name: string): DesktopPage {
  const page = workspace.pages.find((candidate) => candidate.name === name);
  if (page === undefined) throw new Error(`no page ${name}`);
  return page;
}

function appIdByUrl(workspace: WorkspaceSnapshot, url: string): string {
  const app = workspace.entities.find((entity) => entity.kind === "app" && entity.url === url);
  if (app === undefined) throw new Error(`no app ${url}`);
  return app.id;
}

function gridItems(page: DesktopPage) {
  const canvas = page.canvas;
  if (canvas?.version !== 2 || canvas.mode !== "grid") throw new Error("not a grid page");
  return canvas.items;
}

function freeItems(page: DesktopPage) {
  const canvas = page.canvas;
  if (canvas?.version !== 2 || canvas.mode !== "freeform") throw new Error("not a freeform page");
  return canvas.items;
}

function overlaps(a: { column: number; row: number; columnSpan: number; rowSpan: number }, b: typeof a): boolean {
  return a.column < b.column + b.columnSpan && b.column < a.column + a.columnSpan && a.row < b.row + b.rowSpan && b.row < a.row + a.rowSpan;
}

describe("parser passes the recipe structure through", () => {
  it("a recipe document carries spaces/theme/motion; a plain import carries nothing", () => {
    const theme = { mode: "dark", accent: 30, material: "glass" };
    const parsed = parseImportDocument(
      recipeDoc([{ name: "AI", layout: "grid", layoutMode: "free", tiles: [{ name: "A", url: "https://a.example/", placement: "free", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] }], {
        theme,
        motion: { reducedMotion: "on" },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.parsed.recipe?.theme).toEqual(theme);
    expect(parsed.parsed.recipe?.motion).toEqual({ reducedMotion: "on" });
    expect(parsed.parsed.recipe?.spaces[0]).toMatchObject({ name: "AI", layoutMode: "free", tiles: [{ placement: "free", x: 0.1 }] });

    const plain = parseImportDocument(
      JSON.stringify({ format: "veladesk-import", version: 1, sections: [{ name: "AI", apps: [{ name: "A", url: "https://a.example/" }] }] }),
    );
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    expect(Object.hasOwn(plain.parsed, "recipe")).toBe(false);
  });
});

describe("created sections restore the recipe structure", () => {
  it("snap: grid + exact cells", () => {
    const next = importRecipeText(
      officeWorkspace().workspace,
      recipeDoc([
        {
          name: "AI",
          layout: "grid",
          layoutMode: "snap",
          grid: { columns: 8, rows: 5 },
          tiles: [
            { name: "A", url: "https://a.example/", placement: "snap", x: 3, y: 1, w: 2, h: 2 },
            { name: "B", url: "https://b.example/", placement: "snap", x: 0, y: 4, w: 1, h: 1 },
          ],
        },
      ]),
    );
    const page = pageNamed(next, "AI");
    expect(page.layout.grid).toEqual({ columns: 8, rows: 5 });
    expect(page.canvas).toMatchObject({ version: 2, mode: "grid", columns: 8 });
    expect(gridItems(page)).toEqual([
      { id: appIdByUrl(next, "https://a.example/"), column: 3, row: 1, columnSpan: 2, rowSpan: 2 },
      { id: appIdByUrl(next, "https://b.example/"), column: 0, row: 4, columnSpan: 1, rowSpan: 1 },
    ]);
  });

  it("free: freeform canvas + 0–1 fractions as canvas units", () => {
    const next = importRecipeText(
      officeWorkspace().workspace,
      recipeDoc([
        {
          name: "Board",
          layout: "canvas",
          layoutMode: "free",
          tiles: [{ name: "A", url: "https://a.example/", placement: "free", x: 0.25, y: 0.5, w: 0.2, h: 0.1 }],
        },
      ]),
    );
    expect(freeItems(pageNamed(next, "Board"))).toEqual([
      { id: appIdByUrl(next, "https://a.example/"), rect: { x: 2500, y: 5000, width: 2000, height: 1000 } },
    ]);
  });

  it("light/dark wallpapers: preset and asset refs", () => {
    const next = importRecipeText(
      officeWorkspace().workspace,
      recipeDoc([{ name: "AI", layout: "grid", wallpaper: { light: "preset:aurora", dark: `asset:${NIGHT_ID}` }, tiles: [] }]),
    );
    expect(pageNamed(next, "AI").wallpaperByMode).toEqual({
      light: { kind: "preset", presetId: "aurora" },
      dark: { kind: "asset", assetId: NIGHT_ID, fit: "cover", position: "center" },
    });
    expect(pageNamed(next, "AI").wallpaper).toBeUndefined();
  });

  it("folds same-name spaces like the planner: first space's fields, tiles concatenated in order", () => {
    const next = importRecipeText(
      officeWorkspace().workspace,
      recipeDoc([
        { name: "AI", layout: "grid", grid: { columns: 6, rows: 4 }, tiles: [{ name: "A", url: "https://a.example/", placement: "snap", x: 5, y: 0, w: 1, h: 1 }] },
        { name: "ai", layout: "canvas", layoutMode: "free", tiles: [{ name: "B", url: "https://b.example/", placement: "snap", x: 0, y: 3, w: 2, h: 1 }] },
      ]),
    );
    const page = pageNamed(next, "AI");
    expect(page.layout.grid).toEqual({ columns: 6, rows: 4 });
    expect(gridItems(page)).toEqual([
      { id: appIdByUrl(next, "https://a.example/"), column: 5, row: 0, columnSpan: 1, rowSpan: 1 },
      { id: appIdByUrl(next, "https://b.example/"), column: 0, row: 3, columnSpan: 2, rowSpan: 1 },
    ]);
  });
});

describe("merged sections only gain apps", () => {
  it("keeps the existing page's mode, canvas geometry and wallpapers", () => {
    const { workspace, officePageId } = officeWorkspace();
    const before = workspace.pages.find((page) => page.id === officePageId)!;
    const next = importRecipeText(
      workspace,
      recipeDoc([
        {
          name: "Office",
          layout: "canvas",
          layoutMode: "free",
          grid: { columns: 4, rows: 2 },
          wallpaper: { light: "preset:mist", dark: "preset:midnight" },
          tiles: [{ name: "Notion", url: "https://www.notion.so/", placement: "free", x: 0.9, y: 0.9, w: 0.1, h: 0.1 }],
        },
      ]),
      { applyTheme: false },
    );
    const after = next.pages.find((page) => page.id === officePageId)!;
    expect(after.layout).toEqual(before.layout);
    expect(after.wallpaperByMode).toBeUndefined();
    expect(after.wallpaper).toEqual(before.wallpaper);
    const items = gridItems(after);
    expect(items[0]).toEqual(gridItems(before)[0]);
    expect(items).toHaveLength(2);
    expect(items[1]?.id).toBe(appIdByUrl(next, "https://www.notion.so/"));
    expect(pageItemIds(after)).toEqual([...pageItemIds(before), appIdByUrl(next, "https://www.notion.so/")]);
  });
});

describe("theme + motion are opt-in", () => {
  const text = recipeDoc([{ name: "AI", layout: "grid", tiles: [] }], {
    theme: { mode: "light", accent: 42, material: "glass", wallpaper: { light: "preset:dawn", dark: `asset:${NIGHT_ID}` } },
    motion: { reducedMotion: "on", experiments: { helmMotion: true } },
  });

  it("default: preferences untouched", () => {
    const { workspace } = officeWorkspace();
    expect(importRecipeText(workspace, text).preferences).toEqual(workspace.preferences);
  });

  it("applyTheme: colorMode, accent, material via resolveInterfaceStyle, theme wallpaper, motion", () => {
    const { workspace } = officeWorkspace();
    const next = importRecipeText(workspace, text, { applyTheme: true });
    const style = resolveInterfaceStyle("glass");
    expect(next.preferences.appearance).toMatchObject({
      colorMode: "light",
      accentHue: 42,
      interfaceStyle: "glass",
      surfaceOpacity: style.surfaceOpacity,
      blurPx: style.blurPx,
      radiusPx: style.radiusPx,
      wallpaper: { kind: "preset", presetId: "dawn" },
    });
    expect(next.preferences.motion).toEqual({ reducedMotion: "on", experiments: { helmMotion: true } });
    expect(next.preferences.defaultPageId).toBe(workspace.preferences.defaultPageId);
  });

  it("a dark theme takes the dark theme wallpaper", () => {
    const dark = recipeDoc([{ name: "AI", layout: "grid", tiles: [] }], {
      theme: { mode: "dark", accent: 42, material: "soft", wallpaper: { light: "preset:dawn", dark: `asset:${NIGHT_ID}` } },
    });
    const next = importRecipeText(officeWorkspace().workspace, dark, { applyTheme: true });
    expect(next.preferences.appearance?.wallpaper).toEqual({ kind: "asset", assetId: NIGHT_ID, fit: "cover", position: "center" });
  });

  it("an illegal theme FIELD drops at parse with a warning; the legal rest still applies (D1)", () => {
    const { workspace } = officeWorkspace();
    const parsed = parseImportDocument(
      recipeDoc([{ name: "AI", layout: "grid", tiles: [] }], { theme: { mode: "dark", accent: 999, material: "glass" } }),
    );
    if (!parsed.ok) throw new Error("parse");
    expect(parsed.parsed.issues).toContainEqual({
      severity: "warning",
      code: "RECIPE_THEME_FIELD_IGNORED",
      path: "theme.accent",
    });
    expect(parsed.parsed.recipe?.theme).toEqual({ mode: "dark", material: "glass" });
    const plan = planImport(workspace, parsed.parsed.document, parsed.parsed.issues);
    // Even opted in, the import succeeds — the accent keeps the workspace's
    // value while the legal mode + material apply.
    const applied = applyImportPlan(workspace, plan, makeTestIdFactory(), {
      recipe: parsed.parsed.recipe,
      applyTheme: true,
    });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.workspace.preferences.appearance?.accentHue).toBe(resolveWorkspaceAppearance(workspace.preferences).accentHue);
      expect(applied.workspace.preferences.appearance?.colorMode).toBe("dark");
      expect(applied.workspace.preferences.appearance?.interfaceStyle).toBe("glass");
    }
  });

  it("a hand-built illegal theme (no adapter sanitization) applies per field, defensively", () => {
    const { workspace } = officeWorkspace();
    const parsed = parseImportDocument(
      recipeDoc([{ name: "AI", layout: "grid", tiles: [{ name: "A", url: "https://a.example/" }] }], {
        motion: { reducedMotion: "on" },
      }),
    );
    if (!parsed.ok) throw new Error("parse");
    const recipe = parsed.parsed.recipe!;
    const plan = planImport(workspace, parsed.parsed.document, parsed.parsed.issues);
    const applied = applyImportPlan(workspace, plan, makeTestIdFactory(), {
      recipe: { ...recipe, theme: { mode: "blue", accent: 60, material: "diamond" } as unknown as RecipeThemeV1 },
      applyTheme: true,
    });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      // Illegal mode/material never land (the workspace keeps its own mode
      // — the fixture rides the dark default); the LEGAL accent does;
      // motion still applies.
      expect(applied.workspace.preferences.appearance?.colorMode).toBe("dark");
      expect(applied.workspace.preferences.appearance?.accentHue).toBe(60);
      expect(applied.workspace.preferences.appearance?.interfaceStyle).toBeUndefined();
      expect(applied.workspace.preferences.motion).toEqual({ reducedMotion: "on" });
    }
  });
});

describe("wallpaper asset availability (D1)", () => {
  const MISSING_ID = `asset-sha256-${"d".repeat(64)}`;

  it("a created space's ref outside availableAssetIds lands as the deck-default preset", () => {
    const next = importRecipeText(
      officeWorkspace().workspace,
      recipeDoc([{ name: "AI", layout: "grid", wallpaper: { light: "preset:aurora", dark: `asset:${MISSING_ID}` }, tiles: [] }]),
      { availableAssetIds: new Set() },
    );
    expect(pageNamed(next, "AI").wallpaperByMode).toEqual({
      light: { kind: "preset", presetId: "aurora" },
      dark: { kind: "preset", presetId: "dawn" },
    });
  });

  it("an available ref lands verbatim; without availability knowledge refs land verbatim (slice B)", () => {
    const doc = recipeDoc([{ name: "AI", layout: "grid", wallpaper: { dark: `asset:${MISSING_ID}` }, tiles: [] }]);
    const available = importRecipeText(officeWorkspace().workspace, doc, { availableAssetIds: new Set([MISSING_ID]) });
    expect(pageNamed(available, "AI").wallpaperByMode).toEqual({
      dark: { kind: "asset", assetId: MISSING_ID, fit: "cover", position: "center" },
    });
    const verbatim = importRecipeText(officeWorkspace().workspace, doc);
    expect(pageNamed(verbatim, "AI").wallpaperByMode).toEqual({
      dark: { kind: "asset", assetId: MISSING_ID, fit: "cover", position: "center" },
    });
  });

  it("the theme wallpaper falls back the same way, only when applied", () => {
    const text = recipeDoc([{ name: "AI", layout: "grid", tiles: [] }], {
      theme: { mode: "dark", accent: 42, material: "glass", wallpaper: { dark: `asset:${MISSING_ID}` } },
    });
    const applied = importRecipeText(officeWorkspace().workspace, text, {
      applyTheme: true,
      availableAssetIds: new Set(),
    });
    expect(applied.preferences.appearance?.wallpaper).toEqual({ kind: "preset", presetId: "dawn" });
    const untouched = importRecipeText(officeWorkspace().workspace, text, { availableAssetIds: new Set() });
    expect(untouched.preferences.appearance?.wallpaper).toBeUndefined();
  });
});

describe("embedded wallpaper binaries: export sample → import lands (D1)", () => {
  it("verifies, decodes and lands a deck-embedded wallpaper reference", async () => {
    // The D2 export shape: the space's ref points at an id the optional
    // assets map carries base64-embedded.
    const bytes = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64"));
    const id = await createContentAssetId(bytes);
    const text = JSON.stringify({
      format: "vela.recipe",
      version: 1,
      spaces: [
        { name: "Desk", layout: "grid", wallpaper: { dark: `asset:${id}` }, tiles: [{ name: "A", url: "https://a.example/" }] },
      ],
      plugins: [],
      assets: { [id]: { mediaType: "image/png", data: Buffer.from(bytes).toString("base64") } },
    });
    const parsed = parseImportDocument(text);
    if (!parsed.ok) throw new Error("parse");
    expect(parsed.parsed.recipe?.assets).toEqual({ [id]: { mediaType: "image/png", data: Buffer.from(bytes).toString("base64") } });

    const decoded = await decodeRecipeAssets(parsed.parsed.recipe!.assets!, {
      decodeDimensions: async () => ({ width: 1024, height: 768 }),
      yieldControl: async () => {},
    });
    if (!decoded.ok) throw new Error(`decode failed: ${decoded.issue.reason}`);
    expect(decoded.assets[0]).toMatchObject({ id, mediaType: "image/png", byteLength: bytes.byteLength, width: 1024, height: 768 });

    const target = createEmptyWorkspace({ workspaceId: "ws-dst", workspaceName: "Target", pageId: "p-start", pageName: "Start", grid: { columns: 10, rows: 6 } });
    const plan = planImport(target, parsed.parsed.document, parsed.parsed.issues);
    const applied = applyImportPlan(target, plan, makeTestIdFactory(), {
      recipe: parsed.parsed.recipe,
      availableAssetIds: new Set(decoded.assets.map((asset) => asset.id)),
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(validateWorkspace(applied.workspace)).toEqual([]);
    expect(pageNamed(applied.workspace, "Desk").wallpaperByMode).toEqual({
      dark: { kind: "asset", assetId: id, fit: "cover", position: "center" },
    });
  });
});

describe("illegal geometry falls back to the engine, per tile", () => {
  it("snap: out of columns / overlapping / mismatched placement → engine placement, no overlap, plan order kept", () => {
    const next = importRecipeText(
      officeWorkspace().workspace,
      recipeDoc([
        {
          name: "AI",
          layout: "grid",
          grid: { columns: 4, rows: 4 },
          tiles: [
            { name: "Keep", url: "https://keep.example/", placement: "snap", x: 0, y: 0, w: 2, h: 2 },
            { name: "Out", url: "https://out.example/", placement: "snap", x: 3, y: 0, w: 2, h: 1 },
            { name: "Over", url: "https://over.example/", placement: "snap", x: 1, y: 1, w: 1, h: 1 },
            { name: "Free", url: "https://free.example/", placement: "free", x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
            { name: "None", url: "https://none.example/" },
          ],
        },
      ]),
    );
    const items = gridItems(pageNamed(next, "AI"));
    expect(items.map((item) => item.id)).toEqual(
      ["keep", "out", "over", "free", "none"].map((host) => appIdByUrl(next, `https://${host}.example/`)),
    );
    expect(items[0]).toMatchObject({ column: 0, row: 0, columnSpan: 2, rowSpan: 2 });
    for (const item of items) {
      expect(item.column + item.columnSpan).toBeLessThanOrEqual(4);
    }
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        expect(overlaps(items[i]!, items[j]!)).toBe(false);
      }
    }
  });

  it("snap: a recipe grid missing → the target grid bounds the cells (wider tile falls back)", () => {
    const next = importRecipeText(
      officeWorkspace().workspace, // 10 columns
      recipeDoc([{ name: "AI", layout: "grid", tiles: [{ name: "Wide", url: "https://wide.example/", placement: "snap", x: 8, y: 0, w: 4, h: 1 }] }]),
    );
    const [item] = gridItems(pageNamed(next, "AI"));
    expect(item!.column + item!.columnSpan).toBeLessThanOrEqual(10);
    expect(item).not.toMatchObject({ column: 8, columnSpan: 4 });
  });

  it("free: rects are clamped into the 0–1 canvas; snap-only tiles keep the engine cascade", () => {
    const next = importRecipeText(
      officeWorkspace().workspace,
      recipeDoc([
        {
          name: "Board",
          layout: "canvas",
          layoutMode: "free",
          tiles: [
            { name: "Edge", url: "https://edge.example/", placement: "free", x: 0.9, y: 0.95, w: 0.5, h: 0.2 },
            { name: "Corner", url: "https://corner.example/", placement: "free", x: 1, y: 1, w: 0, h: 0 },
            { name: "Cell", url: "https://cell.example/", placement: "snap", x: 1, y: 1, w: 1, h: 1 },
          ],
        },
      ]),
    );
    const items = freeItems(pageNamed(next, "Board"));
    expect(items[0]?.rect).toEqual({ x: 9000, y: 9500, width: 1000, height: 500 });
    expect(items[1]?.rect).toEqual({ x: CANVAS_UNITS - 1, y: CANVAS_UNITS - 1, width: 1, height: 1 });
    for (const item of items) {
      expect(item.rect.x + item.rect.width).toBeLessThanOrEqual(CANVAS_UNITS);
      expect(item.rect.y + item.rect.height).toBeLessThanOrEqual(CANVAS_UNITS);
    }
  });

  it("free: a created freeform space has no retained canvas; geometry-less tiles keep the engine cascade", () => {
    const next = importRecipeText(
      officeWorkspace().workspace,
      recipeDoc([
        {
          name: "Board",
          layout: "canvas",
          layoutMode: "free",
          // No free geometry anywhere — every tile falls to the cascade.
          tiles: [
            { name: "One", url: "https://one.example/" },
            { name: "Two", url: "https://two.example/", placement: "snap", x: 0, y: 0, w: 1, h: 1 },
          ],
        },
      ]),
    );
    const board = pageNamed(next, "Board");
    // Determined behavior: the imported freeform page carries an ACTIVE
    // freeform canvas only — never a retained one — and stays valid.
    expect(board.retainedCanvas).toBeUndefined();
    expect(board.canvas).toMatchObject({ version: 2, mode: "freeform" });
    const items = freeItems(board);
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.rect.x).toBeGreaterThanOrEqual(0);
      expect(item.rect.y).toBeGreaterThanOrEqual(0);
      expect(item.rect.x + item.rect.width).toBeLessThanOrEqual(CANVAS_UNITS);
      expect(item.rect.y + item.rect.height).toBeLessThanOrEqual(CANVAS_UNITS);
    }
  });
});

describe("tile/app count mismatch falls back to the engine (defensive)", () => {
  it("drops declared geometry entirely when the tiles misalign with the planned apps", () => {
    const { workspace } = officeWorkspace();
    const text = recipeDoc([
      {
        name: "AI",
        layout: "grid",
        grid: { columns: 6, rows: 4 },
        tiles: [
          { name: "A", url: "https://a.example/", placement: "snap", x: 0, y: 0, w: 1, h: 1 },
          { name: "B", url: "https://b.example/", placement: "snap", x: 5, y: 3, w: 1, h: 1 },
        ],
      },
    ]);
    const parsed = parseImportDocument(text);
    if (!parsed.ok) throw new Error("parse");
    // Tamper the extras so the tiles no longer line up with the apps.
    const recipe = parsed.parsed.recipe!;
    const tampered = {
      ...recipe,
      spaces: [{ ...recipe.spaces[0]!, tiles: recipe.spaces[0]!.tiles.slice(0, 1) }],
    };
    const plan = planImport(workspace, parsed.parsed.document, parsed.parsed.issues);
    const applied = applyImportPlan(workspace, plan, makeTestIdFactory(), { recipe: tampered });
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    const items = gridItems(pageNamed(applied.workspace, "AI"));
    expect(items).toHaveLength(2);
    // No declared cell survives the mismatch — every tile is engine-placed
    // (first-free around nothing = the cascade origin column), unlike the
    // aligned import which pins B at column 5, row 3.
    expect(items.some((item) => item.column === 5 && item.row === 3)).toBe(false);
    for (const item of items) {
      expect(item.column + item.columnSpan).toBeLessThanOrEqual(6);
    }
  });
});

describe("one revision", () => {
  it("the whole recipe import is ONE in-memory snapshot staged once", async () => {
    const { workspace } = officeWorkspace();
    const before = JSON.stringify(workspace);
    const parsed = parseImportDocument(
      recipeDoc(
        [
          { name: "AI", layout: "grid", grid: { columns: 6, rows: 3 }, wallpaper: { dark: "preset:midnight" }, tiles: [{ name: "A", url: "https://a.example/", placement: "snap", x: 1, y: 1, w: 1, h: 1 }] },
          { name: "Board", layout: "canvas", layoutMode: "free", tiles: [{ name: "B", url: "https://b.example/", placement: "free", x: 0.1, y: 0.1, w: 0.1, h: 0.1 }] },
        ],
        { theme: { mode: "dark", accent: 10, material: "clean" } },
      ),
    );
    if (!parsed.ok) throw new Error("parse");
    const plan = planImport(workspace, parsed.parsed.document, parsed.parsed.issues);
    const applied = applyImportPlan(workspace, plan, makeTestIdFactory(), { recipe: parsed.parsed.recipe, applyTheme: true });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(JSON.stringify(workspace)).toBe(before); // pure: nothing written on the way

    const stageWorkspaceUpdate = vi.fn(async (snapshot: WorkspaceSnapshot) => ({ ok: true as const, snapshot }));
    const runtime = { stageWorkspaceUpdate, syncCurrent: vi.fn(async () => undefined) } as unknown as WorkspaceClientRuntime;
    await stageWorkspaceAndTrySync(runtime, applied.workspace);
    expect(stageWorkspaceUpdate).toHaveBeenCalledTimes(1);
    const staged = stageWorkspaceUpdate.mock.calls[0]![0];
    expect(pageNamed(staged, "AI").wallpaperByMode).toEqual({ dark: { kind: "preset", presetId: "midnight" } });
    expect(pageNamed(staged, "Board").canvas).toMatchObject({ mode: "freeform" });
    expect(staged.preferences.appearance?.colorMode).toBe("dark");
  });
});

describe("export → import round trip", () => {
  function unwrap(result: ReturnType<typeof addPage>): WorkspaceSnapshot {
    if (!result.ok) throw new Error(result.reason);
    return result.workspace;
  }

  function sourceWorkspace(): WorkspaceSnapshot {
    let ws = createEmptyWorkspace({ workspaceId: "ws-src", workspaceName: "Source", pageId: "p-desk", pageName: "Desk", grid: { columns: 8, rows: 5 } });
    ws = addApp(ws, "p-desk", "s-a", "A", "https://a.example/");
    ws = addApp(ws, "p-desk", "s-b", "B", "https://b.example/");
    const deskCanvas: CanvasLayout = {
      version: 2,
      mode: "grid",
      columns: 8,
      items: [
        { id: "s-a", column: 4, row: 2, columnSpan: 2, rowSpan: 2 },
        { id: "s-b", column: 0, row: 0, columnSpan: 1, rowSpan: 1 },
      ],
    };
    ws = unwrap(replacePageCanvas(ws, "p-desk", deskCanvas));
    ws = unwrap(replacePageModeWallpaper(ws, "p-desk", "light", { kind: "preset", presetId: "mist" }));
    ws = unwrap(replacePageModeWallpaper(ws, "p-desk", "dark", { kind: "asset", assetId: NIGHT_ID, fit: "cover", position: "center" }));
    ws = unwrap(
      addPage(ws, { id: "p-board", name: "Board", layout: { id: "p-board", grid: { columns: 8, rows: 5 }, items: [] }, canvas: { version: 2, mode: "freeform", items: [] } }),
    );
    ws = unwrap(
      addAppToPage(ws, "p-board", { kind: "app", id: "s-c", name: "C", url: "https://c.example/", icon: { kind: "generated", text: "C", source: "auto" }, openMode: "new-tab", tags: [] }),
    );
    ws = unwrap(
      replacePageCanvas(ws, "p-board", { version: 2, mode: "freeform", items: [{ id: "s-c", rect: { x: 1234, y: 5678, width: 2100, height: 900 } }] }),
    );
    ws = unwrap(replacePageModeWallpaper(ws, "p-board", "light", { kind: "preset", presetId: "aurora" }));
    return ws;
  }

  it("restores layout mode, grid, wallpapers and tile geometry into an empty workspace", () => {
    const source = sourceWorkspace();
    const text = JSON.stringify(exportRecipe(source, { createdAt: "2026-11-09T00:00:00.000Z" }));
    const target = createEmptyWorkspace({ workspaceId: "ws-dst", workspaceName: "Target", pageId: "p-start", pageName: "Start", grid: { columns: 10, rows: 6 } });
    const next = importRecipeText(target, text);

    for (const sourcePage of source.pages) {
      const imported = pageNamed(next, sourcePage.name);
      expect(imported.layout.grid).toEqual(sourcePage.layout.grid);
      expect(imported.canvas?.mode).toBe(sourcePage.canvas?.mode);
      expect(imported.wallpaperByMode).toEqual(sourcePage.wallpaperByMode);
      const urlOf = (ws: WorkspaceSnapshot, id: string) => ws.entities.find((entity) => entity.id === id && entity.kind === "app")!;
      const geometry = (ws: WorkspaceSnapshot, page: DesktopPage) => {
        const canvas = page.canvas!;
        if (canvas.version !== 2) throw new Error("v2 expected");
        return canvas.mode === "grid"
          ? canvas.items.map(({ id, ...cell }) => ({ url: (urlOf(ws, id) as { url: string }).url, ...cell }))
          : canvas.items.map(({ id, rect }) => ({ url: (urlOf(ws, id) as { url: string }).url, ...rect }));
      };
      expect(geometry(next, imported)).toEqual(geometry(source, sourcePage));
    }
  });

  it("round trips the theme: the deck's color mode, accent and material re-apply", () => {
    const source = sourceWorkspace();
    const text = JSON.stringify(exportRecipe(source, { createdAt: "2026-11-09T00:00:00.000Z" }));
    const target = createEmptyWorkspace({ workspaceId: "ws-dst", workspaceName: "Target", pageId: "p-start", pageName: "Start", grid: { columns: 10, rows: 6 } });
    const next = importRecipeText(target, text, { applyTheme: true });
    // The source stores no explicit material — the deck exports the inferred
    // one, and the import applies its canonical surface parameters.
    const material = inferInterfaceStyle(resolveWorkspaceAppearance(source.preferences));
    const style = resolveInterfaceStyle(material);
    expect(next.preferences.appearance).toMatchObject({
      colorMode: "dark",
      accentHue: 60,
      interfaceStyle: material,
      surfaceOpacity: style.surfaceOpacity,
      blurPx: style.blurPx,
      radiusPx: style.radiusPx,
    });
  });
});
