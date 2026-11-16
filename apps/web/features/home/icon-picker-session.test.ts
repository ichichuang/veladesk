import { describe, expect, it } from "vitest";

import {
  clearCachedIconPagesForTests,
  readCachedIconPage,
  readIconPickerSession,
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
