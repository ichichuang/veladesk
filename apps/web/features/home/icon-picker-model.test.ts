import { describe, expect, it } from "vitest";

import {
  ICON_PICKER_DEBOUNCE_MS,
  ICON_PICKER_PAGE_SIZE,
  ICON_PICKER_SCOPES,
  appendIconPickerPage,
  buildIconSearchUrl,
  collectionsForScope,
  decodeIconSearchPage,
  isIconPickerScope,
  scopeMessageKey,
} from "./icon-picker-model";
import type { IconPickerEntry } from "./icon-picker-model";

const monoEntry: IconPickerEntry = {
  id: "simple-icons:github",
  collection: "simple-icons",
  name: "github",
  label: "github",
  palette: "monochrome",
  category: "brand",
};

const colorEntry: IconPickerEntry = {
  id: "devicon:docker",
  collection: "devicon",
  name: "docker",
  label: "docker",
  palette: "multicolor",
  category: "development",
};

describe("picker scopes", () => {
  it("offers the three facets first, then one tab per category", () => {
    expect(ICON_PICKER_SCOPES).toEqual([
      "recommended",
      "all",
      "color",
      "brand",
      "general",
      "development",
      "emoji",
    ]);
  });

  it("recognizes exactly the seven scopes", () => {
    for (const scope of ICON_PICKER_SCOPES) {
      expect(isIconPickerScope(scope)).toBe(true);
    }
    expect(isIconPickerScope("everything")).toBe(false);
    expect(isIconPickerScope(7)).toBe(false);
    expect(isIconPickerScope(undefined)).toBe(false);
  });

  it("localizes every scope through a translation key", () => {
    const keys = ICON_PICKER_SCOPES.map(scopeMessageKey);
    expect(new Set(keys).size).toBe(ICON_PICKER_SCOPES.length);
    for (const key of keys) {
      expect(key).toMatch(/^iconPicker\.scope\./);
    }
  });
});

describe("collectionsForScope", () => {
  it("offers all nine collections for the recommended and all scopes", () => {
    for (const scope of ["recommended", "all"] as const) {
      expect(collectionsForScope(scope)).toHaveLength(9);
      expect(collectionsForScope(scope)[0]?.id).toBe("simple-icons");
      expect(collectionsForScope(scope)[8]?.id).toBe("noto");
    }
  });

  it("offers only multicolor collections for the color scope", () => {
    const ids = collectionsForScope("color").map((collection) => collection.id);
    expect(ids).toEqual(["fluent-color", "devicon", "vscode-icons", "catppuccin", "noto"]);
  });

  it("offers the category's collections for a category scope", () => {
    expect(collectionsForScope("brand").map((c) => c.id)).toEqual(["simple-icons"]);
    expect(collectionsForScope("general").map((c) => c.id)).toEqual([
      "lucide",
      "tabler",
      "ph",
      "fluent-color",
    ]);
    expect(collectionsForScope("development").map((c) => c.id)).toEqual([
      "devicon",
      "vscode-icons",
      "catppuccin",
    ]);
    expect(collectionsForScope("emoji").map((c) => c.id)).toEqual(["noto"]);
  });
});

describe("buildIconSearchUrl", () => {
  it("targets the self-hosted endpoint with the scope and page size", () => {
    expect(
      buildIconSearchUrl({ query: "", scope: "recommended", collection: null })
    ).toBe(`/api/v1/icons/search?scope=recommended&limit=${ICON_PICKER_PAGE_SIZE}`);
  });

  it("omits q for browse mode and includes trimmed queries", () => {
    expect(buildIconSearchUrl({ query: "   ", scope: "all", collection: null })).toBe(
      `/api/v1/icons/search?scope=all&limit=${ICON_PICKER_PAGE_SIZE}`
    );
    expect(buildIconSearchUrl({ query: " github ", scope: "all", collection: null })).toBe(
      `/api/v1/icons/search?q=github&scope=all&limit=${ICON_PICKER_PAGE_SIZE}`
    );
  });

  it("includes the collection filter only when one is chosen", () => {
    expect(
      buildIconSearchUrl({ query: "", scope: "all", collection: "devicon" })
    ).toContain("collection=devicon");
    expect(
      buildIconSearchUrl({ query: "", scope: "all", collection: null })
    ).not.toContain("collection=");
  });

  it("adds the offset only past the first page", () => {
    expect(
      buildIconSearchUrl({ query: "", scope: "all", collection: null, offset: 0 })
    ).not.toContain("offset=");
    expect(
      buildIconSearchUrl({ query: "", scope: "all", collection: null, offset: 96 })
    ).toContain("offset=96");
  });

  it("encodes queries safely and honors custom limits", () => {
    const url = buildIconSearchUrl({
      query: "brand github",
      scope: "brand",
      collection: null,
      offset: 24,
      limit: 24,
    });

    expect(url).toBe("/api/v1/icons/search?q=brand+github&scope=brand&limit=24&offset=24");
  });
});

describe("decodeIconSearchPage", () => {
  it("decodes icons, total and nextOffset", () => {
    expect(
      decodeIconSearchPage({ icons: [monoEntry, colorEntry], total: 29228, nextOffset: 96 })
    ).toEqual({ entries: [monoEntry, colorEntry], total: 29228, nextOffset: 96 });
  });

  it("decodes the last page (null nextOffset) and an empty catalog slice", () => {
    expect(decodeIconSearchPage({ icons: [], total: 0, nextOffset: null })).toEqual({
      entries: [],
      total: 0,
      nextOffset: null,
    });
  });

  it("rejects envelopes that are not a page", () => {
    expect(decodeIconSearchPage(undefined)).toBeUndefined();
    expect(decodeIconSearchPage("nope")).toBeUndefined();
    expect(decodeIconSearchPage({ icons: [monoEntry] })).toBeUndefined();
    expect(decodeIconSearchPage({ icons: [], total: -1, nextOffset: null })).toBeUndefined();
    expect(decodeIconSearchPage({ icons: [], total: 1, nextOffset: 1.5 })).toBeUndefined();
    expect(decodeIconSearchPage({ icons: "all", total: 0, nextOffset: null })).toBeUndefined();
  });

  it("rejects entries with an unknown palette, category or collection", () => {
    const base = { icons: [monoEntry], total: 1, nextOffset: null };
    expect(
      decodeIconSearchPage({
        ...base,
        icons: [{ ...monoEntry, palette: "sepia" }],
      })
    ).toBeUndefined();
    expect(
      decodeIconSearchPage({
        ...base,
        icons: [{ ...monoEntry, category: "misc" }],
      })
    ).toBeUndefined();
    expect(
      decodeIconSearchPage({
        ...base,
        icons: [{ ...monoEntry, collection: "material-symbols" }],
      })
    ).toBeUndefined();
    expect(
      decodeIconSearchPage({ ...base, icons: [{ ...monoEntry, id: 7 }] })
    ).toBeUndefined();
    expect(
      decodeIconSearchPage({ ...base, icons: [{ ...monoEntry, label: undefined }] })
    ).toBeUndefined();
    expect(decodeIconSearchPage({ ...base, icons: [monoEntry, "junk"] })).toBeUndefined();
  });
});

describe("appendIconPickerPage", () => {
  it("appends a page after the current results", () => {
    expect(appendIconPickerPage([monoEntry], [colorEntry])).toEqual([monoEntry, colorEntry]);
  });

  it("never duplicates an icon id already on screen", () => {
    const richer = { ...monoEntry, label: "GitHub" };
    expect(appendIconPickerPage([monoEntry], [monoEntry, colorEntry, richer])).toEqual([
      monoEntry,
      colorEntry,
    ]);
  });

  it("keeps the current results when the next page is empty", () => {
    expect(appendIconPickerPage([monoEntry], [])).toEqual([monoEntry]);
  });
});

describe("picker constants", () => {
  it("pages 96 at a time and debounces the search field", () => {
    expect(ICON_PICKER_PAGE_SIZE).toBe(96);
    expect(ICON_PICKER_DEBOUNCE_MS).toBe(150);
  });
});
