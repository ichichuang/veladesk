import { describe, expect, it } from "vitest";

import type { LauncherEntry } from "./launcher-types";
import { normalizeLauncherText, searchLauncherEntries } from "./launcher-search";

function entry(
  key: string,
  label: string,
  secondary: readonly string[] = [],
  baseOrder = 0,
): LauncherEntry {
  return {
    kind: "app",
    key,
    entityId: key,
    label,
    secondary,
    baseOrder,
  };
}

function labels(entries: readonly LauncherEntry[]): readonly string[] {
  return entries.map((candidate) => candidate.label);
}

describe("normalizeLauncherText", () => {
  it("trims, lowercases and collapses whitespace", () => {
    expect(normalizeLauncherText("  OpenAI   Docs ")).toBe("openai docs");
  });

  it("collapses tabs and newlines like spaces", () => {
    expect(normalizeLauncherText("Notes\tVault\nTwo")).toBe("notes vault two");
  });
});

describe("searchLauncherEntries — matching", () => {
  const catalog: readonly LauncherEntry[] = [
    entry("app:openai", "OpenAI", ["https://openai.com", "app"], 0),
    entry("app:openai-docs", "OpenAI Docs", ["https://openai.com/docs", "docs", "app"], 1),
    entry("app:github", "GitHub", ["https://github.com", "code", "git", "app"], 2),
    entry("app:notes", "Notes", ["obsidian://open?vault=Notes", "app"], 3),
    entry("page:work", "Work", ["page", "page-work"], 4),
    entry("command:add-app", "Add App", ["add app", "new shortcut", "create app"], 5),
  ];

  it("matches case-insensitively", () => {
    expect(labels(searchLauncherEntries(catalog, "OPENAI"))).toContain("OpenAI");
  });

  it("ignores leading and trailing whitespace in the query", () => {
    expect(labels(searchLauncherEntries(catalog, "  github  "))).toEqual(["GitHub"]);
  });

  it("treats internal whitespace runs as one token separator", () => {
    expect(labels(searchLauncherEntries(catalog, "openai    docs"))).toContain("OpenAI Docs");
  });

  it("matches a word inside the label by word-prefix", () => {
    // "docs" is the second word of "OpenAI Docs" — word-prefix, not substring-only.
    expect(labels(searchLauncherEntries(catalog, "docs"))).toContain("OpenAI Docs");
  });

  it("matches secondary strings exactly, by prefix and by substring", () => {
    expect(labels(searchLauncherEntries(catalog, "git"))).toContain("GitHub");
    expect(labels(searchLauncherEntries(catalog, "code"))).toContain("GitHub");
    expect(labels(searchLauncherEntries(catalog, "hub.com"))).toContain("GitHub");
  });

  it("matches custom protocol URLs as ordinary strings", () => {
    expect(labels(searchLauncherEntries(catalog, "obsidian"))).toEqual(["Notes"]);
    expect(labels(searchLauncherEntries(catalog, "vault=notes"))).toEqual(["Notes"]);
  });

  it("matches page ids only as secondary metadata", () => {
    expect(labels(searchLauncherEntries(catalog, "page-work"))).toEqual(["Work"]);
  });

  it("excludes entries where any part of the query has no match", () => {
    expect(searchLauncherEntries(catalog, "zzzz")).toEqual([]);
    expect(searchLauncherEntries(catalog, "openai zzzz")).toEqual([]);
  });

  it("requires every token to match somewhere (AND, not OR)", () => {
    // "notes" alone only hits Notes; adding "openai" must not return Notes.
    expect(labels(searchLauncherEntries(catalog, "notes openai"))).toEqual([]);
  });

  it("lets one token match the label and another the secondary metadata", () => {
    // "notes" matches the label, "obsidian" matches the URL.
    expect(labels(searchLauncherEntries(catalog, "notes obsidian"))).toEqual(["Notes"]);
  });
});

describe("searchLauncherEntries — ranking", () => {
  const ranked: readonly LauncherEntry[] = [
    entry("app:openai", "OpenAI", ["https://openai.com", "app"], 0),
    entry("app:openai-docs", "OpenAI Docs", ["https://openai.com/docs", "app"], 1),
    entry("app:openai-like", "Totally OpenAI Different", ["app"], 2),
    entry("app:not-openai", "Not Quite", ["openai docs mirror", "app"], 3),
  ];

  it("ranks exact label above prefix above substring", () => {
    // Score table arithmetic for "openai":
    //   OpenAI                    → primary exact      0
    //   OpenAI Docs               → primary prefix    10
    //   Totally OpenAI Different  → primary substring 30 + 8 = 38
    //   Not Quite                 → secondary prefix  50 ("openai docs mirror")
    expect(labels(searchLauncherEntries(ranked, "openai"))).toEqual([
      "OpenAI",
      "OpenAI Docs",
      "Totally OpenAI Different",
      "Not Quite",
    ]);
  });

  it("ranks primary matches above secondary matches", () => {
    // "totally" is an exact word of one label and absent elsewhere.
    const result = searchLauncherEntries(
      [
        entry("a", "Totally", ["app"], 0),
        entry("b", "Other", ["totally", "app"], 1),
      ],
      "totally",
    );
    expect(labels(result)).toEqual(["Totally", "Other"]);
  });

  it("breaks score ties by baseOrder", () => {
    const tied: readonly LauncherEntry[] = [
      entry("b", "Beta", ["app"], 7),
      entry("a", "Alpha", ["app"], 3),
      entry("c", "Alpha Two", ["app"], 5),
    ];
    // "al" prefix-matches both "Alpha" entries identically; baseOrder decides.
    expect(labels(searchLauncherEntries(tied, "al"))).toEqual(["Alpha", "Alpha Two"]);
    // The same search over reordered input still respects baseOrder.
    expect(labels(searchLauncherEntries([...tied].reverse(), "al"))).toEqual([
      "Alpha",
      "Alpha Two",
    ]);
  });

  it("returns the full input unchanged (same order) for an empty query", () => {
    expect(searchLauncherEntries(ranked, "   ")).toEqual(ranked);
    expect(searchLauncherEntries(ranked, "")).toEqual(ranked);
  });

  it("sums per-token best scores instead of taking the best single token", () => {
    // "zed bbb": Zed      → 0 (label exact) + 74 (secondary substring) = 74
    //             Zed Bbb → 10 (label prefix) + 20 (label word-prefix) = 30
    // Summing puts Zed Bbb first; a best-single-token rule would pick Zed.
    const scores: readonly LauncherEntry[] = [
      entry("zed", "Zed", ["zzz bbb", "app"], 0),
      entry("zed-bbb", "Zed Bbb", ["app"], 1),
    ];
    expect(labels(searchLauncherEntries(scores, "zed bbb"))).toEqual([
      "Zed Bbb",
      "Zed",
    ]);
  });
});
