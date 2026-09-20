import { describe, expect, it } from "vitest";
import type { AppShortcut } from "@veladesk/domain";
import { DEFAULT_APP_VISUAL_STYLE } from "@veladesk/domain";

import {
  APP_ICON_TEXT_MAX_CODE_POINTS,
  buildDraftApp,
  buildDraftIcon,
  buildDraftVisual,
  decorationStyleChoices,
  draftEquals,
  draftFromApp,
  isDraftSavable,
  percentFromScale,
  scaleFromPercent,
  validateIconText,
} from "./app-visual-draft";

function makeApp(overrides: Partial<AppShortcut> = {}): AppShortcut {
  return {
    kind: "app",
    id: "app-1",
    name: "GitHub",
    url: "https://github.com",
    icon: { kind: "generated", text: "GI", source: "auto" },
    openMode: "new-tab",
    tags: [],
    ...overrides,
  };
}

describe("draftFromApp", () => {
  it("opens a text/auto draft for a generated auto icon with defaults", () => {
    const draft = draftFromApp(makeApp());

    expect(draft).toEqual({
      source: "text",
      libraryIcon: "",
      assetId: "",
      textMode: "auto",
      customText: "",
      iconScale: 1,
      decorationStyle: "gradient",
      foregroundColor: undefined,
      decorationColor: undefined,
    });
  });

  it("opens a library draft preserving the iconify id and style", () => {
    const draft = draftFromApp(
      makeApp({
        icon: { kind: "iconify", icon: "simple-icons:github" },
        visual: {
          iconScale: 1.2,
          decorationStyle: "glass",
          foregroundColor: "#AABBCC",
          decorationColor: "#112233",
        },
      })
    );

    expect(draft.source).toBe("library");
    expect(draft.libraryIcon).toBe("simple-icons:github");
    expect(draft.iconScale).toBe(1.2);
    expect(draft.decorationStyle).toBe("glass");
    expect(draft.foregroundColor).toBe("#aabbcc");
    expect(draft.decorationColor).toBe("#112233");
  });

  it("opens an upload draft for an existing asset icon", () => {
    const draft = draftFromApp(
      makeApp({ icon: { kind: "asset", assetId: "asset-sha256-" + "a".repeat(64) } })
    );

    expect(draft.source).toBe("upload");
    expect(draft.assetId).toBe("asset-sha256-" + "a".repeat(64));
    expect(draftEquals(draft, draftFromApp(makeApp({ icon: { kind: "asset", assetId: "asset-sha256-" + "a".repeat(64) } })))).toBe(true);
  });

  it("opens a text/custom draft for custom generated text", () => {
    const draft = draftFromApp(
      makeApp({ icon: { kind: "generated", text: "AI", source: "custom" } })
    );

    expect(draft.source).toBe("text");
    expect(draft.textMode).toBe("custom");
    expect(draft.customText).toBe("AI");
  });

  it("treats favicon/asset and legacy icons as text/auto", () => {
    expect(draftFromApp(makeApp({ icon: { kind: "favicon" } })).source).toBe("text");
    expect(
      draftFromApp(makeApp({ icon: { kind: "asset", assetId: "a" } })).textMode
    ).toBe("auto");
    expect(
      draftFromApp(makeApp({ icon: { kind: "generated", text: "GI" } })).textMode
    ).toBe("auto");
  });

  it("round-trips: the fresh draft equals itself", () => {
    const app = makeApp({
      icon: { kind: "iconify", icon: "lucide:terminal" },
      visual: { iconScale: 0.75, decorationStyle: "solid", decorationColor: "#3366FF" },
    });

    expect(draftEquals(draftFromApp(app), draftFromApp(app))).toBe(true);
  });
});

describe("validateIconText", () => {
  it("accepts up to 4 code points across scripts and emoji", () => {
    for (const text of ["AI", "家", "NAS", "🤖", "测试测", " a ", "🇯🇵", "a👍b"]) {
      expect(validateIconText(text)).toBeUndefined();
    }
  });

  it("counts code points, not UTF-16 units", () => {
    // 👍 is 2 UTF-16 code units but 1 code point — fine at 4 total.
    expect(validateIconText("👍👍👍👍")).toBeUndefined();
    expect(validateIconText("👍👍👍👍👍")).toBe("too-long");
  });

  it("rejects blank and over-long text", () => {
    expect(validateIconText("")).toBe("empty");
    expect(validateIconText("   ")).toBe("empty");
    expect(validateIconText("ABCDEF")).toBe("too-long");
    expect(validateIconText("家家人人人")).toBe("too-long");
  });

  it("matches the task's 4-code-point budget constant", () => {
    expect(APP_ICON_TEXT_MAX_CODE_POINTS).toBe(4);
  });
});

describe("scale percent conversions", () => {
  it("round-trips the slider range", () => {
    for (const percent of [50, 75, 100, 115, 160]) {
      expect(percentFromScale(scaleFromPercent(percent))).toBe(percent);
    }
    expect(scaleFromPercent(115)).toBe(1.15);
    expect(scaleFromPercent(50)).toBe(0.5);
  });
});

describe("buildDraftIcon", () => {
  it("builds library icons from the draft id", () => {
    const app = makeApp();
    const draft = { ...draftFromApp(app), source: "library" as const, libraryIcon: "ph:robot" };

    expect(buildDraftIcon(app, draft)).toEqual({ kind: "iconify", icon: "ph:robot" });
  });

  it("recomputes auto initials from the CURRENT name", () => {
    const app = makeApp({ name: "ChatGPT" });
    const draft = draftFromApp(app);

    expect(buildDraftIcon(app, draft)).toEqual({
      kind: "generated",
      text: "CH",
      source: "auto",
    });
  });

  it("projects the chosen asset id as an asset icon (preview and save)", () => {
    const app = makeApp();
    const assetId = "asset-sha256-" + "b".repeat(64);
    const draft = { ...draftFromApp(app), source: "upload" as const, assetId };

    expect(buildDraftIcon(app, draft)).toEqual({ kind: "asset", assetId });
  });

  it("falls back to derived initials while no upload is chosen", () => {
    const app = makeApp();
    const draft = { ...draftFromApp(app), source: "upload" as const, assetId: "" };

    expect(buildDraftIcon(app, draft)).toEqual({ kind: "generated", text: "GI", source: "auto" });
  });

  it("stores custom text verbatim with the custom source", () => {
    const app = makeApp();
    const draft = {
      ...draftFromApp(app),
      textMode: "custom" as const,
      customText: "家",
    };

    expect(buildDraftIcon(app, draft)).toEqual({ kind: "generated", text: "家", source: "custom" });
  });
});

describe("buildDraftVisual", () => {
  it("persists defaults exactly and never writes Auto colors", () => {
    const app = makeApp();
    expect(buildDraftVisual(draftFromApp(app))).toEqual(DEFAULT_APP_VISUAL_STYLE);
    expect("foregroundColor" in buildDraftVisual(draftFromApp(app))).toBe(false);
    expect("decorationColor" in buildDraftVisual(draftFromApp(app))).toBe(false);
  });

  it("persists set colors (normalized) and omits Auto ones independently", () => {
    const app = makeApp();
    const withForeground = buildDraftVisual({
      ...draftFromApp(app),
      foregroundColor: "#AABBCC",
    });
    expect(withForeground).toEqual({
      iconScale: 1,
      decorationStyle: "gradient",
      foregroundColor: "#aabbcc",
    });

    const withDecoration = buildDraftVisual({
      ...draftFromApp(app),
      decorationColor: "#112233",
    });
    expect(withDecoration).toEqual({
      iconScale: 1,
      decorationStyle: "gradient",
      decorationColor: "#112233",
    });
  });
});

describe("buildDraftApp", () => {
  it("previews exactly what Save persists, preserving identity and placement fields", () => {
    const app = makeApp({ categoryId: "cat", tags: ["work"] });
    const draft = {
      ...draftFromApp(app),
      source: "library" as const,
      libraryIcon: "tabler:server",
      iconScale: 1.6,
      decorationStyle: "none" as const,
      foregroundColor: "#FFFFFF",
    };
    const next = buildDraftApp(app, draft);

    expect(next.id).toBe(app.id);
    expect(next.kind).toBe("app");
    expect(next.url).toBe(app.url);
    expect(next.categoryId).toBe("cat");
    expect(next.icon).toEqual({ kind: "iconify", icon: "tabler:server" });
    expect(next.visual).toEqual({
      iconScale: 1.6,
      decorationStyle: "none",
      foregroundColor: "#ffffff",
    });
  });
});

describe("draftEquals", () => {
  const base = draftFromApp(makeApp());

  it("is true for identical drafts and false on any semantic change", () => {
    expect(draftEquals(base, { ...base })).toBe(true);
    expect(draftEquals(base, { ...base, iconScale: 1.05 })).toBe(false);
    expect(draftEquals(base, { ...base, decorationStyle: "solid" })).toBe(false);
    expect(draftEquals(base, { ...base, source: "library", libraryIcon: "lucide:home" })).toBe(
      false
    );
    expect(draftEquals(base, { ...base, textMode: "custom", customText: "AI" })).toBe(false);
  });

  it("compares colors undefined-aware (Auto vs set, any hex case)", () => {
    expect(draftEquals(base, { ...base, foregroundColor: undefined })).toBe(true);
    expect(draftEquals(base, { ...base, foregroundColor: "#aabbcc" })).toBe(false);
    expect(
      draftEquals(
        { ...base, foregroundColor: "#AABBCC" },
        { ...base, foregroundColor: "#aabbcc" }
      )
    ).toBe(true);
    expect(draftEquals(base, { ...base, decorationColor: "#112233" })).toBe(false);
  });
});

describe("isDraftSavable", () => {
  it("requires a library pick when the library tab is active", () => {
    const app = makeApp();
    const draft = { ...draftFromApp(app), source: "library" as const, libraryIcon: "" };

    expect(isDraftSavable(draft)).toBe(false);
    expect(
      isDraftSavable({ ...draft, libraryIcon: 'simple-icons:github' })
    ).toBe(true);
  });

  it("requires a chosen asset id in upload mode", () => {
    const draft = { ...draftFromApp(makeApp()), source: "upload" as const, assetId: "" };

    expect(isDraftSavable(draft)).toBe(false);
    expect(isDraftSavable({ ...draft, assetId: "asset-sha256-" + "c".repeat(64) })).toBe(true);
  });

  it("requires valid custom text in custom mode", () => {
    const app = makeApp();
    const draft = { ...draftFromApp(app), textMode: "custom" as const, customText: "  " };

    expect(isDraftSavable(draft)).toBe(false);
    expect(isDraftSavable({ ...draft, customText: 'AI' })).toBe(true);
    expect(isDraftSavable({ ...draft, customText: 'TOOLONG' })).toBe(false);
  });

  it("always allows auto text mode", () => {
    const app = makeApp();
    expect(isDraftSavable(draftFromApp(app))).toBe(true);
  });
});

describe("decorationStyleChoices", () => {
  it("offers the four styles in display order", () => {
    expect(decorationStyleChoices()).toEqual(["gradient", "solid", "glass", "none"]);
  });
});
