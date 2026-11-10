import { describe, expect, it } from "vitest";

import { adoptRecipeDocument, isRecipeDocument, recipeSpacePreviews } from "./recipe-adapter";
import { deckFilename } from "./recipe-file";
import { parseImportDocument } from "./parser";

/** A minimal valid deck as the export side would produce it. */
const DECK = {
  format: "vela.recipe",
  version: 1,
  createdAt: "2026-11-09T00:00:00.000Z",
  theme: { mode: "dark", accent: 60, material: "glass" },
  motion: { experiments: { helmMotion: false } },
  spaces: [
    {
      id: "page-1",
      name: "办公",
      layout: "grid",
      tiles: [
        { id: "app-1", name: "GitHub", url: "https://github.com/", icon: "simple-icons:github" },
        { name: "Wiki", url: "http://wiki.internal/" },
      ],
    },
  ],
  plugins: [],
};

describe("isRecipeDocument", () => {
  it("recognizes only recipe-format roots", () => {
    expect(isRecipeDocument(DECK)).toBe(true);
    expect(isRecipeDocument({ format: "veladesk-import", version: 1, sections: [] })).toBe(false);
    expect(isRecipeDocument(null)).toBe(false);
    expect(isRecipeDocument([1, 2])).toBe(false);
  });
});

describe("adoptRecipeDocument", () => {
  it("distills a deck into the Import JSON v1 shape with a migration notice", () => {
    const result = adoptRecipeDocument(DECK);
    expect(result.kind).toBe("adopted");
    if (result.kind !== "adopted") {
      return;
    }
    expect(result.document).toEqual({
      format: "veladesk-import",
      version: 1,
      sections: [
        {
          name: "办公",
          apps: [
            { name: "GitHub", url: "https://github.com/" },
            { name: "Wiki", url: "http://wiki.internal/" },
          ],
        },
      ],
    });
    expect(result.notices).toEqual([
      { severity: "warning", code: "RECIPE_MIGRATED", path: "format" },
    ]);
    expect(result.extras.theme).toEqual({ mode: "dark", accent: 60, material: "glass" });
    expect(result.extras.motion).toEqual({ experiments: { helmMotion: false } });
  });

  it("rejects decks from a newer version with UNSUPPORTED_VERSION", () => {
    const result = adoptRecipeDocument({ ...DECK, version: 2 });
    expect(result).toEqual({
      kind: "rejected",
      issues: [{ severity: "error", code: "UNSUPPORTED_VERSION", path: "version", value: 2 }],
    });
  });

  it("rejects a structurally invalid deck with its JSON path", () => {
    const result = adoptRecipeDocument({
      ...DECK,
      spaces: [{ name: "X", layout: "spiral", tiles: [] }],
    });
    expect(result).toEqual({
      kind: "rejected",
      issues: [{ severity: "error", code: "INVALID_FORMAT", path: "spaces[0].layout" }],
    });
  });

  it("keeps a legal theme verbatim", () => {
    for (const theme of [
      { mode: "system", accent: 0, material: "clean" },
      { mode: "light", accent: 359, material: "soft" },
    ]) {
      const result = adoptRecipeDocument({ ...DECK, theme });
      expect(result.kind).toBe("adopted");
      if (result.kind === "adopted") {
        expect(result.extras.theme).toEqual(theme);
        expect(result.notices).toHaveLength(1);
      }
    }
  });

  it("drops each illegal theme FIELD individually with a warning — the legal rest stays (D1)", () => {
    const NIGHT_ID = `asset-sha256-${"b".repeat(64)}`;
    const cases: readonly [Record<string, unknown>, string, Record<string, unknown> | undefined][] = [
      [{ mode: "blue", accent: 60, material: "glass" }, "theme.mode", { accent: 60, material: "glass" }],
      [{ mode: "dark", accent: 999, material: "glass" }, "theme.accent", { mode: "dark", material: "glass" }],
      [{ mode: "dark", accent: 60.5, material: "glass" }, "theme.accent", { mode: "dark", material: "glass" }],
      [{ mode: "dark", accent: 60, material: "diamond" }, "theme.material", { mode: "dark", accent: 60 }],
      // A legal wallpaper (and mode) survives illegal accent/material — the
      // whole theme is no longer discarded over one bad field.
      [
        { mode: "dark", accent: 999, material: "diamond", wallpaper: { dark: `asset:${NIGHT_ID}` } },
        "theme.accent",
        { mode: "dark", wallpaper: { dark: `asset:${NIGHT_ID}` } },
      ],
    ];
    for (const [theme, field, expected] of cases) {
      const result = adoptRecipeDocument({ ...DECK, theme });
      expect(result.kind).toBe("adopted");
      if (result.kind !== "adopted") {
        continue;
      }
      const droppedFields = result.notices
        .filter((notice) => notice.code === "RECIPE_THEME_FIELD_IGNORED")
        .map((notice) => notice.path);
      expect(droppedFields).toContain(field);
      if (expected !== undefined) {
        expect(result.extras.theme).toEqual(expected);
      }
    }
  });

  it.each([[null], ["invalid"], [42], [[]]])("warns instead of crashing on malformed theme %j", (theme) => {
    const result = adoptRecipeDocument({ ...DECK, theme });
    expect(result.kind).toBe("adopted");
    if (result.kind === "adopted") {
      expect(result.extras.theme).toBeUndefined();
      expect(result.notices.filter((issue) => issue.code === "RECIPE_THEME_FIELD_IGNORED")).toHaveLength(3);
    }
  });

  it("a theme with nothing legal left drops entirely, one warning per field", () => {
    const result = adoptRecipeDocument({ ...DECK, theme: { mode: "blue", accent: -1, material: "diamond" } });
    expect(result.kind).toBe("adopted");
    if (result.kind === "adopted") {
      expect(result.extras.theme).toBeUndefined();
      expect(result.notices.filter((notice) => notice.code === "RECIPE_THEME_FIELD_IGNORED").map((n) => n.path)).toEqual([
        "theme.mode",
        "theme.accent",
        "theme.material",
      ]);
    }
  });

  it("passes the optional embedded-asset map through verbatim", () => {
    const NIGHT_ID = `asset-sha256-${"b".repeat(64)}`;
    const assets = { [NIGHT_ID]: { mediaType: "image/webp", data: "AAAA" } };
    const result = adoptRecipeDocument({
      ...DECK,
      theme: { mode: "dark", accent: 1, material: "soft", wallpaper: { dark: `asset:${NIGHT_ID}` } },
      assets,
    });
    expect(result.kind).toBe("adopted");
    if (result.kind === "adopted") {
      expect(result.extras.assets).toEqual(assets);
    }
    const plain = adoptRecipeDocument(DECK);
    expect(plain.kind === "adopted" ? plain.extras.assets : "adopt failed").toBeUndefined();
  });
});

describe("parseImportDocument with a .deck.json payload", () => {
  it("adopts a deck end-to-end: sections parsed, notice carried as a warning", () => {
    const result = parseImportDocument(JSON.stringify(DECK));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.parsed.document.sections).toHaveLength(1);
    expect(result.parsed.document.sections[0]?.apps).toEqual([
      { name: "GitHub", url: "https://github.com/" },
      { name: "Wiki", url: "http://wiki.internal/" },
    ]);
    expect(result.parsed.issues.some((issue) => issue.code === "RECIPE_MIGRATED")).toBe(true);
  });

  it("applies the ordinary v1 validation rules to adopted sections", () => {
    const invalidUrlDeck = {
      ...DECK,
      spaces: [{ name: "X", layout: "grid", tiles: [{ name: "A", url: "   " }] }],
    };
    const result = parseImportDocument(JSON.stringify(invalidUrlDeck));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === "INVALID_APP_URL")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "RECIPE_MIGRATED")).toBe(true);
  });

  it("keeps the legacy import path untouched for non-recipe documents", () => {
    const legacy = JSON.stringify({
      format: "veladesk-import",
      version: 1,
      sections: [{ name: "办公", apps: [{ name: "GitHub", url: "https://github.com/" }] }],
    });
    const result = parseImportDocument(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.issues).toEqual([]);
    }
  });

  it("surfaces an INVALID_FORMAT error for a recipe newer than known", () => {
    const result = parseImportDocument(JSON.stringify({ ...DECK, version: 99 }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.issues.some(
        (issue) => issue.code === "UNSUPPORTED_VERSION" && issue.severity === "error"
      )
    ).toBe(true);
  });
});

describe("recipeSpacePreviews", () => {
  const NIGHT_ID = `asset-sha256-${"b".repeat(64)}`;
  const LOCAL_ID = `asset-sha256-${"c".repeat(64)}`;

  function parseExtras(text: string) {
    const result = parseImportDocument(text);
    if (!result.ok) throw new Error("parse failed");
    return result.parsed;
  }

  it("summarizes each plan section's structure: mode, grid, tiles, wallpapers with availability", () => {
    const parsed = parseExtras(
      JSON.stringify({
        format: "vela.recipe",
        version: 1,
        spaces: [
          {
            name: "AI",
            layout: "grid",
            layoutMode: "snap",
            grid: { columns: 8, rows: 5 },
            wallpaper: { light: "preset:aurora", dark: `asset:${NIGHT_ID}` },
            tiles: [
              { name: "A", url: "https://a.example/" },
              { name: "B", url: "https://b.example/" },
            ],
          },
          { name: "Board", layout: "canvas", layoutMode: "free", tiles: [{ name: "C", url: "https://c.example/" }] },
        ],
        plugins: [],
      }),
    );
    // Without availability sets every asset ref reads cloud-only.
    const previews = recipeSpacePreviews(parsed.document, parsed.recipe!);
    expect(previews.get("ai")).toEqual({
      layoutMode: "snap",
      grid: { columns: 8, rows: 5 },
      tileCount: 2,
      light: { kind: "preset", presetId: "aurora" },
      dark: { kind: "asset", id: NIGHT_ID, source: "cloud" },
    });
    // No declared grid / wallpapers → defaults and undefined labels.
    expect(previews.get("board")).toEqual({
      layoutMode: "free",
      grid: undefined,
      tileCount: 1,
      light: undefined,
      dark: undefined,
    });
  });

  it("marks each asset ref by where its bytes come from: embedded / device / cloud", () => {
    const parsed = parseExtras(
      JSON.stringify({
        format: "vela.recipe",
        version: 1,
        spaces: [
          {
            name: "AI",
            layout: "grid",
            wallpaper: { light: `asset:${NIGHT_ID}`, dark: `asset:${LOCAL_ID}` },
            tiles: [],
          },
        ],
        plugins: [],
      }),
    );
    const status = { embedded: new Set([NIGHT_ID]), device: new Set([LOCAL_ID]) };
    const previews = recipeSpacePreviews(parsed.document, parsed.recipe!, status);
    expect(previews.get("ai")?.light).toEqual({ kind: "asset", id: NIGHT_ID, source: "embedded" });
    expect(previews.get("ai")?.dark).toEqual({ kind: "asset", id: LOCAL_ID, source: "device" });
    // An id in neither set reads cloud-only.
    expect(recipeSpacePreviews(parsed.document, parsed.recipe!, { device: new Set([LOCAL_ID]) }).get("ai")?.light).toEqual({
      kind: "asset",
      id: NIGHT_ID,
      source: "cloud",
    });
  });

  it("folds same-name spaces exactly like the planner: first space's fields, tiles concatenate", () => {
    const parsed = parseExtras(
      JSON.stringify({
        format: "vela.recipe",
        version: 1,
        spaces: [
          { name: "AI", layout: "grid", grid: { columns: 6, rows: 4 }, tiles: [{ name: "A", url: "https://a.example/" }] },
          { name: " ai ", layout: "canvas", layoutMode: "free", wallpaper: { light: "preset:mist" }, tiles: [{ name: "B", url: "https://b.example/" }] },
        ],
        plugins: [],
      }),
    );
    const previews = recipeSpacePreviews(parsed.document, parsed.recipe!);
    expect(previews.size).toBe(1);
    expect(previews.get("ai")).toEqual({
      layoutMode: "snap", // first space wins; the folded " ai " section key is the same
      grid: { columns: 6, rows: 4 },
      tileCount: 2,
      light: undefined,
      dark: undefined,
    });
  });
});

describe("deckFilename", () => {
  it("appends the .deck.json extension to a filesystem-safe slug", () => {
    expect(deckFilename("My Desk")).toBe("My-Desk.deck.json");
    expect(deckFilename("  a/b:c*d?e  ")).toBe("a-b-c-d-e.deck.json");
    expect(deckFilename("   ")).toBe("veladesk.deck.json");
  });
});
