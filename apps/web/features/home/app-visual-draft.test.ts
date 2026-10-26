import { describe, expect, it } from "vitest";
import type { AppShortcut } from "@veladesk/domain";
import { DEFAULT_APP_VISUAL_STYLE } from "@veladesk/domain";

import {
  APP_ICON_TEXT_MAX_GRAPHEMES,
  buildDraftApp,
  buildDraftIcon,
  buildDraftVisual,
  decorationStyleChoices,
  draftEquals,
  draftFromApp,
  isDraftSavable,
  validateIconText,
} from "./app-visual-draft";

function makeApp(overrides: Partial<AppShortcut> = {}): AppShortcut {
  return {
    kind: "app",
    id: "app-1",
    name: "GitHub",
    url: "https://github.com",
    icon: { kind: "generated", text: "G", source: "auto" },
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
      labelVisible: true,
      decorationStyle: "gradient",
      foregroundColor: undefined,
      decorationColor: undefined,
    });
  });

  it("resolves an absent labelVisible to shown (legacy default)", () => {
    const draft = draftFromApp(
      makeApp({ visual: { decorationStyle: "glass" } })
    );

    expect(draft.labelVisible).toBe(true);
  });

  it("carries persisted label visibility into the draft", () => {
    const draft = draftFromApp(
      makeApp({
        visual: {
          decorationStyle: "solid",
          labelVisible: false,
        },
      })
    );

    expect(draft.labelVisible).toBe(false);
  });

  it("opens a library draft preserving the iconify id and style", () => {
    const draft = draftFromApp(
      makeApp({
        icon: { kind: "iconify", icon: "simple-icons:github" },
        visual: {
          decorationStyle: "glass",
          foregroundColor: "#AABBCC",
          decorationColor: "#112233",
        },
      })
    );

    expect(draft.source).toBe("library");
    expect(draft.libraryIcon).toBe("simple-icons:github");
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
    // Legacy multi-character text opens as the one glyph the tile shows,
    // so the untouched icon is still savable.
    expect(draft.customText).toBe("A");
    expect(isDraftSavable(draft)).toBe(true);
  });

  it("keeps a single multi-code-point emoji whole on open", () => {
    const draft = draftFromApp(
      makeApp({ icon: { kind: "generated", text: "👨‍👩‍👧", source: "custom" } })
    );
    expect(draft.customText).toBe("👨‍👩‍👧");
    expect(isDraftSavable(draft)).toBe(true);
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
      visual: { decorationStyle: "solid", decorationColor: "#3366FF" },
    });

    expect(draftEquals(draftFromApp(app), draftFromApp(app))).toBe(true);
  });
});

describe("validateIconText", () => {
  it("accepts exactly one character across scripts and emoji", () => {
    for (const text of ["A", "a", "家", "7", "🤖", " a ", "\u00e9", "👨‍👩‍👧", "🇯🇵", "👍🏽"]) {
      expect(validateIconText(text)).toBeUndefined();
    }
  });

  it("counts user-visible characters, not UTF-16 units or code points", () => {
    // 👍 is 2 UTF-16 code units but 1 code point — it is exactly one glyph;
    // the family emoji is 5 code points but still ONE grapheme.
    expect(validateIconText("👍")).toBeUndefined();
    expect(validateIconText("👍👍")).toBe("too-long");
    expect(validateIconText("👨‍👩‍👧x")).toBe("too-long");
  });

  it("rejects blank and multi-character text", () => {
    expect(validateIconText("")).toBe("empty");
    expect(validateIconText("   ")).toBe("empty");
    expect(validateIconText("AI")).toBe("too-long");
    expect(validateIconText("AB")).toBe("too-long");
    expect(validateIconText("微信")).toBe("too-long");
    expect(validateIconText("家家人人人")).toBe("too-long");
  });

  it("clamps to a one-character budget", () => {
    expect(APP_ICON_TEXT_MAX_GRAPHEMES).toBe(1);
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
      text: "C",
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

    expect(buildDraftIcon(app, draft)).toEqual({ kind: "generated", text: "G", source: "auto" });
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
      decorationStyle: "gradient",
      foregroundColor: "#aabbcc",
    });

    const withDecoration = buildDraftVisual({
      ...draftFromApp(app),
      decorationColor: "#112233",
    });
    expect(withDecoration).toEqual({
      decorationStyle: "gradient",
      decorationColor: "#112233",
    });
  });

  it("persists label visibility compactly: shown absent, hidden explicit", () => {
    const app = makeApp();
    // Shown stays legacy-shaped — no redundant fields.
    const defaults = buildDraftVisual(draftFromApp(app));
    expect("labelVisible" in defaults).toBe(false);

    // Hidden label persists explicitly.
    const hidden = buildDraftVisual({ ...draftFromApp(app), labelVisible: false });
    expect(hidden).toEqual({ decorationStyle: "gradient", labelVisible: false });
  });

  it("normalizes deprecated legacy scale fields away on save (019-B)", () => {
    // An app that still carries iconScale/labelScale (legacy snapshot)
    // keeps them untouched by open/cancel — but an editor SAVE writes the
    // visual WITHOUT them: the documented, only migration path.
    const legacyApp = makeApp({
      visual: {
        iconScale: 1.6,
        decorationStyle: "solid",
        labelScale: 1.4,
      },
    });
    const draft = draftFromApp(legacyApp);
    expect(draft.decorationStyle).toBe("solid");

    const saved = buildDraftVisual(draft);
    expect(saved).toEqual({ decorationStyle: "solid" });
    expect("iconScale" in saved).toBe(false);
    expect("labelScale" in saved).toBe(false);

    // Label visibility survives the normalization untouched.
    const hiddenSaved = buildDraftVisual({
      ...draftFromApp(makeApp({ visual: { iconScale: 2, labelScale: 0.75, decorationStyle: "gradient", labelVisible: false } })),
    });
    expect(hiddenSaved).toEqual({ decorationStyle: "gradient", labelVisible: false });
  });
});

describe("buildDraftApp", () => {
  it("previews exactly what Save persists, preserving identity and placement fields", () => {
    const app = makeApp({ categoryId: "cat", tags: ["work"] });
    const draft = {
      ...draftFromApp(app),
      source: "library" as const,
      libraryIcon: "tabler:server",
      decorationStyle: "none" as const,
      foregroundColor: "#FFFFFF",
    };
    const next = buildDraftApp(app, draft);

    expect(next.id).toBe(app.id);
    expect(next.kind).toBe("app");
    expect(next.name).toBe(app.name);
    expect(next.url).toBe(app.url);
    expect(next.openMode).toBe(app.openMode);
    expect(next.categoryId).toBe("cat");
    expect(next.tags).toEqual(["work"]);
    expect(next.icon).toEqual({ kind: "iconify", icon: "tabler:server" });
    expect(next.visual).toEqual({
      decorationStyle: "none",
      foregroundColor: "#ffffff",
    });
  });

  it("carries label visibility through to the persisted app (017-C/019-B)", () => {
    const app = makeApp();
    const next = buildDraftApp(app, {
      ...draftFromApp(app),
      labelVisible: false,
    });

    expect(next.visual).toEqual({
      decorationStyle: "gradient",
      labelVisible: false,
    });
  });
});

describe("draftEquals", () => {
  const base = draftFromApp(makeApp());

  it("is true for identical drafts and false on any semantic change", () => {
    expect(draftEquals(base, { ...base })).toBe(true);
    expect(draftEquals(base, { ...base, labelVisible: false })).toBe(false);
    expect(draftEquals(base, { ...base, decorationStyle: "solid" })).toBe(false);
    expect(draftEquals(base, { ...base, source: "library", libraryIcon: "lucide:home" })).toBe(
      false
    );
    expect(draftEquals(base, { ...base, textMode: "custom", customText: "AI" })).toBe(false);
  });

  it("treats a hidden label as dirty, not default-equal", () => {
    const hidden = { ...base, labelVisible: false };
    expect(draftEquals(hidden, { ...hidden })).toBe(true);
    expect(draftEquals(hidden, { ...hidden, labelVisible: true })).toBe(false);
  });

  it("ignores legacy scale fields: a legacy app and its modernized twin open identical drafts", () => {
    const legacyApp = makeApp({
      visual: { iconScale: 1.6, labelScale: 1.4, decorationStyle: "glass" },
    });
    const modernApp = makeApp({ visual: { decorationStyle: "glass" } });
    expect(draftEquals(draftFromApp(legacyApp), draftFromApp(modernApp))).toBe(true);
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
    expect(isDraftSavable({ ...draft, customText: 'A' })).toBe(true);
    expect(isDraftSavable({ ...draft, customText: '家' })).toBe(true);
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
