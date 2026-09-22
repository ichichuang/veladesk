import { describe, expect, it } from "vitest";
import type { AppShortcut } from "@veladesk/domain";
import { DEFAULT_APP_VISUAL_STYLE } from "@veladesk/domain";

import {
  appGlyphColorModel,
  appIconDisplayText,
  appVisual,
  buildAppIconStyleVars,
  decorationBackground,
  generatedIconFollowsName,
  iconSvgUrl,
  iconSvgUrlForId,
  iconifyGlyphModel,
  normalizeAppHexColor,
  parseIconifyIconId,
  rgbaFromAppHex,
  shadedAppHex,
} from "./app-icon";

function makeApp(overrides: Partial<AppShortcut> = {}): AppShortcut {
  return {
    kind: "app",
    id: "app-1",
    name: "GitHub",
    url: "https://github.com",
    icon: { kind: "generated", text: "GI" },
    openMode: "new-tab",
    tags: [],
    ...overrides,
  };
}

describe("parseIconifyIconId", () => {
  it("parses ids of every bundled collection", () => {
    expect(parseIconifyIconId("simple-icons:github")).toEqual({
      collection: "simple-icons",
      name: "github",
    });
    expect(parseIconifyIconId("lucide:terminal")).toEqual({
      collection: "lucide",
      name: "terminal",
    });
    expect(parseIconifyIconId("tabler:server")).toEqual({ collection: "tabler", name: "server" });
    expect(parseIconifyIconId("ph:robot")).toEqual({ collection: "ph", name: "robot" });
    expect(parseIconifyIconId("fluent-color:mail-24")).toEqual({
      collection: "fluent-color",
      name: "mail-24",
    });
    expect(parseIconifyIconId("devicon:docker")).toEqual({
      collection: "devicon",
      name: "docker",
    });
    // The collection id itself carries a dash.
    expect(parseIconifyIconId("vscode-icons:file-type-reactjs")).toEqual({
      collection: "vscode-icons",
      name: "file-type-reactjs",
    });
    expect(parseIconifyIconId("catppuccin:typescript")).toEqual({
      collection: "catppuccin",
      name: "typescript",
    });
    expect(parseIconifyIconId("noto:robot")).toEqual({ collection: "noto", name: "robot" });
  });

  it("accepts dashed and digit names", () => {
    expect(parseIconifyIconId("tabler:brand-github")).toEqual({
      collection: "tabler",
      name: "brand-github",
    });
    expect(parseIconifyIconId("lucide:grid-2x2")).toEqual({
      collection: "lucide",
      name: "grid-2x2",
    });
  });

  it("rejects unknown collections and malformed names", () => {
    for (const bad of [
      "material-symbols:home",
      "github",
      ":github",
      "lucide:",
      "lucide:GitHub",
      "lucide:../etc/passwd",
      "lucide:a b",
      "lucide:home--",
      "lucide:-home",
      "simple-icons:github:extra",
      "vscode-icons:file-type-reactjs:extra",
    ]) {
      expect(parseIconifyIconId(bad)).toBeUndefined();
    }
  });
});

describe("iconifyGlyphModel", () => {
  it("draws monochrome collections through the mask model", () => {
    for (const id of ["simple-icons:github", "lucide:terminal", "tabler:server", "ph:robot"]) {
      expect(iconifyGlyphModel(id), id).toEqual({
        kind: "mask",
        url: iconSvgUrl(...(id.split(":") as [string, string])),
      });
    }
  });

  it("draws multicolor collections through the image model", () => {
    for (const id of [
      "fluent-color:mail-24",
      "devicon:docker",
      "vscode-icons:file-type-reactjs",
      "catppuccin:typescript",
      "noto:robot",
    ]) {
      const model = iconifyGlyphModel(id);
      expect(model?.kind, id).toBe("image");
      // Still the self-hosted same-origin SVG route — never a CDN.
      expect(model?.url, id).toMatch(/^\/api\/v1\/icons\//);
      expect(model?.url, id).not.toMatch(/^https?:/);
    }
  });

  it("returns undefined for ids that can never render", () => {
    expect(iconifyGlyphModel("material-symbols:home")).toBeUndefined();
    expect(iconifyGlyphModel("garbage")).toBeUndefined();
  });
});

describe("appGlyphColorModel", () => {
  it("tints monochrome library icons and generated text", () => {
    expect(appGlyphColorModel(makeApp({ icon: { kind: "iconify", icon: "lucide:house" } }))).toBe(
      "tinted"
    );
    expect(appGlyphColorModel(makeApp())).toBe("tinted");
  });

  it("leaves multicolor libraries and uploaded images in their own colors", () => {
    expect(appGlyphColorModel(makeApp({ icon: { kind: "iconify", icon: "devicon:docker" } }))).toBe(
      "original"
    );
    expect(
      appGlyphColorModel(makeApp({ icon: { kind: "iconify", icon: "noto:robot" } }))
    ).toBe("original");
    expect(appGlyphColorModel(makeApp({ icon: { kind: "asset", assetId: "a1" } }))).toBe(
      "original"
    );
  });
});

describe("icon SVG endpoint URLs", () => {
  it("builds the self-hosted .svg URL", () => {
    expect(iconSvgUrl("simple-icons", "github")).toBe("/api/v1/icons/simple-icons/github.svg");
  });

  it("builds URLs only for valid parsed ids", () => {
    expect(iconSvgUrlForId("lucide:terminal")).toBe("/api/v1/icons/lucide/terminal.svg");
    expect(iconSvgUrlForId("unknown:icon")).toBeUndefined();
    expect(iconSvgUrlForId("garbage")).toBeUndefined();
  });
});

describe("controlled color math", () => {
  it("shades validated hex colors within byte bounds", () => {
    expect(shadedAppHex("#808080", 2)).toBe("#ffffff");
    expect(shadedAppHex("#808080", 0)).toBe("#000000");
    expect(shadedAppHex("#3366FF", 1)).toBe("#3366ff");
  });

  it("converts validated hex to rgba", () => {
    expect(rgbaFromAppHex("#FF0000", 0.34)).toBe("rgba(255, 0, 0, 0.34)");
  });

  it("normalizes case-valid colors to lowercase and rejects the rest", () => {
    expect(normalizeAppHexColor("#AABBCC")).toBe("#aabbcc");
    expect(normalizeAppHexColor(" #00ff7f ")).toBe("#00ff7f");
    expect(normalizeAppHexColor("red")).toBeUndefined();
    expect(normalizeAppHexColor("")).toBeUndefined();
    expect(normalizeAppHexColor(undefined)).toBeUndefined();
  });
});

describe("decorationBackground", () => {
  it("composes a controlled two-stop gradient from the validated color", () => {
    const background = decorationBackground("gradient", "#3366FF");

    expect(background).toMatch(/^linear-gradient\(150deg, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
    expect(background).not.toContain("#3366FF");
    expect(background).toBe("linear-gradient(150deg, #3c78ff, #2549b8)");
  });

  it("uses the solid color directly", () => {
    expect(decorationBackground("solid", "#3366FF")).toBe("#3366ff");
  });

  it("renders glass as a translucent rgba of the color", () => {
    expect(decorationBackground("glass", "#3366FF")).toBe("rgba(51, 102, 255, 0.34)");
  });

  it("ignores the decoration color for the none style", () => {
    expect(decorationBackground("none", "#3366FF")).toBe("transparent");
  });
});

describe("buildAppIconStyleVars", () => {
  it("emits the resolved presentation vars for the default style (017-C)", () => {
    // The label var is always emitted: the label is a SIBLING of the tile,
    // so the item button carries it for both. Default resolves to 1.
    expect(buildAppIconStyleVars(DEFAULT_APP_VISUAL_STYLE)).toEqual({
      "--vd-app-icon-scale": "1",
      "--vd-app-label-scale": "1",
    });
  });

  it("resolves absent label fields to the shown/100% defaults", () => {
    const vars = buildAppIconStyleVars({ iconScale: 1.15, decorationStyle: "glass" });

    expect(vars["--vd-app-label-scale"]).toBe("1");
  });

  it("carries a custom label scale and custom colors through composed values", () => {
    const vars = buildAppIconStyleVars({
      iconScale: 1.15,
      decorationStyle: "glass",
      labelScale: 1.4,
      foregroundColor: "#AABBCC",
      decorationColor: "#112233",
    });

    expect(vars["--vd-app-icon-scale"]).toBe("1.15");
    expect(vars["--vd-app-label-scale"]).toBe("1.4");
    expect(vars["--vd-app-icon-bg"]).toBe("rgba(17, 34, 51, 0.34)");
    expect(vars["--vd-app-icon-fg"]).toBe("#aabbcc");
  });

  it("ignores persisted-but-invalid colors (validation owns the error)", () => {
    const vars = buildAppIconStyleVars({
      iconScale: 1,
      decorationStyle: "solid",
      foregroundColor: "alert(1)",
      decorationColor: "var(--x)",
    });

    expect(vars["--vd-app-icon-bg"]).toBeUndefined();
    expect(vars["--vd-app-icon-fg"]).toBeUndefined();
  });
});

describe("appIconDisplayText", () => {
  it("shows generated text verbatim (auto or custom)", () => {
    expect(appIconDisplayText(makeApp({ icon: { kind: "generated", text: "GI" } }))).toBe("GI");
    expect(
      appIconDisplayText(makeApp({ icon: { kind: "generated", text: "AI", source: "custom" } }))
    ).toBe("AI");
  });

  it("falls back to derived initials for blank generated text", () => {
    expect(
      appIconDisplayText(makeApp({ name: "ChatGPT", icon: { kind: "generated", text: "  " } }))
    ).toBe("CH");
  });

  it("derives initials for every non-generated icon kind", () => {
    expect(appIconDisplayText(makeApp({ icon: { kind: "iconify", icon: "ph:robot" } }))).toBe("GI");
    expect(appIconDisplayText(makeApp({ icon: { kind: "favicon" } }))).toBe("GI");
    expect(appIconDisplayText(makeApp({ icon: { kind: "asset", assetId: "a1" } }))).toBe("GI");
  });
});

describe("generatedIconFollowsName", () => {
  it("follows renames only for auto-sourced generated icons", () => {
    expect(generatedIconFollowsName(makeApp())).toBe(true);
    expect(
      generatedIconFollowsName(makeApp({ icon: { kind: "generated", text: "GI", source: "auto" } }))
    ).toBe(true);
    expect(
      generatedIconFollowsName(
        makeApp({ icon: { kind: "generated", text: "AI", source: "custom" } })
      )
    ).toBe(false);
    expect(
      generatedIconFollowsName(makeApp({ icon: { kind: "iconify", icon: "ph:robot" } }))
    ).toBe(false);
  });
});

describe("appVisual", () => {
  it("resolves the effective style through the domain resolver", () => {
    const style = { iconScale: 1.6, decorationStyle: "none" } as const;
    expect(appVisual(makeApp({ visual: style }))).toEqual(style);
    expect(appVisual(makeApp())).toEqual(DEFAULT_APP_VISUAL_STYLE);
  });
});
