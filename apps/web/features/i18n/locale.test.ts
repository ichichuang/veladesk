import { describe, expect, it } from "vitest";

import {
  DEFAULT_UI_LOCALE,
  UI_LOCALE_STORAGE_KEY,
  htmlLangFor,
  parseUiLocale,
  persistUiLocale,
  readStoredUiLocale,
} from "./locale";

/** In-memory Storage double for the node test environment. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(initial));
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => void store.delete(key),
    setItem: (key, value) => void store.set(key, value),
  };
}

describe("ui locale", () => {
  it("defaults to Simplified Chinese", () => {
    expect(DEFAULT_UI_LOCALE).toBe("zh-CN");
  });

  it("parses both supported locales", () => {
    expect(parseUiLocale("zh-CN")).toBe("zh-CN");
    expect(parseUiLocale("en-US")).toBe("en-US");
  });

  it("falls back to zh-CN for invalid, empty or missing values", () => {
    expect(parseUiLocale("fr-FR")).toBe("zh-CN");
    expect(parseUiLocale("")).toBe("zh-CN");
    expect(parseUiLocale(null)).toBe("zh-CN");
    expect(parseUiLocale(undefined)).toBe("zh-CN");
    expect(parseUiLocale("en_US")).toBe("zh-CN");
  });

  it("maps each locale onto the html lang attribute value", () => {
    expect(htmlLangFor("zh-CN")).toBe("zh-CN");
    expect(htmlLangFor("en-US")).toBe("en-US");
  });

  it("uses the documented v2 storage key", () => {
    expect(UI_LOCALE_STORAGE_KEY).toBe("veladesk.ui-locale.v2");
  });

  it("ignores a polluted v1 preference entirely (v2 reset, 014-E)", () => {
    // v1 may hold en-US from dev/automation profiles; v2 is a clean slate.
    // v2 absent → zh-CN unconditionally, v1 is never read or migrated.
    expect(
      readStoredUiLocale(memoryStorage({ "veladesk.ui-locale.v1": "en-US" }))
    ).toBe("zh-CN");
    expect(
      readStoredUiLocale(memoryStorage({ "veladesk.ui-locale.v1": "zh-CN" }))
    ).toBe("zh-CN");
  });

  it("resolves the v1/v2 presence matrix", () => {
    // v1=en-US + v2 absent → zh-CN (the reset path real users hit).
    expect(
      readStoredUiLocale(
        memoryStorage({ "veladesk.ui-locale.v1": "en-US" })
      )
    ).toBe("zh-CN");
    // v1=en-US + v2=zh-CN → zh-CN (v2 is the only voice).
    expect(
      readStoredUiLocale(
        memoryStorage({
          "veladesk.ui-locale.v1": "en-US",
          "veladesk.ui-locale.v2": "zh-CN",
        })
      )
    ).toBe("zh-CN");
    // v1=zh-CN + v2=en-US → en-US (an explicit later choice wins).
    expect(
      readStoredUiLocale(
        memoryStorage({
          "veladesk.ui-locale.v1": "zh-CN",
          "veladesk.ui-locale.v2": "en-US",
        })
      )
    ).toBe("en-US");
    // Fresh browser → zh-CN.
    expect(readStoredUiLocale(memoryStorage())).toBe("zh-CN");
  });

  it("reads a persisted locale and falls back on garbage", () => {
    expect(readStoredUiLocale(memoryStorage({ "veladesk.ui-locale.v2": "en-US" }))).toBe("en-US");
    expect(readStoredUiLocale(memoryStorage({ "veladesk.ui-locale.v2": "zh-CN" }))).toBe("zh-CN");
    expect(readStoredUiLocale(memoryStorage({ "veladesk.ui-locale.v2": "de-DE" }))).toBe("zh-CN");
    expect(readStoredUiLocale(memoryStorage())).toBe("zh-CN");
  });

  it("never throws when storage is unavailable", () => {
    expect(readStoredUiLocale(undefined)).toBe("zh-CN");
    const exploding: Storage = {
      ...memoryStorage(),
      getItem: () => {
        throw new Error("quota / privacy mode");
      },
    };
    expect(readStoredUiLocale(exploding)).toBe("zh-CN");
    expect(() => persistUiLocale("en-US", exploding)).not.toThrow();
  });

  it("persists the locale under the v2 storage key only", () => {
    const storage = memoryStorage({ "veladesk.ui-locale.v1": "en-US" });
    persistUiLocale("en-US", storage);
    expect(storage.getItem("veladesk.ui-locale.v2")).toBe("en-US");
    // No migration: v1 is left exactly as it was.
    expect(storage.getItem("veladesk.ui-locale.v1")).toBe("en-US");
  });
});
