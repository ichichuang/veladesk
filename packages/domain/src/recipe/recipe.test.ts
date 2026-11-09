import { describe, expect, it } from "vitest";

import { addAppToPage } from "../editing";
import { createEmptyWorkspace } from "../workspace";
import type { WorkspaceSnapshot } from "../types";
import { exportRecipe, importRecipe, migrateRecipe } from "./recipe";
import { RECIPE_FILE_EXTENSION, RECIPE_FORMAT_IDENTITY, RECIPE_VERSION } from "./types";

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
      mode: "system",
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
            wallpaper: { kind: "asset" as const, assetId: "asset-sha256-general", fit: "cover" as const, position: "center" as const },
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
      light: "asset:asset-sha256-general",
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
          wallpaper: { dark: "asset:asset-sha256-night" },
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
      dark: "asset:asset-sha256-night",
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
          wallpaper: { light: "preset:dawn", dark: "asset:asset-sha256-x" },
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
