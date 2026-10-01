import { describe, expect, it } from "vitest";

import {
  createEmptyWorkspace,
  DEFAULT_WORKSPACE_APPEARANCE,
  resolveInterfaceStyle,
} from "@veladesk/domain";
import type { WorkspaceSnapshot } from "@veladesk/domain";

import {
  areWorkspaceSettingsDraftsEqual,
  createWorkspaceSettingsDraft,
  preferencesFromSettingsDraft,
} from "./settings-draft";
import type { WorkspaceSettingsDraft } from "./settings-draft";

function workspaceWith(secondPage: boolean): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "workspace-1",
    workspaceName: "My Desk",
    pageId: "page-1",
    pageName: "Home",
    grid: { columns: 12, rows: 8 },
  });
  if (!secondPage) {
    return base;
  }
  return {
    ...base,
    pages: [
      ...base.pages,
      {
        id: "page-2",
        name: "Work",
        layout: { id: "page-2", grid: { columns: 12, rows: 8 }, items: [] },
      },
    ],
  };
}

function legacyWorkspace(): WorkspaceSnapshot {
  const snapshot = workspaceWith(false);
  const preferences = { ...snapshot.preferences };
  delete (preferences as { appearance?: unknown }).appearance;
  return { ...snapshot, preferences };
}

describe("createWorkspaceSettingsDraft", () => {
  it("fills a legacy workspace without appearance with the exact defaults plus the inferred style", () => {
    const draft = createWorkspaceSettingsDraft(legacyWorkspace());

    expect(draft).toEqual({
      // The Task013 baseline has no persisted interfaceStyle; the draft
      // shows the NEAREST preset (display only — cancelled drafts never
      // write it back).
      appearance: { ...DEFAULT_WORKSPACE_APPEARANCE, interfaceStyle: "glass" },
      defaultPageId: "page-1",
      layoutLocked: true,
      gridGapPx: 16,
      background: { workspace: undefined, pages: {} },
    });
  });

  it("keeps a persisted interface style and the desktop preferences", () => {
    const snapshot = workspaceWith(true);
    const appearance = {
      ...DEFAULT_WORKSPACE_APPEARANCE,
      accentHue: 310,
      interfaceStyle: "clean" as const,
      iconSize: "large" as const,
    };
    const withAppearance: WorkspaceSnapshot = {
      ...snapshot,
      preferences: { ...snapshot.preferences, layoutLocked: false, appearance },
    };

    expect(createWorkspaceSettingsDraft(withAppearance)).toEqual({
      appearance,
      defaultPageId: "page-1",
      layoutLocked: false,
      gridGapPx: 16,
      background: { workspace: undefined, pages: {} },
    });
  });
});

describe("preferencesFromSettingsDraft", () => {
  it("normalizes the surface values into the chosen style's canonical preset", () => {
    const draft: WorkspaceSettingsDraft = {
      appearance: {
        ...DEFAULT_WORKSPACE_APPEARANCE,
        // The draft was opened on the legacy baseline, then the user picked
        // Clean explicitly (the raw fields still hold legacy numbers here).
        surfaceOpacity: 0.55,
        blurPx: 18,
        radiusPx: 14,
        interfaceStyle: "clean",
      },
      defaultPageId: "page-2",
      layoutLocked: false,
      gridGapPx: 24,
      background: { workspace: undefined, pages: {} },
    };

    const preferences = preferencesFromSettingsDraft(draft);
    const clean = resolveInterfaceStyle("clean");

    expect(preferences.appearance).toEqual({
      ...DEFAULT_WORKSPACE_APPEARANCE,
      surfaceOpacity: clean.surfaceOpacity,
      blurPx: clean.blurPx,
      radiusPx: clean.radiusPx,
      interfaceStyle: "clean",
    });
    expect(preferences.appearance).not.toBe(draft.appearance);
  });

  it("keeps color mode, accent, wallpaper and the hidden iconSize verbatim", () => {
    const draft: WorkspaceSettingsDraft = {
      appearance: {
        ...DEFAULT_WORKSPACE_APPEARANCE,
        colorMode: "light",
        accentHue: 310,
        wallpaperPreset: "dawn",
        iconSize: "large",
        interfaceStyle: "soft",
      },
      defaultPageId: "page-1",
      layoutLocked: true,
      gridGapPx: 16,
      background: { workspace: undefined, pages: {} },
    };

    const preferences = preferencesFromSettingsDraft(draft);

    expect(preferences.appearance?.colorMode).toBe("light");
    expect(preferences.appearance?.accentHue).toBe(310);
    expect(preferences.appearance?.wallpaperPreset).toBe("dawn");
    expect(preferences.appearance?.iconSize).toBe("large");
  });

  it("round-trips through replaceWorkspacePreferences as a valid workspace edit", async () => {
    const { replaceWorkspacePreferences, validateWorkspace } = await import("@veladesk/domain");
    const snapshot = workspaceWith(true);
    const draft = createWorkspaceSettingsDraft(snapshot);

    const result = replaceWorkspacePreferences(snapshot, preferencesFromSettingsDraft(draft));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(validateWorkspace(result.workspace)).toEqual([]);
      // The legacy baseline normalizes into the canonical glass preset.
      expect(result.workspace.preferences.appearance).toEqual({
        colorMode: "dark",
        accentHue: 205,
        wallpaperPreset: "aurora",
        surfaceOpacity: 0.5,
        blurPx: 24,
        radiusPx: 18,
        interfaceStyle: "glass",
        iconSize: "medium",
      });
    }
  });
});

describe("areWorkspaceSettingsDraftsEqual", () => {
  const base: WorkspaceSettingsDraft = {
    appearance: { ...DEFAULT_WORKSPACE_APPEARANCE, interfaceStyle: "soft" },
    defaultPageId: "page-1",
    layoutLocked: true,
    gridGapPx: 16,
    background: { workspace: undefined, pages: {} },
  };

  it("treats identical drafts as equal", () => {
    expect(areWorkspaceSettingsDraftsEqual(base, { ...base })).toBe(true);
  });

  it("detects an appearance hue change", () => {
    const next = { ...base, appearance: { ...base.appearance, accentHue: 90 } };
    expect(areWorkspaceSettingsDraftsEqual(base, next)).toBe(false);
  });

  it("detects a wallpaper change", () => {
    const next = { ...base, appearance: { ...base.appearance, wallpaperPreset: "mist" as const } };
    expect(areWorkspaceSettingsDraftsEqual(base, next)).toBe(false);
  });

  it("detects an interface style change", () => {
    const next = { ...base, appearance: { ...base.appearance, interfaceStyle: "clean" as const } };
    expect(areWorkspaceSettingsDraftsEqual(base, next)).toBe(false);
  });

  it("detects a default page change", () => {
    expect(
      areWorkspaceSettingsDraftsEqual(base, { ...base, defaultPageId: "page-2" })
    ).toBe(false);
  });

  it("detects a layoutLocked change", () => {
    expect(areWorkspaceSettingsDraftsEqual(base, { ...base, layoutLocked: false })).toBe(false);
  });

  it("detects a grid gap change", () => {
    expect(areWorkspaceSettingsDraftsEqual(base, { ...base, gridGapPx: 8 })).toBe(false);
  });
});

describe("Settings V2 — hidden iconSize survives", () => {
  it("preserves the persisted iconSize through the draft with no control for it", async () => {
    const { replaceWorkspacePreferences, validateWorkspace } = await import("@veladesk/domain");
    const snapshot = workspaceWith(false);
    const withIconSize: WorkspaceSnapshot = {
      ...snapshot,
      preferences: {
        ...snapshot.preferences,
        appearance: { ...DEFAULT_WORKSPACE_APPEARANCE, iconSize: "large" },
      },
    };

    // Change an unrelated setting (the gap) and save.
    const draft = { ...createWorkspaceSettingsDraft(withIconSize), gridGapPx: 8 };
    const result = replaceWorkspacePreferences(
      withIconSize,
      preferencesFromSettingsDraft(draft),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspace.preferences.appearance?.iconSize).toBe("large");
      expect(result.workspace.preferences.gridGapPx).toBe(8);
      expect(validateWorkspace(result.workspace)).toEqual([]);
    }
  });
});
