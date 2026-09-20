import { describe, expect, it } from "vitest";

import {
  DEFAULT_APP_VISUAL_STYLE,
  MAX_ICON_SCALE,
  MIN_ICON_SCALE,
  isValidAppHexColor,
  resolveAppVisualStyle,
  validateAppVisualStyle,
} from "./app-visual";
import { createEmptyWorkspace } from "./workspace";
import { validateWorkspace } from "./validation";
import { replaceApp } from "./editing";
import type { AppShortcut, AppVisualStyle, WorkspaceSnapshot } from "./types";

function makeApp(overrides: Partial<AppShortcut> = {}): AppShortcut {
  return {
    kind: "app",
    id: "app-1",
    name: "GitHub",
    url: "https://github.com",
    icon: { kind: "generated", text: "GI" },
    openMode: "new-tab",
    tags: [],
    ...overrides,
  };
}

/** An otherwise-valid workspace whose only entity is this app. */
function workspaceWith(app: AppShortcut): WorkspaceSnapshot {
  const empty = createEmptyWorkspace({
    workspaceId: "ws",
    workspaceName: "WS",
    pageId: "page-1",
    pageName: "Home",
    grid: { columns: 8, rows: 6 },
  });
  return { ...empty, entities: [app] };
}

describe("DEFAULT_APP_VISUAL_STYLE", () => {
  it("is the exact Task016 default contract", () => {
    expect(DEFAULT_APP_VISUAL_STYLE).toEqual({
      iconScale: 1,
      decorationStyle: "gradient",
    });
  });

  it("has no persisted colors (auto stays undefined, not a default hex)", () => {
    expect("foregroundColor" in DEFAULT_APP_VISUAL_STYLE).toBe(false);
    expect("decorationColor" in DEFAULT_APP_VISUAL_STYLE).toBe(false);
  });

  it("is semantically valid", () => {
    expect(validateAppVisualStyle(DEFAULT_APP_VISUAL_STYLE)).toEqual([]);
  });
});

describe("resolveAppVisualStyle", () => {
  it("resolves a legacy app without visual to the exact defaults", () => {
    const resolved = resolveAppVisualStyle(makeApp());

    expect(resolved).toEqual(DEFAULT_APP_VISUAL_STYLE);
  });

  it("keeps an explicit visual verbatim (same reference, no copy)", () => {
    const visual: AppVisualStyle = {
      iconScale: 1.15,
      decorationStyle: "glass",
      foregroundColor: "#aabbcc",
    };
    const app = makeApp({ visual });

    expect(resolveAppVisualStyle(app)).toBe(visual);
  });

  it("never mutates the input app", () => {
    const app = makeApp();
    resolveAppVisualStyle(app);

    expect("visual" in app).toBe(false);
  });
});

describe("validateAppVisualStyle: iconScale", () => {
  it("accepts the exact boundaries 0.5 and 1.6", () => {
    expect(validateAppVisualStyle({ iconScale: MIN_ICON_SCALE, decorationStyle: "solid" })).toEqual([]);
    expect(validateAppVisualStyle({ iconScale: MAX_ICON_SCALE, decorationStyle: "solid" })).toEqual([]);
  });

  it("accepts interior values", () => {
    expect(validateAppVisualStyle({ iconScale: 1, decorationStyle: "gradient" })).toEqual([]);
    expect(validateAppVisualStyle({ iconScale: 1.15, decorationStyle: "glass" })).toEqual([]);
  });

  it("reports below-minimum and above-maximum scales", () => {
    expect(validateAppVisualStyle({ iconScale: 0.49, decorationStyle: "solid" })).toEqual([
      { type: "invalid-icon-scale" },
    ]);
    expect(validateAppVisualStyle({ iconScale: 1.61, decorationStyle: "solid" })).toEqual([
      { type: "invalid-icon-scale" },
    ]);
  });

  it("reports NaN and Infinity as invalid scale", () => {
    expect(validateAppVisualStyle({ iconScale: Number.NaN, decorationStyle: "solid" })).toEqual([
      { type: "invalid-icon-scale" },
    ]);
    expect(
      validateAppVisualStyle({ iconScale: Number.POSITIVE_INFINITY, decorationStyle: "solid" })
    ).toEqual([{ type: "invalid-icon-scale" }]);
  });
});

describe("validateAppVisualStyle: colors", () => {
  it("accepts exact #RRGGBB hex in upper and lower case", () => {
    expect(
      validateAppVisualStyle({
        iconScale: 1,
        decorationStyle: "gradient",
        foregroundColor: "#FF00AA",
        decorationColor: "#00ff7f",
      })
    ).toEqual([]);
  });

  it("reports malformed and non-hex color strings", () => {
    const bad = [
      "FF00AA",
      "#F0A",
      "#FF00AABB",
      "rgb(255, 0, 0)",
      "var(--accent)",
      "url(https://example.invalid)",
      "oklch(0.5 0.1 200)",
      "linear-gradient(red, blue)",
      "red",
      "#GGGGGG",
      "",
    ];
    for (const value of bad) {
      expect(
        validateAppVisualStyle({
          iconScale: 1,
          decorationStyle: "solid",
          foregroundColor: value,
        })
      ).toEqual([{ type: "invalid-foreground-color" }]);
      expect(
        validateAppVisualStyle({
          iconScale: 1,
          decorationStyle: "solid",
          decorationColor: value,
        })
      ).toEqual([{ type: "invalid-decoration-color" }]);
    }
  });

  it("reports all issues in deterministic order", () => {
    expect(
      validateAppVisualStyle({
        iconScale: 9,
        decorationStyle: "glass",
        foregroundColor: "nope",
        decorationColor: "also-nope",
      })
    ).toEqual([
      { type: "invalid-icon-scale" },
      { type: "invalid-foreground-color" },
      { type: "invalid-decoration-color" },
    ]);
  });
});

describe("isValidAppHexColor", () => {
  it("accepts exactly #RRGGBB", () => {
    expect(isValidAppHexColor("#000000")).toBe(true);
    expect(isValidAppHexColor("#FFFFFF")).toBe(true);
    expect(isValidAppHexColor("#A1b2C3")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isValidAppHexColor("white")).toBe(false);
    expect(isValidAppHexColor("#FFF")).toBe(false);
    expect(isValidAppHexColor("#A1B2C34")).toBe(false);
    expect(isValidAppHexColor(" #A1B2C3")).toBe(false);
  });
});

describe("validateAppVisualStyle: decoration styles", () => {
  it("accepts all four decoration styles", () => {
    for (const decorationStyle of ["gradient", "solid", "glass", "none"] as const) {
      expect(validateAppVisualStyle({ iconScale: 1, decorationStyle })).toEqual([]);
    }
  });
});

describe("validateWorkspace integration", () => {
  it("accepts a legacy app with no visual", () => {
    expect(validateWorkspace(workspaceWith(makeApp()))).toEqual([]);
  });

  it("accepts a valid per-app visual", () => {
    const workspace = workspaceWith(
      makeApp({
        icon: { kind: "iconify", icon: "simple-icons:github" },
        visual: {
          iconScale: 1.3,
          decorationStyle: "glass",
          foregroundColor: "#112233",
          decorationColor: "#445566",
        },
      })
    );

    expect(validateWorkspace(workspace)).toEqual([]);
  });

  it("reports out-of-range scales and bad colors with their owning entity", () => {
    const workspace = workspaceWith(
      makeApp({
        visual: { iconScale: 42, decorationStyle: "solid", decorationColor: "alert('x')" },
      })
    );

    expect(validateWorkspace(workspace)).toEqual([
      {
        type: "invalid-app-visual",
        entityId: "app-1",
        issue: { type: "invalid-icon-scale" },
      },
      {
        type: "invalid-app-visual",
        entityId: "app-1",
        issue: { type: "invalid-decoration-color" },
      },
    ]);
  });

  it("reports no issues for a legacy app even when unrelated defects exist", () => {
    // Missing app url is still reported; the absent visual never adds noise.
    const workspace = workspaceWith(makeApp({ url: "  " }));

    expect(validateWorkspace(workspace)).toEqual([
      { type: "invalid-app-url", appId: "app-1" },
    ]);
  });
});

describe("generated icon source", () => {
  it("accepts an explicit auto source", () => {
    const workspace = workspaceWith(
      makeApp({ icon: { kind: "generated", text: "GI", source: "auto" } })
    );

    expect(validateWorkspace(workspace)).toEqual([]);
  });

  it("accepts a legacy generated icon without a source", () => {
    const workspace = workspaceWith(makeApp({ icon: { kind: "generated", text: "GI" } }));

    expect(validateWorkspace(workspace)).toEqual([]);
  });

  it("accepts a custom source", () => {
    const workspace = workspaceWith(
      makeApp({ icon: { kind: "generated", text: "AI", source: "custom" } })
    );

    expect(validateWorkspace(workspace)).toEqual([]);
  });
});

describe("replaceApp with visual styles", () => {
  it("preserves page, folder and dock placement while swapping the visual", () => {
    const empty = createEmptyWorkspace({
      workspaceId: "ws",
      workspaceName: "WS",
      pageId: "page-1",
      pageName: "Home",
      grid: { columns: 8, rows: 6 },
    });
    const placed = {
      ...empty,
      entities: [makeApp({ id: "app-1", name: "Mail", url: "mailto:hi@example.com" })],
      dock: { items: ["app-1"] },
      pages: [
        {
          id: "page-1",
          name: "Home",
          layout: {
            id: "page-1",
            grid: { columns: 8, rows: 6 },
            items: [
              { id: "app-1", position: { column: 2, row: 3 }, span: { columns: 1, rows: 1 } },
            ],
          },
        },
      ],
    };
    const existing = placed.entities[0]!;
    const result = replaceApp(placed, {
      ...existing,
      icon: { kind: "iconify", icon: "lucide:mail" },
      visual: { iconScale: 1.2, decorationStyle: "solid", decorationColor: "#3366FF" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // Page placement untouched.
    expect(result.workspace.pages[0]!.layout.items).toEqual([
      { id: "app-1", position: { column: 2, row: 3 }, span: { columns: 1, rows: 1 } },
    ]);
    // Dock pin untouched, entity order preserved.
    expect(result.workspace.dock.items).toEqual(["app-1"]);
    expect(result.workspace.entities.map((entity) => entity.id)).toEqual(["app-1"]);
    // New visual carried verbatim.
    const next = result.workspace.entities[0]!;
    expect(next.kind === "app" ? next.visual : undefined).toEqual({
      iconScale: 1.2,
      decorationStyle: "solid",
      decorationColor: "#3366FF",
    });
  });

  it("keeps an existing visual when the edit changes only name/url", () => {
    const workspace = workspaceWith(
      makeApp({
        visual: { iconScale: 0.75, decorationStyle: "none" },
      })
    );
    const existing = workspace.entities[0]!;
    if (existing.kind !== "app") {
      throw new Error("fixture must hold an app");
    }
    const result = replaceApp(workspace, { ...existing, name: "GitHub Next" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const next = result.workspace.entities[0]!;
    expect(next.kind === "app" ? next.visual : undefined).toEqual({
      iconScale: 0.75,
      decorationStyle: "none",
    });
  });
});
