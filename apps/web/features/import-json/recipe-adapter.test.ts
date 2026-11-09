import { describe, expect, it } from "vitest";

import { adoptRecipeDocument, isRecipeDocument } from "./recipe-adapter";
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
    expect(result.notice).toEqual({
      severity: "warning",
      code: "RECIPE_MIGRATED",
      path: "format",
    });
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

describe("deckFilename", () => {
  it("appends the .deck.json extension to a filesystem-safe slug", () => {
    expect(deckFilename("My Desk")).toBe("My-Desk.deck.json");
    expect(deckFilename("  a/b:c*d?e  ")).toBe("a-b-c-d-e.deck.json");
    expect(deckFilename("   ")).toBe("veladesk.deck.json");
  });
});
