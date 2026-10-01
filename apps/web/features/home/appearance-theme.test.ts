import { describe, expect, it } from "vitest";

import { DEFAULT_WORKSPACE_APPEARANCE, resolveInterfaceStyle } from "@veladesk/domain";
import type { WorkspaceAppearancePreferences } from "@veladesk/domain";

import { buildAppearanceTheme, ICON_SIZE_PX } from "./appearance-theme";

function appearanceWith(overrides: Partial<WorkspaceAppearancePreferences>): WorkspaceAppearancePreferences {
  return { ...DEFAULT_WORKSPACE_APPEARANCE, ...overrides };
}

function surfaceSignature(theme: ReturnType<typeof buildAppearanceTheme>): string {
  return [
    theme.style["--vd-surface-opacity"],
    theme.style["--vd-blur"],
    theme.style["--vd-radius"],
    theme.style["--vd-surface-border-strength"],
    theme.style["--vd-surface-shadow"],
  ].join("|");
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
        "--vd-surface-border-strength": "1",
        "--vd-icon-size": "62px",
      },
    });
  });

  it("renders a pre-019-D appearance from its persisted raw values (no silent restyle)", () => {
    const legacy = appearanceWith({ surfaceOpacity: 0.4, blurPx: 6, radiusPx: 20 });
    const theme = buildAppearanceTheme(legacy);

    expect(theme.style["--vd-surface-opacity"]).toBe("0.4");
    expect(theme.style["--vd-blur"]).toBe("6px");
    expect(theme.style["--vd-radius"]).toBe("20px");
    // No shadow/window tokens: the desktop CSS keeps its per-surface
    // fallbacks and the overlay windows stay solid, exactly as before.
    expect(theme.style["--vd-surface-shadow"]).toBeUndefined();
    expect(theme.style["--vd-window-alpha"]).toBeUndefined();
    expect(theme.style["--vd-window-blur"]).toBeUndefined();
  });

  it("resolves a persisted interface style through the canonical resolver", () => {
    const theme = buildAppearanceTheme(appearanceWith({ interfaceStyle: "clean" }));
    const clean = resolveInterfaceStyle("clean");

    expect(theme.style["--vd-surface-opacity"]).toBe(String(clean.surfaceOpacity));
    expect(theme.style["--vd-blur"]).toBe(`${clean.blurPx}px`);
    expect(theme.style["--vd-radius"]).toBe(`${clean.radiusPx}px`);
    expect(theme.style["--vd-surface-border-strength"]).toBe(String(clean.borderStrength));
    expect(theme.style["--vd-surface-shadow"]).toBe("none");
    // The overlay layer (settings window, dialogs, popovers) follows the
    // style: the interface must visibly change while previewing.
    expect(theme.style["--vd-window-alpha"]).toBe(String(clean.surfaceStrongOpacity));
    expect(theme.style["--vd-window-blur"]).toBe(`${clean.blurPx}px`);
  });

  it("produces different surface output for every interface style", () => {
    const styles = ["clean", "soft", "glass"] as const;
    const signatures = new Set(
      styles.map((interfaceStyle) =>
        surfaceSignature(buildAppearanceTheme(appearanceWith({ interfaceStyle }))),
      ),
    );

    // The ownership contract: the style control can never be disconnected —
    // each style MUST change the resolved theme output.
    expect(signatures.size).toBe(styles.length);
  });

  it("passes the accent hue through at both range boundaries", () => {
    const low = buildAppearanceTheme(appearanceWith({ accentHue: 0 }));
    const high = buildAppearanceTheme(appearanceWith({ accentHue: 359 }));

    expect(low.style["--vd-accent-hue"]).toBe("0");
    expect(high.style["--vd-accent-hue"]).toBe("359");
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
      "--vd-surface-border-strength",
      "--vd-surface-shadow",
      "--vd-window-alpha",
      "--vd-window-blur",
      "--vd-icon-size",
    ]);

    for (const appearance of [
      DEFAULT_WORKSPACE_APPEARANCE,
      appearanceWith({ interfaceStyle: "soft" }),
    ]) {
      const style = buildAppearanceTheme(appearance).style;
      for (const key of Object.keys(style)) {
        expect(allowed.has(key)).toBe(true);
      }
    }
  });
});
