// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearCachedIconPagesForTests,
  deserializeIconPageStore,
  readCachedIconPage,
  readIconPickerSession,
  simulateIconPageReloadForTests,
  writeCachedIconPage,
  writeIconPickerSession,
} from "./icon-picker-session";
import type { IconPickerPage } from "./icon-picker-model";

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

function page(offset: number): IconPickerPage {
  return {
    entries: [
      {
        id: `simple-icons:icon-${offset}`,
        collection: "simple-icons",
        name: `icon-${offset}`,
        label: `Icon ${offset}`,
        palette: "monochrome",
        category: "brand",
      },
    ],
    total: 500,
    nextOffset: offset + 1,
  };
}

describe("icon page cache", () => {
  it("round-trips a decoded page under its URL", () => {
    clearCachedIconPagesForTests();
    expect(readCachedIconPage("/api/v1/icons/search?scope=all")).toBeUndefined();
    writeCachedIconPage("/api/v1/icons/search?scope=all", page(0));
    expect(readCachedIconPage("/api/v1/icons/search?scope=all")).toEqual(page(0));
    clearCachedIconPagesForTests();
  });

  it("keeps only the LRU bound of pages", () => {
    clearCachedIconPagesForTests();
    // Overflow the cache well past its bound; the newest writes survive.
    for (let index = 0; index < 60; index += 1) {
      writeCachedIconPage(`/url-${index}`, page(index));
    }
    expect(readCachedIconPage("/url-59")).toBeDefined();
    // The oldest entries were evicted.
    expect(readCachedIconPage("/url-0")).toBeUndefined();
    clearCachedIconPagesForTests();
  });
});

/** Endpoint shape of one page — the store's serialized form. */
function endpointShape(p: IconPickerPage): Record<string, unknown> {
  return { icons: p.entries, total: p.total, nextOffset: p.nextOffset };
}

describe("icon page persistent store (task 029)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearCachedIconPagesForTests();
  });

  afterEach(() => {
    window.localStorage.clear();
    clearCachedIconPagesForTests();
  });

  it("restores a page after a simulated reload", () => {
    writeCachedIconPage("/api/v1/icons/search?scope=all", page(0));
    simulateIconPageReloadForTests();
    expect(readCachedIconPage("/api/v1/icons/search?scope=all")).toEqual(page(0));
  });

  it("persists appended offset pages too — a reload restores the whole chain", () => {
    writeCachedIconPage("/api/v1/icons/search?scope=all", page(0));
    writeCachedIconPage("/api/v1/icons/search?scope=all&offset=96", page(96));
    simulateIconPageReloadForTests();
    expect(readCachedIconPage("/api/v1/icons/search?scope=all&offset=96")).toEqual(page(96));
  });

  it("keeps only the persistent LRU bound across writes", () => {
    for (let index = 0; index < 30; index += 1) {
      writeCachedIconPage(`/store-${index}`, page(index));
    }
    simulateIconPageReloadForTests();
    expect(readCachedIconPage("/store-29")).toBeDefined();
    expect(readCachedIconPage("/store-5")).toBeUndefined();
  });

  it("namespaces the store key by app version — an upgrade drops stale pages, never serves them", () => {
    writeCachedIconPage("/api/v1/icons/search?scope=recommended", page(0));
    expect(
      window.localStorage.getItem("veladesk:icon-picker-pages:v1:0.0.0")
    ).not.toBeNull();
    // The un-namespaced legacy key must not exist (nothing half-writes).
    expect(window.localStorage.getItem("veladesk:icon-picker-pages:v1")).toBeNull();
  });

  it("degrades to memory-only when the storage quota refuses every write", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    };
    try {
      expect(() => writeCachedIconPage("/quota", page(0))).not.toThrow();
      // The in-memory cache still serves the page in this tab…
      expect(readCachedIconPage("/quota")).toEqual(page(0));
      // …but nothing survived to disk.
      simulateIconPageReloadForTests();
      expect(readCachedIconPage("/quota")).toBeUndefined();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("deserializeIconPageStore drops only the corrupt page, not the store", () => {
    const raw = JSON.stringify({
      version: 1,
      order: ["/good", "/bad"],
      pages: {
        "/good": endpointShape(page(0)),
        "/bad": { icons: "not-an-array" },
      },
    });
    const pages = deserializeIconPageStore(raw);
    expect(pages).not.toBeNull();
    expect(pages!.get("/good")).toEqual(page(0));
    expect(pages!.has("/bad")).toBe(false);
  });

  it("deserializeIconPageStore rejects broken JSON and wrong versions", () => {
    expect(deserializeIconPageStore("{not json")).toBeNull();
    expect(deserializeIconPageStore(JSON.stringify({ version: 2 }))).toBeNull();
    expect(deserializeIconPageStore(JSON.stringify({ version: 1, order: "no" }))).toBeNull();
  });
});

describe("icon picker session storage", () => {
  it("returns undefined when nothing was stored", () => {
    expect(readIconPickerSession(fakeStorage())).toBeUndefined();
  });

  it("round-trips a valid browse context", () => {
    const storage = fakeStorage();
    writeIconPickerSession(
      { scope: "brand", collection: "logos", query: "grok" },
      storage
    );
    expect(readIconPickerSession(storage)).toEqual({
      scope: "brand",
      collection: "logos",
      query: "grok",
    });
  });

  it("round-trips the scroll offset with the context (F5)", () => {
    const storage = fakeStorage();
    writeIconPickerSession(
      { scope: "all", collection: null, query: "", scrollTop: 1234 },
      storage
    );
    expect(readIconPickerSession(storage)).toEqual({
      scope: "all",
      collection: null,
      query: "",
      scrollTop: 1234,
    });
  });

  it("a pre-F5 stored session (no scrollTop) still restores verbatim", () => {
    const storage = fakeStorage({
      "veladesk:icon-picker:v1": JSON.stringify({
        version: 1,
        scope: "all",
        collection: null,
        query: "dock",
      }),
    });
    expect(readIconPickerSession(storage)).toEqual({
      scope: "all",
      collection: null,
      query: "dock",
    });
  });

  it("degrades on a corrupt scroll offset instead of half-restoring", () => {
    for (const bad of [-5, 1.5, 99_999_999, "down"]) {
      const storage = fakeStorage({
        "veladesk:icon-picker:v1": JSON.stringify({
          version: 1,
          scope: "all",
          collection: null,
          query: "",
          scrollTop: bad,
        }),
      });
      expect(readIconPickerSession(storage), String(bad)).toBeUndefined();
    }
  });

  it("degrades on an unknown scope or collection instead of half-restoring", () => {
    const badScope = fakeStorage({
      "veladesk:icon-picker:v1": JSON.stringify({
        version: 1,
        scope: "everything",
        collection: null,
        query: "",
      }),
    });
    expect(readIconPickerSession(badScope)).toBeUndefined();
    const badCollection = fakeStorage({
      "veladesk:icon-picker:v1": JSON.stringify({
        version: 1,
        scope: "all",
        collection: "material-symbols",
        query: "",
      }),
    });
    expect(readIconPickerSession(badCollection)).toBeUndefined();
  });

  it("degrades on broken JSON and wrong versions", () => {
    const broken = fakeStorage({ "veladesk:icon-picker:v1": "{not json" });
    expect(readIconPickerSession(broken)).toBeUndefined();
    const wrongVersion = fakeStorage({
      "veladesk:icon-picker:v1": JSON.stringify({ version: 2, scope: "all" }),
    });
    expect(readIconPickerSession(wrongVersion)).toBeUndefined();
  });

  it("degrades on an oversized query", () => {
    const storage = fakeStorage({
      "veladesk:icon-picker:v1": JSON.stringify({
        version: 1,
        scope: "all",
        collection: null,
        query: "a".repeat(101),
      }),
    });
    expect(readIconPickerSession(storage)).toBeUndefined();
  });
});
