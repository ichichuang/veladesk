import { describe, expect, it } from "vitest";

import { DEFAULT_WORKSPACE_APPEARANCE } from "@veladesk/domain";
import type { WorkspaceAppearancePreferences } from "@veladesk/domain";

import { buildAppearanceTheme, ICON_SIZE_PX } from "./appearance-theme";

function appearanceWith(overrides: Partial<WorkspaceAppearancePreferences>): WorkspaceAppearancePreferences {
  return { ...DEFAULT_WORKSPACE_APPEARANCE, ...overrides };
}

describe("buildAppearanceTheme", () => {
  it("maps the exact defaults to the Task013 baseline CSS variables", () => {
    expect(buildAppearanceTheme(DEFAULT_WORKSPACE_APPEARANCE)).toEqual({
      colorMode: "dark",
      wallpaperPreset: "aurora",
      style: {
        "--vd-accent-hue": "205",
        "--vd-surface-opacity": "0.55",
        "--vd-surface-strong-opacity": "0.78",
        "--vd-blur": "18px",
        "--vd-radius": "14px",
        "--vd-icon-size": "62px",
      },
    });
  });

  it("passes the accent hue through at both range boundaries", () => {
    const low = buildAppearanceTheme(appearanceWith({ accentHue: 0 }));
    const high = buildAppearanceTheme(appearanceWith({ accentHue: 359 }));

    expect(low.style["--vd-accent-hue"]).toBe("0");
    expect(high.style["--vd-accent-hue"]).toBe("359");
  });

  it("computes the strong surface opacity from the base opacity", () => {
    const low = buildAppearanceTheme(appearanceWith({ surfaceOpacity: 0.35 }));
    expect(low.style["--vd-surface-opacity"]).toBe("0.35");
    expect(low.style["--vd-surface-strong-opacity"]).toBe("0.58");
  });

  it("clamps the strong surface opacity at 0.98", () => {
    const high = buildAppearanceTheme(appearanceWith({ surfaceOpacity: 0.9 }));

    expect(high.style["--vd-surface-opacity"]).toBe("0.9");
    expect(high.style["--vd-surface-strong-opacity"]).toBe("0.98");
  });

  it("passes blur through at both boundaries", () => {
    expect(buildAppearanceTheme(appearanceWith({ blurPx: 0 })).style["--vd-blur"]).toBe("0px");
    expect(buildAppearanceTheme(appearanceWith({ blurPx: 32 })).style["--vd-blur"]).toBe("32px");
  });

  it("passes radius through at both boundaries", () => {
    expect(buildAppearanceTheme(appearanceWith({ radiusPx: 8 })).style["--vd-radius"]).toBe("8px");
    expect(buildAppearanceTheme(appearanceWith({ radiusPx: 24 })).style["--vd-radius"]).toBe("24px");
  });

  it("maps every icon size to a fixed pixel size around the Task013 medium baseline", () => {
    expect(ICON_SIZE_PX.small).toBe(Math.round(62 * 0.85));
    expect(ICON_SIZE_PX.medium).toBe(62);
    expect(ICON_SIZE_PX.large).toBe(Math.round(62 * 1.15));

    expect(buildAppearanceTheme(appearanceWith({ iconSize: "small" })).style["--vd-icon-size"]).toBe(
      `${ICON_SIZE_PX.small}px`,
    );
    expect(buildAppearanceTheme(appearanceWith({ iconSize: "large" })).style["--vd-icon-size"]).toBe(
      `${ICON_SIZE_PX.large}px`,
    );
  });

  it("passes color mode and wallpaper preset through untouched", () => {
    const theme = buildAppearanceTheme(
      appearanceWith({ colorMode: "system", wallpaperPreset: "dawn" }),
    );

    expect(theme.colorMode).toBe("system");
    expect(theme.wallpaperPreset).toBe("dawn");
  });

  it("only ever emits the fixed allowlist of CSS custom properties", () => {
    const allowed = new Set([
      "--vd-accent-hue",
      "--vd-surface-opacity",
      "--vd-surface-strong-opacity",
      "--vd-blur",
      "--vd-radius",
      "--vd-icon-size",
    ]);

    const style = buildAppearanceTheme(DEFAULT_WORKSPACE_APPEARANCE).style;
    for (const key of Object.keys(style)) {
      expect(allowed.has(key)).toBe(true);
    }
    expect(Object.keys(style)).toHaveLength(allowed.size);
  });
});
