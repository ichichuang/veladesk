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
        tiles: [
          {
            id: "app-1",
            name: "GitHub",
            url: "https://github.com/",
            icon: "simple-icons:github",
            openMode: "new-tab",
          },
          {
            id: "app-2",
            name: "Wiki",
            url: "http://wiki.internal/",
            // favicon icons are private/auto — no icon field.
            openMode: "same-tab",
          },
        ],
      },
    ]);
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
