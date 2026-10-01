import { describe, expect, it } from "vitest";

import { canonicalImportUrlKey, normalizeImportDisplayName, normalizeImportNameKey } from "./normalization";

describe("normalizeImportNameKey", () => {
  it("trims, collapses whitespace and lowercases", () => {
    expect(normalizeImportNameKey("  AI  ")).toBe("ai");
    expect(normalizeImportNameKey("Work   Tools")).toBe("work tools");
    expect(normalizeImportNameKey("a\tb\n c")).toBe("a b c");
  });

  it("applies Unicode NFKC compatibility normalization before keying", () => {
    // Full-width latin normalizes to ASCII under NFKC.
    expect(normalizeImportNameKey("ＡＩ")).toBe("ai");
    expect(normalizeImportNameKey("开 发")).toBe("开 发");
  });

  it("produces the same key for case/width/whitespace variants", () => {
    expect(normalizeImportNameKey(" AI ")).toBe(normalizeImportNameKey("ai"));
    expect(normalizeImportNameKey("Ｗｏｒｋ Tools")).toBe(normalizeImportNameKey("work tools"));
  });
});

describe("normalizeImportDisplayName", () => {
  it("trims and collapses whitespace but keeps the original spelling and case", () => {
    expect(normalizeImportDisplayName("  AI  ")).toBe("AI");
    expect(normalizeImportDisplayName("Work   Tools")).toBe("Work Tools");
  });

  it("does not lowercase and does not NFKC-rewrite what the user sees", () => {
    expect(normalizeImportDisplayName("GitHub")).toBe("GitHub");
    expect(normalizeImportDisplayName("ＡＩ")).toBe("ＡＩ");
  });
});

describe("canonicalImportUrlKey", () => {
  it("treats root-slash, host-case, default-port and fragment variants as one key", () => {
    const expected = canonicalImportUrlKey("https://github.com/");
    expect(canonicalImportUrlKey("https://github.com")).toBe(expected);
    expect(canonicalImportUrlKey("https://GitHub.com/")).toBe(expected);
    expect(canonicalImportUrlKey("https://github.com:443/")).toBe(expected);
    expect(canonicalImportUrlKey("https://github.com/#top")).toBe(expected);
  });

  it("keeps different paths distinct", () => {
    expect(canonicalImportUrlKey("https://github.com/")).not.toBe(
      canonicalImportUrlKey("https://github.com/openai/")
    );
  });

  it("keeps different meaningful queries distinct without reordering", () => {
    expect(canonicalImportUrlKey("https://example.com/?a=1&b=2")).not.toBe(
      canonicalImportUrlKey("https://example.com/?b=2&a=1")
    );
    expect(canonicalImportUrlKey("https://example.com/?a=1")).not.toBe(
      canonicalImportUrlKey("https://example.com/?a=2")
    );
  });

  it("keeps a meaningful query distinct from no query", () => {
    expect(canonicalImportUrlKey("https://example.com/")).not.toBe(
      canonicalImportUrlKey("https://example.com/?a=1")
    );
  });

  it("lowercases the scheme and drops fragments for custom protocols", () => {
    expect(canonicalImportUrlKey("Obsidian://vault/Note")).toBe(canonicalImportUrlKey("obsidian://vault/Note"));
    expect(canonicalImportUrlKey("obsidian://vault/Note#sec")).toBe(canonicalImportUrlKey("obsidian://vault/Note"));
  });

  it("is stable for strings the URL parser rejects", () => {
    expect(canonicalImportUrlKey("  my-tool://thing  ")).toBe(canonicalImportUrlKey("my-tool://thing"));
  });
});
