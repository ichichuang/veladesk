import { describe, expect, it } from "vitest";

import {
  ICON_COLLECTIONS,
  findIconCollection,
  loadIconSet,
} from "./collections";
import { searchIconCatalog, iconId } from "./search";
import { renderIconSvg } from "./svg";

describe("collections", () => {
  it("exposes exactly the four bundled collections in brand-first order", () => {
    expect(ICON_COLLECTIONS.map((collection) => collection.id)).toEqual([
      "simple-icons",
      "lucide",
      "tabler",
      "ph",
    ]);
    expect(ICON_COLLECTIONS.map((collection) => collection.order)).toEqual([0, 1, 2, 3]);
  });

  it("resolves collections by id and rejects unknown ids", () => {
    expect(findIconCollection("lucide")?.label).toBe("Lucide");
    expect(findIconCollection("nope")).toBeUndefined();
  });

  it("loads every bundled collection with real icon data", async () => {
    for (const info of ICON_COLLECTIONS) {
      const set = await loadIconSet(info.id);
      expect(Object.keys(set.icons).length).toBeGreaterThan(0);
    }
  });
});

describe("search: lookups", () => {
  it("finds simple-icons:github by exact name", async () => {
    const outcome = await searchIconCatalog({ q: "github", collection: "simple-icons" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.icons[0]).toEqual({
      id: "simple-icons:github",
      collection: "simple-icons",
      name: "github",
      label: "github",
    });
  });

  it("finds lucide, tabler and ph icons through aliases and plain names", async () => {
    const lucide = await searchIconCatalog({ q: "home", collection: "lucide" });
    expect(lucide.ok).toBe(true);
    if (lucide.ok) {
      // "home" is a lucide alias of "house" — alias ids are resolvable ids.
      expect(lucide.icons.map((icon) => icon.name)).toContain("home");
    }

    const tabler = await searchIconCatalog({ q: "server", collection: "tabler" });
    expect(tabler.ok).toBe(true);
    if (tabler.ok) {
      expect(tabler.icons[0]?.id).toBe("tabler:server");
    }

    const ph = await searchIconCatalog({ q: "robot", collection: "ph" });
    expect(ph.ok).toBe(true);
    if (ph.ok) {
      expect(ph.icons[0]?.id).toBe("ph:robot");
    }
  });
});

describe("search: ranking", () => {
  it("ranks exact above prefix above word-prefix above substring", async () => {
    const outcome = await searchIconCatalog({ q: "home", collection: "tabler", limit: 10 });

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
    const outcome = await searchIconCatalog({ q: "vron", collection: "lucide", limit: 100 });

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
    const outcome = await searchIconCatalog({ q: "github", limit: 100 });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const collectionsOf = outcome.icons
      .filter((icon) => icon.name === "github")
      .map((icon) => icon.collection);
    // simple-icons (brands) must lead the tie.
    expect(collectionsOf[0]).toBe("simple-icons");
  });

  it("is deterministic across repeated calls", async () => {
    const a = await searchIconCatalog({ q: "fold", collection: "lucide", limit: 20 });
    const b = await searchIconCatalog({ q: "fold", collection: "lucide", limit: 20 });

    expect(a).toEqual(b);
  });

  it("matches space-separated queries against dashed names", async () => {
    const outcome = await searchIconCatalog({ q: "brand github", collection: "tabler", limit: 5 });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.icons[0]?.id).toBe("tabler:brand-github");
  });
});

describe("search: collection filter and limits", () => {
  it("restricts results to the requested collection", async () => {
    const outcome = await searchIconCatalog({ q: "github", collection: "lucide", limit: 100 });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    for (const icon of outcome.icons) {
      expect(icon.collection).toBe("lucide");
    }
  });

  it("caps results at the limit", async () => {
    const outcome = await searchIconCatalog({ q: "a", collection: "ph", limit: 7 });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.icons.length).toBeLessThanOrEqual(7);
  });

  it("defaults the limit to 60", async () => {
    const outcome = await searchIconCatalog({ q: "a", collection: "ph" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.icons.length).toBe(60);
  });
});

describe("search: browse mode (empty query)", () => {
  it("browses a collection in stable name order", async () => {
    const outcome = await searchIconCatalog({ q: "", collection: "simple-icons", limit: 5 });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const names = outcome.icons.map((icon) => icon.name);
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(outcome.icons.every((icon) => icon.collection === "simple-icons")).toBe(true);
  });

  it("returns curated starter icons without a collection", async () => {
    const outcome = await searchIconCatalog({});

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.icons.length).toBeGreaterThan(5);
    expect(outcome.icons[0]?.id).toBe("simple-icons:github");
    const ids = new Set(outcome.icons.map((icon) => icon.id));
    expect(ids.has("lucide:house")).toBe(true);
    expect(ids.has("tabler:server")).toBe(true);
    expect(ids.has("ph:robot")).toBe(true);
  });

  it("never suggests hidden icons", async () => {
    const outcome = await searchIconCatalog({ collection: "simple-icons", limit: 100 });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.icons.map((icon) => icon.name)).not.toContain("slack");
    expect(outcome.icons.map((icon) => icon.name)).not.toContain("visualstudiocode");
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
    for (const limit of ["0", "-1", "1.5", "abc", "060", 101, 0]) {
      expect(await searchIconCatalog({ q: "home", limit })).toEqual({
        ok: false,
        issue: "invalid-limit",
      });
    }
  });

  it("accepts canonical string limits", async () => {
    const outcome = await searchIconCatalog({ q: "home", collection: "ph", limit: "3" });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.icons.length).toBeLessThanOrEqual(3);
    }
  });

  it("rejects unknown collections", async () => {
    expect(await searchIconCatalog({ q: "home", collection: "material-symbols" })).toEqual({
      ok: false,
      issue: "unknown-collection",
    });
    expect(await searchIconCatalog({ q: "home", collection: 7 })).toEqual({
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
