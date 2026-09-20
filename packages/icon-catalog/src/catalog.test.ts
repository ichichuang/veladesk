import { describe, expect, it } from "vitest";

import { ICON_COLLECTIONS, findIconCollection, loadIconSet } from "./collections";
import { searchIconCatalog, iconId } from "./search";
import { renderIconSvg } from "./svg";
import type { IconCollectionId, IconSearchResult } from "./types";

const ALL_COLLECTION_IDS: readonly IconCollectionId[] = [
  "simple-icons",
  "lucide",
  "tabler",
  "ph",
  "fluent-color",
  "devicon",
  "vscode-icons",
  "catppuccin",
  "noto",
];

function idsOf(icons: readonly IconSearchResult[]): string[] {
  return icons.map((icon) => icon.id);
}

describe("collections", () => {
  it("exposes exactly the nine bundled collections in catalog order", () => {
    expect(ICON_COLLECTIONS.map((collection) => collection.id)).toEqual(ALL_COLLECTION_IDS);
    expect(ICON_COLLECTIONS.map((collection) => collection.order)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it("declares a category and palette for every collection", () => {
    expect(
      ICON_COLLECTIONS.map((c) => [c.id, c.category, c.palette] as const),
    ).toEqual([
      ["simple-icons", "brand", "monochrome"],
      ["lucide", "general", "monochrome"],
      ["tabler", "general", "monochrome"],
      ["ph", "general", "monochrome"],
      ["fluent-color", "general", "multicolor"],
      ["devicon", "development", "multicolor"],
      ["vscode-icons", "development", "multicolor"],
      ["catppuccin", "development", "multicolor"],
      ["noto", "emoji", "multicolor"],
    ]);
  });

  it("resolves collections by id and rejects unknown ids", () => {
    expect(findIconCollection("lucide")?.label).toBe("Lucide");
    expect(findIconCollection("noto")?.label).toBe("Noto Emoji");
    expect(findIconCollection("nope")).toBeUndefined();
  });

  it(
    "loads every bundled collection with real icon data",
    async () => {
      for (const info of ICON_COLLECTIONS) {
        const set = await loadIconSet(info.id);
        expect(Object.keys(set.icons).length, info.id).toBeGreaterThan(0);
      }
    },
    // Nine collections of IconifyJSON — noto alone carries ~3.8k icons.
    60_000
  );

  it("resolves one known icon in each newly added collection", async () => {
    for (const [collection, name] of [
      ["fluent-color", "mail-24"],
      ["devicon", "docker"],
      ["vscode-icons", "file-type-reactjs"],
      ["catppuccin", "typescript"],
      ["noto", "robot"],
    ] as const) {
      const outcome = await searchIconCatalog({
        q: name,
        scope: "all",
        collection,
        limit: 1,
      });
      expect(outcome.ok, collection).toBe(true);
      if (outcome.ok) {
        expect(outcome.icons[0]?.id).toBe(`${collection}:${name}`);
      }
    }
  });
});

describe("search: result shape", () => {
  it("labels every result with its collection category and palette", async () => {
    const devicon = await searchIconCatalog({
      q: "docker",
      scope: "all",
      collection: "devicon",
      limit: 1,
    });
    expect(devicon.ok).toBe(true);
    if (devicon.ok) {
      expect(devicon.icons[0]).toMatchObject({
        collection: "devicon",
        category: "development",
        palette: "multicolor",
      });
    }

    const lucide = await searchIconCatalog({
      q: "house",
      scope: "all",
      collection: "lucide",
      limit: 1,
    });
    expect(lucide.ok).toBe(true);
    if (lucide.ok) {
      expect(lucide.icons[0]).toMatchObject({
        collection: "lucide",
        category: "general",
        palette: "monochrome",
      });
    }
  });
});

describe("search: lookups", () => {
  it("finds simple-icons:github by exact name", async () => {
    const outcome = await searchIconCatalog({
      q: "github",
      scope: "all",
      collection: "simple-icons",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.icons[0]).toMatchObject({
      id: "simple-icons:github",
      collection: "simple-icons",
      name: "github",
      label: "github",
    });
  });

  it("finds lucide, tabler and ph icons through aliases and plain names", async () => {
    const lucide = await searchIconCatalog({ q: "home", scope: "all", collection: "lucide" });
    expect(lucide.ok).toBe(true);
    if (lucide.ok) {
      // "home" is a lucide alias of "house" — alias ids are resolvable ids.
      expect(lucide.icons.map((icon) => icon.name)).toContain("home");
    }

    const tabler = await searchIconCatalog({ q: "server", scope: "all", collection: "tabler" });
    expect(tabler.ok).toBe(true);
    if (tabler.ok) {
      expect(tabler.icons[0]?.id).toBe("tabler:server");
    }

    const ph = await searchIconCatalog({ q: "robot", scope: "all", collection: "ph" });
    expect(ph.ok).toBe(true);
    if (ph.ok) {
      expect(ph.icons[0]?.id).toBe("ph:robot");
    }
  });
});

describe("search: ranking", () => {
  it("ranks exact above prefix above word-prefix above substring", async () => {
    const outcome = await searchIconCatalog({
      q: "home",
      scope: "all",
      collection: "tabler",
      limit: 10,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const scores = outcome.icons.map((icon) => {
      if (icon.name === "home") {
        return 0;
      }
      if (icon.name.startsWith("home")) {
        return 1;
      }
      if (icon.name.split("-").some((word) => word.startsWith("home"))) {
        return 2;
      }
      return 3;
    });
    const sorted = [...scores].sort((a, b) => a - b);
    expect(scores).toEqual(sorted);
    expect(outcome.icons[0]?.name).toBe("home");
  });

  it("finds substring matches that are neither prefix nor word-prefix", async () => {
    const outcome = await searchIconCatalog({
      q: "vron",
      scope: "all",
      collection: "lucide",
      limit: 120,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.icons.length).toBeGreaterThan(0);
    for (const icon of outcome.icons) {
      // Every match tier still implies the needle occurs in the name.
      expect(icon.name.includes("vron")).toBe(true);
    }
  });

  it("orders same-name matches across collections by collection order", async () => {
    const outcome = await searchIconCatalog({ q: "github", scope: "all", limit: 120 });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const collectionsOf = outcome.icons
      .filter((icon) => icon.name === "github")
      .map((icon) => icon.collection);
    // simple-icons (brands) must lead the tie.
    expect(collectionsOf[0]).toBe("simple-icons");
    expect(collectionsOf).toContain("devicon");
  });

  it("is deterministic across repeated calls", async () => {
    const a = await searchIconCatalog({
      q: "fold",
      scope: "all",
      collection: "lucide",
      limit: 20,
    });
    const b = await searchIconCatalog({
      q: "fold",
      scope: "all",
      collection: "lucide",
      limit: 20,
    });

    expect(a).toEqual(b);
  });

  it("matches space-separated queries against dashed names", async () => {
    const outcome = await searchIconCatalog({
      q: "brand github",
      scope: "all",
      collection: "tabler",
      limit: 5,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.icons[0]?.id).toBe("tabler:brand-github");
  });
});

describe("search: scopes", () => {
  it("defaults to the recommended scope", async () => {
    const explicit = await searchIconCatalog({ scope: "recommended" });
    const implicit = await searchIconCatalog({});

    expect(implicit).toEqual(explicit);
  });

  it("serves the curated catalog for an empty recommended query", async () => {
    const outcome = await searchIconCatalog({ scope: "recommended" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const ids = idsOf(outcome.icons);
    expect(ids[0]).toBe("simple-icons:github");
    expect(outcome.total).toBe(ids.length);
    expect(outcome.nextOffset).toBeNull();
    // Spec'd coverage: brands, general tools, development and emoji — mixed.
    for (const id of [
      "simple-icons:github",
      "simple-icons:youtube",
      "simple-icons:spotify",
      "devicon:docker",
      "devicon:react",
      "vscode-icons:file-type-reactjs",
      "lucide:terminal",
      "lucide:house",
      "fluent-color:mail-24",
      "catppuccin:typescript",
      "noto:robot",
      "noto:video-game",
      "noto:musical-note",
    ]) {
      expect(ids, id).toContain(id);
    }
    expect(outcome.icons.some((icon) => icon.palette === "monochrome")).toBe(true);
    expect(outcome.icons.some((icon) => icon.palette === "multicolor")).toBe(true);
  });

  it("falls through to a full catalog search for a non-empty recommended query", async () => {
    const recommended = await searchIconCatalog({ q: "docker", scope: "recommended" });
    const all = await searchIconCatalog({ q: "docker", scope: "all" });

    expect(recommended).toEqual(all);
    expect(recommended.ok).toBe(true);
    if (recommended.ok) {
      expect(recommended.total).toBeGreaterThan(1);
    }
  });

  it("restricts the curated catalog to a requested collection", async () => {
    const outcome = await searchIconCatalog({ scope: "recommended", collection: "devicon" });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.icons.length).toBeGreaterThan(0);
      expect(outcome.icons.every((icon) => icon.collection === "devicon")).toBe(true);
    }
  });

  it("returns only multicolor palettes for scope=color", async () => {
    const outcome = await searchIconCatalog({ scope: "color", limit: 120 });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.icons.length).toBe(120);
    for (const icon of outcome.icons) {
      expect(icon.palette).toBe("multicolor");
      expect(["fluent-color", "devicon", "vscode-icons", "catppuccin", "noto"]).toContain(
        icon.collection,
      );
    }
  });

  it("maps the category scopes onto their category", async () => {
    const expected: readonly [string, string][] = [
      ["brand", "brand"],
      ["general", "general"],
      ["development", "development"],
      ["emoji", "emoji"],
    ];
    for (const [scope, category] of expected) {
      const outcome = await searchIconCatalog({ scope, limit: 40 });
      expect(outcome.ok, scope).toBe(true);
      if (outcome.ok) {
        expect(outcome.icons.length, scope).toBeGreaterThan(0);
        for (const icon of outcome.icons) {
          expect(icon.category, scope).toBe(category);
        }
      }
    }
  });

  it("browses a category scope with an empty query in catalog order", async () => {
    const outcome = await searchIconCatalog({ scope: "development", limit: 120 });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const orders = outcome.icons.map((icon) =>
      ICON_COLLECTIONS.find((info) => info.id === icon.collection)!.order,
    );
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    // Development is devicon → vscode-icons → catppuccin.
    expect(outcome.icons[0]?.collection).toBe("devicon");
    expect(outcome.icons.every((icon) => icon.category === "development")).toBe(true);
  });

  it("ANDs the scope with an explicit collection", async () => {
    const legal = await searchIconCatalog({ scope: "color", collection: "devicon", limit: 10 });
    expect(legal.ok).toBe(true);
    if (legal.ok) {
      expect(legal.icons.length).toBeGreaterThan(0);
      expect(legal.icons.every((icon) => icon.collection === "devicon")).toBe(true);
    }

    const empty = await searchIconCatalog({ scope: "brand", collection: "devicon", limit: 10 });
    expect(empty.ok).toBe(true);
    if (empty.ok) {
      expect(empty.icons).toEqual([]);
      expect(empty.total).toBe(0);
      expect(empty.nextOffset).toBeNull();
    }
  });
});

describe("search: browse pagination", () => {
  it("serves the real catalog head for scope=all with the default page size", async () => {
    const outcome = await searchIconCatalog({ scope: "all" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.icons).toHaveLength(96);
    expect(outcome.total).toBeGreaterThan(96);
    expect(outcome.nextOffset).toBe(96);
  });

  it("never answers scope=all with the curated starter list", async () => {
    const outcome = await searchIconCatalog({ scope: "all", limit: 120 });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.total).toBeGreaterThan(300);
    // The first page is simple-icons A→Z, not a hand-picked starter set.
    expect(outcome.icons[0]?.collection).toBe("simple-icons");
    const names = outcome.icons
      .filter((icon) => icon.collection === "simple-icons")
      .map((icon) => icon.name);
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it("pages through the whole catalog without gaps or duplicates", async () => {
    const seen = new Set<string>();
    let offset: number | null = 0;
    let total = 0;
    let pages = 0;
    // The bundled catalog spans ~28k visible icons: ~305 pages of 96.
    while (offset !== null && pages < 400) {
      const outcome = await searchIconCatalog({ scope: "all", offset, limit: 96 });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) {
        return;
      }
      total = outcome.total;
      for (const id of idsOf(outcome.icons)) {
        expect(seen.has(id), id).toBe(false);
        seen.add(id);
      }
      offset = outcome.nextOffset;
      pages += 1;
    }
    expect(pages).toBeGreaterThan(3);
    expect(seen.size).toBeGreaterThan(300);
    expect(seen.size).toBe(total);
    expect(offset).toBeNull();
  });

  it("keeps total stable and ends with a null nextOffset", async () => {
    const first = await searchIconCatalog({ scope: "all", offset: 0, limit: 96 });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const total = first.total;
    const last = await searchIconCatalog({
      scope: "all",
      offset: Math.floor(total / 96) * 96,
      limit: 96,
    });

    expect(last.ok).toBe(true);
    if (last.ok) {
      expect(last.total).toBe(total);
      expect(last.icons.length).toBe(total - Math.floor(total / 96) * 96);
      expect(last.nextOffset).toBeNull();
    }
  });

  it("returns an empty page beyond the end without inventing a next offset", async () => {
    const outcome = await searchIconCatalog({ scope: "all", offset: 999_999, limit: 96 });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.icons).toEqual([]);
      expect(outcome.total).toBeGreaterThan(0);
      expect(outcome.nextOffset).toBeNull();
    }
  });

  it("browses a single collection in stable name order", async () => {
    const outcome = await searchIconCatalog({
      scope: "all",
      collection: "simple-icons",
      limit: 5,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const names = outcome.icons.map((icon) => icon.name);
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(outcome.icons.every((icon) => icon.collection === "simple-icons")).toBe(true);
    expect(outcome.nextOffset).toBe(5);
  });

  it("never suggests hidden icons", async () => {
    const outcome = await searchIconCatalog({
      scope: "all",
      collection: "simple-icons",
      limit: 120,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const names = outcome.icons.map((icon) => icon.name);
    expect(names).not.toContain("slack");
    expect(names).not.toContain("visualstudiocode");
  });
});

describe("search: query pagination", () => {
  it("reports the full match count and pages the ranked results", async () => {
    const first = await searchIconCatalog({ q: "a", scope: "all", limit: 96 });

    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.icons).toHaveLength(96);
    expect(first.total).toBeGreaterThan(96);
    expect(first.nextOffset).toBe(96);

    const second = await searchIconCatalog({ q: "a", scope: "all", offset: 96, limit: 96 });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.total).toBe(first.total);
    const overlap = idsOf(second.icons).filter((id) => idsOf(first.icons).includes(id));
    expect(overlap).toEqual([]);
  });

  it("slices after ranking, keeping the best matches on the first page", async () => {
    const first = await searchIconCatalog({ q: "home", scope: "all", limit: 5 });
    const bigger = await searchIconCatalog({ q: "home", scope: "all", limit: 20 });

    expect(first.ok && bigger.ok).toBe(true);
    if (first.ok && bigger.ok) {
      expect(idsOf(first.icons)).toEqual(idsOf(bigger.icons).slice(0, 5));
    }
  });

  it("is a no-op page for a query with no matches", async () => {
    const outcome = await searchIconCatalog({ q: "zzzqqxx", scope: "all" });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.icons).toEqual([]);
      expect(outcome.total).toBe(0);
      expect(outcome.nextOffset).toBeNull();
    }
  });
});

describe("search: invalid requests", () => {
  it("rejects over-long queries", async () => {
    const outcome = await searchIconCatalog({ q: "a".repeat(101) });

    expect(outcome).toEqual({ ok: false, issue: "invalid-query" });
  });

  it("rejects non-string queries", async () => {
    expect(await searchIconCatalog({ q: 42 })).toEqual({ ok: false, issue: "invalid-query" });
  });

  it("rejects non-canonical and out-of-range limits", async () => {
    for (const limit of ["0", "-1", "1.5", "abc", "060", 121, 0, 1.5]) {
      expect(await searchIconCatalog({ q: "home", limit }), String(limit)).toEqual({
        ok: false,
        issue: "invalid-limit",
      });
    }
  });

  it("accepts the canonical limit boundaries", async () => {
    for (const limit of [1, 120, "1", "120"]) {
      const outcome = await searchIconCatalog({ scope: "all", limit });
      expect(outcome.ok, String(limit)).toBe(true);
      if (outcome.ok) {
        expect(outcome.icons.length).toBeLessThanOrEqual(Number(limit));
      }
    }
  });

  it("rejects non-canonical and negative offsets", async () => {
    for (const offset of ["-1", "1.5", "abc", "01", -1, 1.5, NaN]) {
      expect(await searchIconCatalog({ scope: "all", offset }), String(offset)).toEqual({
        ok: false,
        issue: "invalid-offset",
      });
    }
  });

  it("accepts zero and canonical positive offsets", async () => {
    for (const offset of [0, "0", 5, "5"]) {
      const outcome = await searchIconCatalog({ scope: "all", offset, limit: 1 });
      expect(outcome.ok, String(offset)).toBe(true);
    }
  });

  it("rejects unknown scopes", async () => {
    for (const scope of ["everything", "", 7, null]) {
      expect(await searchIconCatalog({ scope }), String(scope)).toEqual({
        ok: false,
        issue: "invalid-scope",
      });
    }
  });

  it("rejects unknown collections", async () => {
    expect(
      await searchIconCatalog({ q: "home", scope: "all", collection: "material-symbols" }),
    ).toEqual({ ok: false, issue: "unknown-collection" });
    expect(await searchIconCatalog({ q: "home", scope: "all", collection: 7 })).toEqual({
      ok: false,
      issue: "unknown-collection",
    });
  });
});

describe("iconId", () => {
  it("builds the persisted AppIcon icon string", () => {
    expect(iconId("simple-icons", "github")).toBe("simple-icons:github");
    expect(iconId("lucide", "terminal")).toBe("lucide:terminal");
    expect(iconId("tabler", "server")).toBe("tabler:server");
    expect(iconId("ph", "robot")).toBe("ph:robot");
    expect(iconId("devicon", "docker")).toBe("devicon:docker");
    expect(iconId("noto", "robot")).toBe("noto:robot");
  });
});

describe("renderIconSvg", () => {
  it("renders simple-icons:github with currentColor fill", async () => {
    const svg = await renderIconSvg("simple-icons", "github");

    expect(svg).toBeDefined();
    expect(svg).toContain("<svg");
    expect(svg).toContain('fill="currentColor"');
  });

  it("renders lucide/tabler/ph icons with viewBox and currentColor", async () => {
    for (const [collection, name] of [
      ["lucide", "terminal"],
      ["tabler", "server"],
      ["ph", "robot"],
    ] as const) {
      const svg = await renderIconSvg(collection, name);
      expect(svg).toBeDefined();
      expect(svg).toContain("<svg");
      expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
      expect(svg).toContain("currentColor");
    }
  });

  it("preserves the original colors of every multicolor collection", async () => {
    for (const [collection, name] of [
      ["fluent-color", "mail-24"],
      ["devicon", "docker"],
      ["vscode-icons", "file-type-reactjs"],
      ["catppuccin", "typescript"],
      ["noto", "robot"],
    ] as const) {
      const svg = await renderIconSvg(collection, name);
      expect(svg, collection).toBeDefined();
      // Real pigments, not a monochrome currentColor stand-in.
      expect(svg, collection).toMatch(/(fill|stroke)="#[0-9a-fA-F]{3,6}"/);
      expect(svg, collection).not.toContain("currentColor");
    }
  });

  it("renders aliases (lucide home → house)", async () => {
    const svg = await renderIconSvg("lucide", "home");

    expect(svg).toBeDefined();
    expect(svg).toContain("<svg");
  });

  it("never emits scripts or event handlers", async () => {
    for (const [collection, name] of [
      ["simple-icons", "github"],
      ["lucide", "house"],
      ["tabler", "brand-livewire"],
      ["ph", "robot"],
      ["noto", "robot"],
    ] as const) {
      const svg = await renderIconSvg(collection, name);
      expect(svg).toBeDefined();
      expect(svg!.toLowerCase()).not.toContain("<script");
      expect(svg!.toLowerCase()).not.toContain("onload");
      expect(svg!.toLowerCase()).not.toContain("onerror");
    }
  });

  it("returns undefined for unknown names (404 path)", async () => {
    expect(await renderIconSvg("lucide", "not-an-icon-xyz")).toBeUndefined();
    expect(await renderIconSvg("simple-icons", "../../etc/passwd")).toBeUndefined();
  });
});
