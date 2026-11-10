import { describe, expect, it } from "vitest";

import { DEFAULT_WORKSPACE_APPEARANCE } from "../appearance";
import { addAppToPage } from "../editing";
import { createEmptyWorkspace } from "../workspace";
import type { DesktopPage, WorkspaceSnapshot } from "../types";
import type { WallpaperConfig } from "../wallpaper";
import { exportRecipe, importRecipe, migrateRecipe } from "./recipe";
import type { RecipeV1 } from "./types";
import {
  RECIPE_FILE_EXTENSION,
  RECIPE_FORMAT_IDENTITY,
  RECIPE_MAX_ASSETS,
  RECIPE_MAX_GRID_COLUMNS,
  RECIPE_MAX_GRID_ROWS,
  RECIPE_VERSION,
} from "./types";

/** Real-format content asset ids (asset-sha256- + 64 lowercase hex). */
const GENERAL_ID = `asset-sha256-${"a".repeat(64)}`;
const NIGHT_ID = `asset-sha256-${"b".repeat(64)}`;
const X_ID = `asset-sha256-${"c".repeat(64)}`;

function baseWorkspace(): WorkspaceSnapshot {
  return createEmptyWorkspace({
    workspaceId: "workspace-1",
    workspaceName: "My Desk",
    pageId: "page-1",
    pageName: "Home",
    grid: { columns: 10, rows: 6 },
  });
}

function withApps(workspace: WorkspaceSnapshot): WorkspaceSnapshot {
  let current = workspace;
  for (const app of [
    {
      kind: "app" as const,
      id: "app-1",
      name: "GitHub",
      url: "https://github.com/",
      icon: { kind: "iconify" as const, icon: "simple-icons:github" },
      openMode: "new-tab" as const,
      tags: [],
    },
    {
      kind: "app" as const,
      id: "app-2",
      name: "Wiki",
      url: "http://wiki.internal/",
      icon: { kind: "favicon" as const },
      openMode: "same-tab" as const,
      tags: [],
    },
  ]) {
    const result = addAppToPage(current, "page-1", app);
    if (!result.ok) {
      throw new Error(`fixture addAppToPage failed: ${result.reason}`);
    }
    current = result.workspace;
  }
  return current;
}

describe("exportRecipe", () => {
  it("projects the public theme from the persisted appearance", () => {
    const recipe = exportRecipe(baseWorkspace(), {
      createdAt: "2026-11-09T00:00:00.000Z",
      appMinVersion: "1.2.0",
    });

    expect(recipe.format).toBe("vela.recipe");
    expect(recipe.version).toBe(1);
    expect(recipe.createdAt).toBe("2026-11-09T00:00:00.000Z");
    expect(recipe.app).toEqual({ minVersion: "1.2.0" });
    // No persisted interfaceStyle → the nearest preset is inferred.
    expect(recipe.theme).toEqual({
      mode: "dark",
      accent: 60,
      material: "glass",
    });
    expect(recipe.plugins).toEqual([]);
  });

  it("carries the persisted motion experiments (helmMotion) verbatim", () => {
    const workspace = withApps(baseWorkspace());
    const withMotion = {
      ...workspace,
      preferences: {
        ...workspace.preferences,
        motion: { reducedMotion: "on" as const, experiments: { helmMotion: true } },
      },
    };
    const recipe = exportRecipe(withMotion, { createdAt: "2026-11-09T00:00:00.000Z" });

    expect(recipe.motion).toEqual({
      reducedMotion: "on",
      experiments: { helmMotion: true },
    });
    // Absent motion preferences stay absent — no invented defaults.
    expect(
      exportRecipe(workspace, { createdAt: "2026-11-09T00:00:00.000Z" }).motion
    ).toBeUndefined();
  });

  it("exports page-placed apps as public tiles and skips non-app entities", () => {
    const recipe = exportRecipe(withApps(baseWorkspace()), {
      createdAt: "2026-11-09T00:00:00.000Z",
    });

    expect(recipe.spaces).toEqual([
      {
        id: "page-1",
        name: "Home",
        layout: "grid",
        layoutMode: "snap",
        grid: { columns: 10, rows: 6 },
        tiles: [
          {
            id: "app-1",
            name: "GitHub",
            url: "https://github.com/",
            icon: "simple-icons:github",
            openMode: "new-tab",
            placement: "snap",
            x: 0,
            y: 0,
            w: 1,
            h: 1,
          },
          {
            id: "app-2",
            name: "Wiki",
            url: "http://wiki.internal/",
            // favicon icons are private/auto — no icon field.
            openMode: "same-tab",
            placement: "snap",
            x: 1,
            y: 0,
            w: 1,
            h: 1,
          },
        ],
      },
    ]);
  });

  it("exports freeform geometry as relative 0-1 fractions with layoutMode free", () => {
    const workspace = withApps(baseWorkspace());
    const freeform = workspace.pages.map((page) =>
      page.id === "page-1"
        ? {
            ...page,
            canvas: {
              version: 2 as const,
              mode: "freeform" as const,
              items: [
                { id: "app-1", rect: { x: 0, y: 0, width: 2000, height: 1000 } },
                { id: "app-2", rect: { x: 2500, y: 500, width: 3333, height: 6667 } },
              ],
            },
            layout: { ...page.layout, items: [] },
          }
        : page
    );
    const recipe = exportRecipe(
      { ...workspace, pages: freeform },
      { createdAt: "2026-11-09T00:00:00.000Z" }
    );

    expect(recipe.spaces[0]?.layoutMode).toBe("free");
    expect(recipe.spaces[0]?.tiles).toEqual([
      {
        id: "app-1",
        name: "GitHub",
        url: "https://github.com/",
        icon: "simple-icons:github",
        openMode: "new-tab",
        placement: "free",
        x: 0,
        y: 0,
        w: 0.2,
        h: 0.1,
      },
      {
        id: "app-2",
        name: "Wiki",
        url: "http://wiki.internal/",
        openMode: "same-tab",
        placement: "free",
        x: 0.25,
        y: 0.05,
        w: 0.3333,
        h: 0.6667,
      },
    ]);
  });

  it("exports per-mode wallpaper refs with the general upload as fallback", () => {
    const workspace = withApps(baseWorkspace());
    const pages = workspace.pages.map((page) =>
      page.id === "page-1"
        ? {
            ...page,
            wallpaper: { kind: "asset" as const, assetId: GENERAL_ID, fit: "cover" as const, position: "center" as const },
            wallpaperByMode: {
              dark: { kind: "preset" as const, presetId: "midnight" as const },
            },
          }
        : page
    );
    const recipe = exportRecipe(
      { ...workspace, pages },
      { createdAt: "2026-11-09T00:00:00.000Z" }
    );

    expect(recipe.spaces[0]?.wallpaper).toEqual({
      light: `asset:${GENERAL_ID}`,
      dark: "preset:midnight",
    });
  });

  it("exports a mode-agnostic wallpaper as both modes", () => {
    const workspace = withApps(baseWorkspace());
    const pages = workspace.pages.map((page) =>
      page.id === "page-1"
        ? {
            ...page,
            wallpaper: { kind: "preset" as const, presetId: "mist" as const },
          }
        : page
    );
    const recipe = exportRecipe(
      { ...workspace, pages },
      { createdAt: "2026-11-09T00:00:00.000Z" }
    );

    expect(recipe.spaces[0]?.wallpaper).toEqual({
      light: "preset:mist",
      dark: "preset:mist",
    });
  });

  it("labels freeform-canvas spaces as canvas", () => {
    const workspace = withApps(baseWorkspace());
    const freeform = workspace.pages.map((page) =>
      page.id === "page-1"
        ? {
            ...page,
            canvas: {
              version: 2 as const,
              mode: "freeform" as const,
              items: [{ id: "app-1", rect: { x: 0, y: 0, width: 20, height: 10 } }],
            },
            layout: { ...page.layout, items: [] },
          }
        : page
    );
    const recipe = exportRecipe(
      { ...workspace, pages: freeform },
      { createdAt: "2026-11-09T00:00:00.000Z" }
    );

    expect(recipe.spaces[0]?.layout).toBe("canvas");
    expect(recipe.spaces[0]?.layoutMode).toBe("free");
    expect(recipe.spaces[0]?.tiles.map((tile) => tile.name)).toEqual(["GitHub"]);
  });

  it("is pure — equal fresh output, input untouched", () => {
    const workspace = withApps(baseWorkspace());
    const a = exportRecipe(workspace, { createdAt: "t" });
    const b = exportRecipe(workspace, { createdAt: "t" });
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(workspace.preferences.appearance?.accentHue).toBe(60);
  });
});

describe("importRecipe", () => {
  it("distills sections/apps and carries theme + motion for the caller", () => {
    const workspace = withApps(baseWorkspace());
    const withMotion = {
      ...workspace,
      preferences: {
        ...workspace.preferences,
        motion: { experiments: { helmMotion: true } },
      },
    };
    const recipe = exportRecipe(withMotion, { createdAt: "t" });
    const payload = importRecipe(recipe);

    expect(payload.sections).toEqual([
      {
        name: "Home",
        apps: [
          { name: "GitHub", url: "https://github.com/" },
          { name: "Wiki", url: "http://wiki.internal/" },
        ],
      },
    ]);
    expect(payload.theme).toBe(recipe.theme);
    expect(payload.motion).toEqual({ experiments: { helmMotion: true } });
  });
});

describe("migrateRecipe", () => {
  it("passes a v1 recipe through with unknown fields preserved", () => {
    const source = {
      format: "vela.recipe",
      version: 1,
      createdAt: "t",
      spaces: [{ name: "Home", layout: "grid", tiles: [{ name: "A", url: "https://a/" }] }],
      plugins: [],
      futureField: { nested: true },
    };
    const result = migrateRecipe(source);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.migratedFromLegacy).toBe(false);
    expect(result.recipe).toEqual({ ...source });
    expect((result.recipe as unknown as Record<string, unknown>).futureField).toEqual({
      nested: true,
    });
  });

  it("round-trips an export through JSON with the .deck.json shape intact", () => {
    const recipe = exportRecipe(withApps(baseWorkspace()), { createdAt: "t" });
    const parsed = JSON.parse(JSON.stringify(recipe)) as unknown;
    const result = migrateRecipe(parsed);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(importRecipe(result.recipe).sections).toHaveLength(1);
    expect(RECIPE_FORMAT_IDENTITY).toBe("vela.recipe");
    expect(RECIPE_VERSION).toBe(1);
    expect(RECIPE_FILE_EXTENSION).toBe(".deck.json");
  });

  it("rejects versions newer than known — never best-effort", () => {
    const result = migrateRecipe({
      format: "vela.recipe",
      version: RECIPE_VERSION + 1,
      spaces: [],
      plugins: [],
    });
    expect(result).toEqual({
      ok: false,
      issue: { type: "unsupported-version", version: 2 },
    });
  });

  it("migrates an early-v1 singular wallpaperRef into the per-mode wallpaper, in place", () => {
    const source = {
      format: "vela.recipe",
      version: 1,
      spaces: [{ name: "Home", layout: "grid", wallpaperRef: "preset:mist", tiles: [] }],
      plugins: [],
    };
    const result = migrateRecipe(source);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.recipe.spaces[0]?.wallpaper).toEqual({
      light: "preset:mist",
      dark: "preset:mist",
    });
    // The legacy field is gone from the migrated copy…
    expect(
      (result.recipe.spaces[0] as unknown as Record<string, unknown>).wallpaperRef
    ).toBeUndefined();
    // …and the source document is never mutated.
    expect(source.spaces[0]?.wallpaperRef).toBe("preset:mist");
  });

  it("keeps explicit per-mode refs over the migrated singular one", () => {
    const result = migrateRecipe({
      format: "vela.recipe",
      version: 1,
      spaces: [
        {
          name: "Home",
          layout: "grid",
          wallpaperRef: "preset:mist",
          wallpaper: { dark: `asset:${NIGHT_ID}` },
          tiles: [],
        },
      ],
      plugins: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.recipe.spaces[0]?.wallpaper).toEqual({
      light: "preset:mist",
      dark: `asset:${NIGHT_ID}`,
    });
  });

  it("accepts the P1 layout fields when they are structurally sound", () => {
    const result = migrateRecipe({
      format: "vela.recipe",
      version: 1,
      spaces: [
        {
          name: "Home",
          layout: "grid",
          layoutMode: "free",
          wallpaper: { light: "preset:dawn", dark: `asset:${X_ID}` },
          tiles: [
            { name: "A", url: "https://a/", placement: "free", x: 0.25, y: 0.5, w: 0.2, h: 0.1 },
            { name: "B", url: "https://b/", placement: "snap", x: 0, y: 2, w: 2, h: 1 },
          ],
        },
      ],
      plugins: [],
    });

    expect(result.ok).toBe(true);
  });

  it("rejects structurally broken P1 fields with a JSON path", () => {
    expect(
      migrateRecipe({
        format: "vela.recipe",
        version: 1,
        spaces: [{ name: "H", layout: "grid", layoutMode: "tidal", tiles: [] }],
        plugins: [],
      })
    ).toEqual({ ok: false, issue: { type: "invalid-recipe", path: "spaces[0].layoutMode" } });
    expect(
      migrateRecipe({
        format: "vela.recipe",
        version: 1,
        spaces: [{ name: "H", layout: "grid", wallpaper: { light: 7 }, tiles: [] }],
        plugins: [],
      })
    ).toEqual({ ok: false, issue: { type: "invalid-recipe", path: "spaces[0].wallpaper.light" } });
    expect(
      migrateRecipe({
        format: "vela.recipe",
        version: 1,
        spaces: [
          { name: "H", layout: "grid", tiles: [{ name: "A", url: "https://a/", placement: "wet" }] },
        ],
        plugins: [],
      })
    ).toEqual({ ok: false, issue: { type: "invalid-recipe", path: "spaces[0].tiles[0].placement" } });
    // snap geometry must be safe integers with spans >= 1 …
    expect(
      migrateRecipe({
        format: "vela.recipe",
        version: 1,
        spaces: [
          { name: "H", layout: "grid", tiles: [{ name: "A", url: "https://a/", placement: "snap", x: 0, y: 0, w: 1.5, h: 1 }] },
        ],
        plugins: [],
      })
    ).toEqual({ ok: false, issue: { type: "invalid-recipe", path: "spaces[0].tiles[0].w" } });
    // … and free geometry must stay inside the 0-1 canvas.
    expect(
      migrateRecipe({
        format: "vela.recipe",
        version: 1,
        spaces: [
          { name: "H", layout: "grid", tiles: [{ name: "A", url: "https://a/", placement: "free", x: 1.2, y: 0, w: 0.2, h: 0.2 }] },
        ],
        plugins: [],
      })
    ).toEqual({ ok: false, issue: { type: "invalid-recipe", path: "spaces[0].tiles[0].x" } });
  });

  it("reports the first structural defect with a JSON path", () => {
    expect(
      migrateRecipe({ format: "vela.recipe", version: 1, spaces: "no", plugins: [] })
    ).toEqual({ ok: false, issue: { type: "invalid-recipe", path: "spaces" } });
    expect(
      migrateRecipe({
        format: "vela.recipe",
        version: 1,
        spaces: [{ name: "Home", layout: "spiral", tiles: [] }],
        plugins: [],
      })
    ).toEqual({
      ok: false,
      issue: { type: "invalid-recipe", path: "spaces[0].layout" },
    });
    expect(
      migrateRecipe({
        format: "vela.recipe",
        version: 1,
        spaces: [{ name: "Home", tiles: [{ name: "A" }] }],
        plugins: [],
      })
    ).toEqual({
      ok: false,
      issue: { type: "invalid-recipe", path: "spaces[0].tiles[0]" },
    });
  });

  it("migrates a legacy veladesk-import v1 document up to a recipe", () => {
    const legacy = {
      format: "veladesk-import",
      version: 1,
      sections: [
        {
          name: "办公",
          apps: [
            { name: "GitHub", url: "https://github.com/", icon: "auto" },
            { name: "Notion", url: "https://www.notion.so/" },
          ],
        },
        { name: "AI", apps: [] },
      ],
    };
    const result = migrateRecipe(legacy);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.migratedFromLegacy).toBe(true);
    expect(result.recipe.format).toBe("vela.recipe");
    expect(result.recipe.version).toBe(1);
    expect(result.recipe.theme).toBeUndefined();
    expect(result.recipe.motion).toBeUndefined();
    expect(result.recipe.spaces).toEqual([
      {
        name: "办公",
        layout: "grid",
        tiles: [
          { name: "GitHub", url: "https://github.com/" },
          { name: "Notion", url: "https://www.notion.so/" },
        ],
      },
      { name: "AI", layout: "grid", tiles: [] },
    ]);
    // The legacy source is never mutated.
    expect(legacy.sections[0]?.apps[0]).toEqual({
      name: "GitHub",
      url: "https://github.com/",
      icon: "auto",
    });
  });

  it("rejects legacy documents from a newer version", () => {
    expect(migrateRecipe({ format: "veladesk-import", version: 2, sections: [] })).toEqual({
      ok: false,
      issue: { type: "unsupported-version", version: 2 },
    });
  });

  it("leaves every other document to the caller's own format path", () => {
    for (const input of [null, 42, "text", {}, { format: "something-else", version: 1 }]) {
      expect(migrateRecipe(input)).toEqual({ ok: false, issue: { type: "not-a-recipe" } });
    }
  });
});

// --- A: strict references, grid, assets, full import payload -----------------

function recipeWith(overrides: Record<string, unknown> = {}, space: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: "vela.recipe",
    version: 1,
    spaces: [{ name: "Home", layout: "grid", tiles: [], ...space }],
    plugins: [],
    ...overrides,
  };
}

function pathOf(input: unknown): string | null {
  const result = migrateRecipe(input);
  if (result.ok) return null;
  return result.issue.type === "invalid-recipe" ? result.issue.path : result.issue.type;
}

const PNG_BASE64 = "iVBORw0KGgo=";

describe("migrateRecipe strict wallpaper refs (presets + content asset ids)", () => {
  it.each(["preset:aurora", "preset:midnight", "preset:dawn", "preset:mist", `asset:${GENERAL_ID}`])(
    "accepts %s in a space, the legacy wallpaperRef and theme.wallpaper",
    (ref) => {
      expect(pathOf(recipeWith({}, { wallpaper: { light: ref, dark: ref } }))).toBeNull();
      expect(pathOf(recipeWith({}, { wallpaperRef: ref }))).toBeNull();
      expect(
        pathOf(recipeWith({ theme: { mode: "dark", accent: 200, material: "glass", wallpaper: { dark: ref } } })),
      ).toBeNull();
    },
  );

  it.each([
    "preset:sunset",
    "preset:",
    "Preset:dawn",
    "preset:Dawn",
    "dawn",
    "",
    "asset:",
    "asset:asset-1",
    "asset:asset-sha256-general",
    `asset:asset-sha256-${"a".repeat(63)}`,
    `asset:asset-sha256-${"a".repeat(65)}`,
    `asset:asset-sha256-${"A".repeat(64)}`,
    "asset:sha256:abc",
    "https://example.com/wall.png",
  ])("rejects %j with the ref's JSON path", (ref) => {
    expect(pathOf(recipeWith({}, { wallpaper: { light: ref } }))).toBe("spaces[0].wallpaper.light");
    expect(pathOf(recipeWith({}, { wallpaperRef: ref }))).toBe("spaces[0].wallpaperRef");
    expect(
      pathOf(recipeWith({ theme: { mode: "light", accent: 1, material: "clean", wallpaper: { dark: ref } } })),
    ).toBe("theme.wallpaper.dark");
  });

  it("rejects non-string refs and a non-object theme.wallpaper", () => {
    expect(pathOf(recipeWith({}, { wallpaper: { dark: 3 } }))).toBe("spaces[0].wallpaper.dark");
    expect(pathOf(recipeWith({ theme: { mode: "light", accent: 1, material: "clean", wallpaper: "preset:dawn" } }))).toBe(
      "theme.wallpaper",
    );
  });
});

describe("migrateRecipe space.grid", () => {
  it.each([
    { columns: 1, rows: 1 },
    { columns: 10, rows: 6 },
    { columns: RECIPE_MAX_GRID_COLUMNS, rows: RECIPE_MAX_GRID_ROWS },
  ])("accepts %j", (grid) => {
    expect(pathOf(recipeWith({}, { grid }))).toBeNull();
  });

  it.each([
    [{ columns: 0, rows: 6 }, "grid.columns"],
    [{ columns: -1, rows: 6 }, "grid.columns"],
    [{ columns: 1.5, rows: 6 }, "grid.columns"],
    [{ columns: "10", rows: 6 }, "grid.columns"],
    [{ columns: RECIPE_MAX_GRID_COLUMNS + 1, rows: 6 }, "grid.columns"],
    [{ columns: 10 }, "grid.rows"],
    [{ columns: 10, rows: 0 }, "grid.rows"],
    [{ columns: 10, rows: RECIPE_MAX_GRID_ROWS + 1 }, "grid.rows"],
    [{ columns: 10, rows: Number.NaN }, "grid.rows"],
    [[10, 6], "grid"],
    [null, "grid"],
  ])("rejects %j at spaces[0].%s", (grid, path) => {
    expect(pathOf(recipeWith({}, { grid }))).toBe(`spaces[0].${path}`);
  });
});

describe("migrateRecipe assets (syntax only)", () => {
  const referencing = { wallpaper: { light: `asset:${GENERAL_ID}` } };

  it("accepts a referenced asset of every allowed media type", () => {
    for (const mediaType of ["image/png", "image/jpeg", "image/webp", "image/avif"]) {
      expect(pathOf(recipeWith({ assets: { [GENERAL_ID]: { mediaType, data: PNG_BASE64 } } }, referencing))).toBeNull();
    }
  });

  it("counts references from the legacy wallpaperRef and theme.wallpaper too", () => {
    expect(
      pathOf(recipeWith({ assets: { [GENERAL_ID]: { mediaType: "image/png", data: PNG_BASE64 } } }, { wallpaperRef: `asset:${GENERAL_ID}` })),
    ).toBeNull();
    expect(
      pathOf(
        recipeWith({
          theme: { mode: "dark", accent: 1, material: "soft", wallpaper: { dark: `asset:${NIGHT_ID}` } },
          assets: { [NIGHT_ID]: { mediaType: "image/webp", data: "AAAA" } },
        }),
      ),
    ).toBeNull();
  });

  it.each(["image/svg+xml", "image/gif", "text/html", "IMAGE/PNG", "", 1, undefined])(
    "rejects mediaType %j",
    (mediaType) => {
      expect(pathOf(recipeWith({ assets: { [GENERAL_ID]: { mediaType, data: PNG_BASE64 } } }, referencing))).toBe(
        `assets.${GENERAL_ID}.mediaType`,
      );
    },
  );

  it("rejects an unreferenced key, a malformed key and a non-object entry with assets.<key>", () => {
    expect(pathOf(recipeWith({ assets: { [NIGHT_ID]: { mediaType: "image/png", data: PNG_BASE64 } } }, referencing))).toBe(
      `assets.${NIGHT_ID}`,
    );
    expect(pathOf(recipeWith({ assets: { "asset-1": { mediaType: "image/png", data: PNG_BASE64 } } }, referencing))).toBe(
      "assets.asset-1",
    );
    expect(pathOf(recipeWith({ assets: { [GENERAL_ID]: "iVBORw0KGgo=" } }, referencing))).toBe(`assets.${GENERAL_ID}`);
    // A recipe with NO asset refs at all cannot carry any asset.
    expect(pathOf(recipeWith({ assets: { [GENERAL_ID]: { mediaType: "image/png", data: PNG_BASE64 } } }))).toBe(
      `assets.${GENERAL_ID}`,
    );
  });

  it(`rejects more than ${RECIPE_MAX_ASSETS} assets, even when all are referenced`, () => {
    const ids = Array.from({ length: RECIPE_MAX_ASSETS + 1 }, (_, i) => `asset-sha256-${i.toString(16).padStart(64, "0")}`);
    const spaces = ids.map((id, i) => ({ name: `S${i}`, layout: "grid", wallpaper: { light: `asset:${id}` }, tiles: [] }));
    const assets = Object.fromEntries(ids.map((id) => [id, { mediaType: "image/png", data: PNG_BASE64 }]));
    expect(pathOf({ format: "vela.recipe", version: 1, spaces, plugins: [], assets })).toBe("assets");
    const atCap = Object.fromEntries(ids.slice(0, RECIPE_MAX_ASSETS).map((id) => [id, assets[id]]));
    expect(pathOf({ format: "vela.recipe", version: 1, spaces, plugins: [], assets: atCap })).toBeNull();
  });

  it.each([
    "",
    "abc",
    "ab$=",
    "====",
    "A===",
    "iVBORw0KGgo",
    "iVBO Rw0K",
    "data:image/png;base64,iVBORw0KGgo=",
    "iVBORw0KGgo=\n",
  ])("rejects base64 data %j", (data) => {
    expect(pathOf(recipeWith({ assets: { [GENERAL_ID]: { mediaType: "image/png", data } } }, referencing))).toBe(
      `assets.${GENERAL_ID}.data`,
    );
  });

  it("rejects non-string data, an over-budget payload, and a non-object assets map", () => {
    expect(pathOf(recipeWith({ assets: { [GENERAL_ID]: { mediaType: "image/png", data: 42 } } }, referencing))).toBe(
      `assets.${GENERAL_ID}.data`,
    );
    const tooLong = "A".repeat(Math.ceil((4 * 1024 * 1024) / 3) * 4 + 4);
    expect(pathOf(recipeWith({ assets: { [GENERAL_ID]: { mediaType: "image/png", data: tooLong } } }, referencing))).toBe(
      `assets.${GENERAL_ID}.data`,
    );
    expect(pathOf(recipeWith({ assets: [] }, referencing))).toBe("assets");
    expect(pathOf(recipeWith({ assets: "x" }, referencing))).toBe("assets");
  });
});

describe("old recipe files stay valid", () => {
  it("a v1 document without any of the new fields passes with its unknown fields preserved", () => {
    const old = {
      format: "vela.recipe",
      version: 1,
      createdAt: "2026-10-01T00:00:00.000Z",
      theme: { mode: "system", accent: 250, material: "soft" },
      spaces: [
        {
          name: "Home",
          layout: "grid",
          wallpaperRef: "preset:mist",
          note: "space extra",
          tiles: [{ name: "A", url: "https://a/" }],
        },
      ],
      plugins: [],
      futureTopLevel: { keep: true },
    };
    const result = migrateRecipe(old);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const recipe = result.recipe as unknown as Record<string, unknown>;
    expect(recipe.futureTopLevel).toEqual({ keep: true });
    expect((result.recipe.spaces[0] as unknown as Record<string, unknown>).note).toBe("space extra");
    const payload = importRecipe(result.recipe);
    expect(payload.assets).toBeUndefined();
    expect(payload.spaces).toEqual([
      {
        name: "Home",
        layoutMode: "snap",
        grid: undefined,
        wallpaper: { light: "preset:mist", dark: "preset:mist" },
        tiles: [{ name: "A", url: "https://a/" }],
      },
    ]);
  });
});

describe("importRecipe full structure", () => {
  it("carries every space's layoutMode, grid, wallpapers and tile geometry, plus theme/motion/assets", () => {
    const source = {
      format: "vela.recipe",
      version: 1,
      theme: { mode: "dark", accent: 120, material: "glass", wallpaper: { light: "preset:dawn", dark: `asset:${NIGHT_ID}` } },
      motion: { reducedMotion: "never", experiments: { helmMotion: false } },
      spaces: [
        {
          name: "Free",
          layout: "canvas",
          layoutMode: "free",
          grid: { columns: 8, rows: 5 },
          wallpaper: { light: `asset:${GENERAL_ID}` },
          tiles: [
            { id: "t1", name: "A", url: "https://a/", icon: "mdi:a", openMode: "same-tab", placement: "free", x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
          ],
        },
        { name: "Snap", layout: "grid", tiles: [{ name: "B", url: "https://b/", placement: "snap", x: 1, y: 2, w: 2, h: 1 }] },
      ],
      plugins: [],
      assets: {
        [GENERAL_ID]: { mediaType: "image/png", data: PNG_BASE64 },
        [NIGHT_ID]: { mediaType: "image/jpeg", data: "/9j/" },
      },
    };
    const migrated = migrateRecipe(source);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    const payload = importRecipe(migrated.recipe);
    expect(payload.theme).toEqual(source.theme);
    expect(payload.motion).toEqual(source.motion);
    expect(payload.assets).toEqual(source.assets);
    expect(payload.spaces).toEqual([
      {
        name: "Free",
        layoutMode: "free",
        grid: { columns: 8, rows: 5 },
        wallpaper: { light: `asset:${GENERAL_ID}` },
        tiles: [
          { name: "A", url: "https://a/", icon: "mdi:a", openMode: "same-tab", placement: "free", x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
        ],
      },
      {
        name: "Snap",
        layoutMode: "snap",
        grid: undefined,
        wallpaper: undefined,
        tiles: [{ name: "B", url: "https://b/", placement: "snap", x: 1, y: 2, w: 2, h: 1 }],
      },
    ]);
    // The legacy sections projection is unchanged.
    expect(payload.sections).toEqual([
      { name: "Free", apps: [{ name: "A", url: "https://a/" }] },
      { name: "Snap", apps: [{ name: "B", url: "https://b/" }] },
    ]);
  });
});

describe("export → JSON → migrate → import round trip", () => {
  function decorated(
    overrides: {
      pageWallpaper?: WallpaperConfig;
      byMode?: NonNullable<DesktopPage["wallpaperByMode"]>;
      workspaceWallpaper?: WallpaperConfig;
    } = {},
  ): WorkspaceSnapshot {
    const workspace = withApps(baseWorkspace());
    return {
      ...workspace,
      preferences: {
        ...workspace.preferences,
        appearance: {
          ...DEFAULT_WORKSPACE_APPEARANCE,
          interfaceStyle: "glass",
          ...(overrides.workspaceWallpaper !== undefined ? { wallpaper: overrides.workspaceWallpaper } : {}),
        },
      },
      pages: workspace.pages.map((page) => ({
        ...page,
        ...(overrides.pageWallpaper !== undefined ? { wallpaper: overrides.pageWallpaper } : {}),
        ...(overrides.byMode !== undefined ? { wallpaperByMode: overrides.byMode } : {}),
      })),
    };
  }

  function roundTrip(workspace: WorkspaceSnapshot): { readonly exported: RecipeV1; readonly payload: ReturnType<typeof importRecipe> } {
    const exported = exportRecipe(workspace, { createdAt: "2026-11-09T00:00:00.000Z" });
    const migrated = migrateRecipe(JSON.parse(JSON.stringify(exported)));
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) throw new Error("round trip rejected");
    return { exported, payload: importRecipe(migrated.recipe) };
  }

  it("keeps layoutMode, grid, wallpapers, tile geometry and theme wallpaper intact", () => {
    const { exported, payload } = roundTrip(
      decorated({
        byMode: {
          light: { kind: "preset", presetId: "aurora" },
          dark: { kind: "asset", assetId: NIGHT_ID, fit: "cover", position: "center" },
        },
        workspaceWallpaper: { kind: "asset", assetId: GENERAL_ID, fit: "contain", position: "center" },
      }),
    );
    expect(exported.theme?.wallpaper).toEqual({ light: `asset:${GENERAL_ID}`, dark: `asset:${GENERAL_ID}` });
    expect(payload.theme).toEqual(exported.theme);
    expect(payload.spaces).toEqual(
      exported.spaces.map((space) => ({
        name: space.name,
        layoutMode: space.layoutMode,
        grid: space.grid,
        wallpaper: space.wallpaper,
        tiles: space.tiles.map((tile) => {
          const { id, ...rest } = tile;
          expect(id).toEqual(expect.any(String)); // ids are not part of the payload
          return rest;
        }),
      })),
    );
    expect(payload.spaces[0]).toMatchObject({
      layoutMode: "snap",
      grid: { columns: 10, rows: 6 },
      wallpaper: { light: "preset:aurora", dark: `asset:${NIGHT_ID}` },
    });
    expect(payload.spaces[0]?.tiles[0]).toMatchObject({ placement: "snap", x: expect.any(Number), w: expect.any(Number) });
  });

  it("omits an invalid-format asset ref per mode (no fallback) and still re-imports", () => {
    const { exported, payload } = roundTrip(
      decorated({
        pageWallpaper: { kind: "preset", presetId: "mist" },
        byMode: { dark: { kind: "asset", assetId: "asset-1", fit: "cover", position: "center" } },
        workspaceWallpaper: { kind: "asset", assetId: "selected-wallpaper", fit: "cover", position: "center" },
      }),
    );
    // dark had an override that is not exportable: the mode is OMITTED,
    // never replaced by the general preset; light keeps the general one.
    expect(exported.spaces[0]?.wallpaper).toEqual({ light: "preset:mist" });
    expect(exported.spaces[0]?.wallpaper).not.toHaveProperty("dark");
    expect(payload.spaces[0]?.wallpaper).toEqual({ light: "preset:mist" });
    // theme.wallpaper follows the same rule: an invalid id exports nothing.
    expect(exported.theme).not.toHaveProperty("wallpaper");
    expect(JSON.stringify(exported)).not.toContain("asset-1");
    expect(JSON.stringify(exported)).not.toContain("selected-wallpaper");
  });

  it("omits the whole space wallpaper when every mode is unexportable", () => {
    const { exported } = roundTrip(
      decorated({ pageWallpaper: { kind: "asset", assetId: "a", fit: "cover", position: "center" } }),
    );
    expect(exported.spaces[0]).not.toHaveProperty("wallpaper");
  });
});
