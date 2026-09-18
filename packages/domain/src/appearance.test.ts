import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORKSPACE_APPEARANCE,
  resolveWorkspaceAppearance,
  validateWorkspaceAppearance,
} from "./appearance";
import { createEmptyWorkspace } from "./workspace";
import { validateWorkspace } from "./validation";
import type { WorkspaceAppearancePreferences } from "./types";

describe("DEFAULT_WORKSPACE_APPEARANCE", () => {
  it("is the exact Task014 default contract", () => {
    expect(DEFAULT_WORKSPACE_APPEARANCE).toEqual({
      colorMode: "dark",
      accentHue: 205,
      wallpaperPreset: "aurora",
      surfaceOpacity: 0.55,
      blurPx: 18,
      radiusPx: 14,
      iconSize: "medium",
    });
  });

  it("is semantically valid", () => {
    expect(validateWorkspaceAppearance(DEFAULT_WORKSPACE_APPEARANCE)).toEqual([]);
  });
});

describe("resolveWorkspaceAppearance", () => {
  it("resolves a legacy workspace without appearance to the exact defaults", () => {
    const resolved = resolveWorkspaceAppearance({
      defaultPageId: "page-1",
      layoutLocked: true,
    });

    expect(resolved).toEqual(DEFAULT_WORKSPACE_APPEARANCE);
  });

  it("keeps an explicit appearance verbatim (same reference, no copy)", () => {
    const appearance: WorkspaceAppearancePreferences = {
      ...DEFAULT_WORKSPACE_APPEARANCE,
      colorMode: "light",
      accentHue: 310,
    };
    const preferences = { defaultPageId: "page-1", layoutLocked: false, appearance };

    expect(resolveWorkspaceAppearance(preferences)).toBe(appearance);
  });

  it("never mutates the input preferences", () => {
    const preferences = { defaultPageId: "page-1", layoutLocked: true };
    resolveWorkspaceAppearance(preferences);

    expect(preferences).toEqual({ defaultPageId: "page-1", layoutLocked: true });
    expect("appearance" in preferences).toBe(false);
  });
});

describe("validateWorkspaceAppearance", () => {
  it("accepts every boundary of every range", () => {
    const boundaries: WorkspaceAppearancePreferences[] = [
      { ...DEFAULT_WORKSPACE_APPEARANCE, accentHue: 0 },
      { ...DEFAULT_WORKSPACE_APPEARANCE, accentHue: 359 },
      { ...DEFAULT_WORKSPACE_APPEARANCE, surfaceOpacity: 0.35 },
      { ...DEFAULT_WORKSPACE_APPEARANCE, surfaceOpacity: 0.9 },
      { ...DEFAULT_WORKSPACE_APPEARANCE, blurPx: 0 },
      { ...DEFAULT_WORKSPACE_APPEARANCE, blurPx: 32 },
      { ...DEFAULT_WORKSPACE_APPEARANCE, radiusPx: 8 },
      { ...DEFAULT_WORKSPACE_APPEARANCE, radiusPx: 24 },
    ];

    for (const appearance of boundaries) {
      expect(validateWorkspaceAppearance(appearance)).toEqual([]);
    }
  });

  it("accepts fractional surface opacity", () => {
    expect(
      validateWorkspaceAppearance({ ...DEFAULT_WORKSPACE_APPEARANCE, surfaceOpacity: 0.575 })
    ).toEqual([]);
  });

  it("rejects a non-integer, negative or over-range accent hue", () => {
    for (const accentHue of [-1, 360, 999, 20.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validateWorkspaceAppearance({ ...DEFAULT_WORKSPACE_APPEARANCE, accentHue })).toEqual([
        { type: "invalid-accent-hue" },
      ]);
    }
  });

  it("rejects a non-finite or out-of-range surface opacity", () => {
    for (const surfaceOpacity of [0.34, 0.91, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        validateWorkspaceAppearance({ ...DEFAULT_WORKSPACE_APPEARANCE, surfaceOpacity })
      ).toEqual([{ type: "invalid-surface-opacity" }]);
    }
  });

  it("rejects a non-integer or out-of-range blur", () => {
    for (const blurPx of [-1, 33, 4.5, Number.NaN]) {
      expect(validateWorkspaceAppearance({ ...DEFAULT_WORKSPACE_APPEARANCE, blurPx })).toEqual([
        { type: "invalid-blur-px" },
      ]);
    }
  });

  it("rejects a non-integer or out-of-range radius", () => {
    for (const radiusPx of [7, 25, 12.5, Number.NaN]) {
      expect(validateWorkspaceAppearance({ ...DEFAULT_WORKSPACE_APPEARANCE, radiusPx })).toEqual([
        { type: "invalid-radius-px" },
      ]);
    }
  });

  it("reports every defect in the fixed order hue, opacity, blur, radius", () => {
    const issues = validateWorkspaceAppearance({
      colorMode: "dark",
      accentHue: 999,
      wallpaperPreset: "aurora",
      surfaceOpacity: 5,
      blurPx: -3,
      radiusPx: 100,
      iconSize: "medium",
    });

    expect(issues).toEqual([
      { type: "invalid-accent-hue" },
      { type: "invalid-surface-opacity" },
      { type: "invalid-blur-px" },
      { type: "invalid-radius-px" },
    ]);
  });
});

describe("createEmptyWorkspace appearance", () => {
  it("explicitly produces the default appearance", () => {
    const workspace = createEmptyWorkspace({
      workspaceId: "workspace-1",
      workspaceName: "My Desk",
      pageId: "page-1",
      pageName: "Home",
      grid: { columns: 12, rows: 8 },
    });

    expect(workspace.preferences.appearance).toEqual(DEFAULT_WORKSPACE_APPEARANCE);
  });

  it("factory output passes validateWorkspace with no issues", () => {
    const workspace = createEmptyWorkspace({
      workspaceId: "workspace-1",
      workspaceName: "My Desk",
      pageId: "page-1",
      pageName: "Home",
      grid: { columns: 12, rows: 8 },
    });

    expect(validateWorkspace(workspace)).toEqual([]);
  });
});
