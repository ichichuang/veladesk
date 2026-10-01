import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

/**
 * Static contract for the Settings Center (task 019-D §21).
 *
 * Product semantics over developer controls: the raw surface CSS values
 * (opacity/blur/radius) are NOT user controls, the accent is swatch-first,
 * there is no Advanced group and no update-check pseudo-status, and every
 * control is a canonical HeroUI component (themed through the --vdu-*
 * bridge) — never a browser-native control and never a duplicate hand-built
 * equivalent. Draft semantics (dirty / Cancel drops / Save normalizes) are
 * covered by settings-draft.test.ts; theme output by appearance-theme.test.ts.
 */

const settingsSource = readFileSync(
  fileURLToPath(new URL("./settings-center.tsx", import.meta.url)),
  "utf8"
);

const css = readFileSync(
  fileURLToPath(new URL("./home-shell.css", import.meta.url)),
  "utf8"
);

const animatedSurfaceSource = readFileSync(
  fileURLToPath(new URL("../../components/vd/animated-surface.tsx", import.meta.url)),
  "utf8"
);

/** The argument lists of every gsap.set/to/from/fromTo call (balanced parens). */
function gsapCalls(source: string): string[] {
  const calls: string[] = [];
  for (const match of source.matchAll(/gsap\.(?:set|to|from|fromTo)\s*\(/g)) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (end < source.length && depth > 0) {
      const ch = source[end];
      if (ch === "(") {
        depth += 1;
      } else if (ch === ")") {
        depth -= 1;
      }
      end += 1;
    }
    calls.push(source.slice(match.index + match[0].length, end - 1));
  }
  return calls;
}

describe("settings: no raw surface CSS controls (019-D §3/§5)", () => {
  it("never renders opacity / blur / radius controls", () => {
    for (const gone of [
      "surfaceOpacity",
      "blurPx",
      "radiusPx",
      "surface-opacity",
      "settings.blur",
      "settings.cornerRadius",
      "settings.surfaceOpacity",
      "advancedAppearance",
      "Collapsible",
    ]) {
      expect(settingsSource, gone).not.toContain(gone);
    }
    // The dead Advanced group CSS is gone with it.
    expect(css).not.toMatch(/\.vela-settings/);
  });

  it("replaced the raw trio with the interface style control", () => {
    expect(settingsSource).toContain("INTERFACE_STYLES");
    expect(settingsSource).toContain("settings.interfaceStyle");
    expect(settingsSource).toMatch(/updateAppearance\(\{ interfaceStyle: value as WorkspaceInterfaceStyle \}\)/);
  });

  it("keeps the desktop (not the settings window) the surface consumer", () => {
    // Home-shell floats consume the resolved tokens; the settings window
    // itself stays solid by construction (vd-ui bridge).
    expect(css).toMatch(/var\(--vd-surface-shadow, /);
    expect(css).toMatch(/var\(--vd-surface-border, var\(--vd-border\)\)/);
  });
});

describe("settings: accent and status (019-D §5)", () => {
  it("offers curated swatches — no raw hue-degree slider as the primary UI", () => {
    expect(settingsSource).toContain("ACCENT_SWATCH_HUES");
    expect(settingsSource).not.toMatch(/max=\{359\}/);
    expect(settingsSource).not.toContain("settings.accentHue");
  });

  it("has no update-check pseudo-status in the footer", () => {
    expect(settingsSource).not.toContain("settings.upToDate");
    expect(settingsSource).toContain("settings.unsavedChanges");
  });
});

describe("settings: canonical component path (019-D §7/§20)", () => {
  it("uses the canonical HeroUI controls", () => {
    for (const component of [
      "Button",
      "CloseButton",
      "Select",
      "ListBox",
      "Slider",
      "ToggleButtonGroup",
      "ToggleButton",
    ]) {
      expect(settingsSource, component).toMatch(
        new RegExp(`import \\{[^}]*\\b${component}\\b[^}]*\\} from "@heroui/react"`)
      );
    }
    // The boolean switch rides the canonical composite (task 020-A1 §14):
    // VdSwitch wraps HeroUI's Switch with the interactive Switch.Content —
    // a bare Control/Thumb composite renders zero interactive elements.
    expect(settingsSource).toContain("VdSwitch");
  });

  it("renders no browser-native select/range/checkbox/color control", () => {
    expect(settingsSource).not.toMatch(/<select/);
    expect(settingsSource).not.toMatch(/type="range"/);
    expect(settingsSource).not.toMatch(/type="checkbox"/);
    expect(settingsSource).not.toMatch(/type="color"/);
    // Radix wrappers (the 018 components) stay off this surface except the
    // themed Dialog shell and the custom color Popover product piece.
    expect(settingsSource).not.toMatch(/from "@components\/ui\/(select|slider|switch|toggle-group)"/);
  });

  it("marks the painted surface as size owner and declares no competing geometry (023-R2)", () => {
    // The size owner is the CANONICAL stylesheet rule on the marked
    // painted surface (asserted by the 023-R2 rule test below) — never
    // utility classes on the node, and the marker is wired explicitly.
    expect(settingsSource).toMatch(
      /surfaceProps=\{\{\s*"data-settings-surface":\s*""\s*\}\}/,
    );
    expect(settingsSource).toMatch(/w-\[160px\]/);
    expect(settingsSource).toMatch(/data-vd-wheel-scope="local"/);
    // No competing geometry in the component: the old utility rows and
    // min()-size classes must stay gone (including space-less calc, which
    // the CSS parser drops — the pre-023-R1 content-sized-window defect).
    expect(settingsSource).not.toMatch(/grid-rows-\[/);
    expect(settingsSource).not.toMatch(/w-\[min\(/);
    expect(settingsSource).not.toMatch(/h-\[min\(/);
    expect(settingsSource).not.toMatch(/calc\(100[vd]{2}h?-\d+px\)/);
  });

  it("owns the frame through ONE canonical rule on the marked painted surface (023-R2)", () => {
    const selector =
      "\\[data-vd-ui\\] \\[data-settings-dialog\\] > \\[data-settings-surface\\]";
    const rule = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1];
    expect(rule).toBeDefined();
    expect(rule!.trim().length).toBeGreaterThan(0);

    // The EXACT desktop frame: plain definite values — no min(), no
    // content contribution, no flex-basis, no chain of 100% heights.
    expect(rule).toMatch(/box-sizing:\s*border-box/);
    expect(rule).toMatch(/width:\s*880px/);
    expect(rule).toMatch(/height:\s*680px/);
    // The surface — not the flex algorithm — owns its main size inside
    // the outer positioning node's column.
    expect(rule).toMatch(/flex:\s*none/);

    // Small viewports clamp the exact frame (16px viewport margins).
    expect(rule).toMatch(/max-width:\s*calc\(100vw\s*-\s*32px\)/);
    expect(rule).toMatch(/max-height:\s*calc\(100vh\s*-\s*32px\)/);
    expect(css).toMatch(
      new RegExp(
        `@supports\\s*\\(height:\\s*100dvh\\)[\\s\\S]{0,400}${selector}\\s*\\{[^}]*max-height:\\s*calc\\(100dvh\\s*-\\s*32px\\)`,
      ),
    );

    // The internal three-row window (fixed header / flexible body / fixed
    // footer) is owned by the same rule — never by utility order.
    expect(rule).toMatch(/display:\s*grid/);
    expect(rule).toMatch(/grid-template-rows:\s*52px\s+minmax\(0,\s*1fr\)\s+60px/);
    // The frame never grows for its content and clips to the radius.
    expect(rule).toMatch(/overflow:\s*hidden/);

    // Nothing content-derived in the size contract.
    expect(rule).not.toMatch(/height:\s*auto/);
    expect(rule).not.toMatch(/max-content|fit-content|min\(/);

    // The superseded 023-R1 generic-surface rule is GONE — exactly one
    // production size owner remains.
    expect(css).not.toMatch(/\[data-settings-dialog\] > \[data-vd-surface\]/);
  });

  it("no GSAP call in the settings animation path writes frame geometry (023-R2)", () => {
    // The window enter/exit and the pane cross-fade animate opacity and
    // transforms only; the 880×680 frame is never animated.
    for (const [file, source] of [
      ["animated-surface.tsx", animatedSurfaceSource],
      ["settings-center.tsx", settingsSource],
    ] as const) {
      for (const call of gsapCalls(source)) {
        expect(call, `${file}: gsap(${call})`).not.toMatch(
          /\b(width|height|maxWidth|maxHeight|minWidth|minHeight)\s*:/,
        );
      }
    }
  });

  it("the background editor is compact: fixed-height art band and pane-width columns (023-R1)", () => {
    // Compact art: a fixed-height preview band, not a full-desktop 16:9
    // window whose height expands with card width.
    expect(css).toMatch(/\.vela-wallpaper-surface--thumb-art\s*\{[\s\S]*?height:\s*72px/);
    expect(css).not.toMatch(/\.vela-wallpaper-surface--thumbnail/);
    // Columns follow the settings pane's OWN width (container query), not
    // viewport media queries: two by default, four from 560px.
    expect(css).toMatch(
      /\.vela-wallpaper-choices\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(
      /@container\s*\(min-width:\s*560px\)\s*\{[\s\S]*?\.vela-wallpaper-choices\s*\{[\s\S]*?repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(/\[data-vd-ui\] \[data-settings-pane\]\s*\{[\s\S]*?container-type:\s*inline-size/);
    // The custom-image entry precedes the preset collection in source
    // order, right after the scope/inheritance area.
    const imageRow = settingsSource.indexOf('data-testid="background-image-row"');
    const presetGrid = settingsSource.indexOf('data-testid="wallpaper-preset-grid"');
    expect(imageRow).toBeGreaterThan(-1);
    expect(presetGrid).toBeGreaterThan(imageRow);
    // The effective upload cap is rendered from the shared core constant.
    expect(settingsSource).toMatch(/MAX_ASSET_BYTES/);
  });

  it("the shared dialog clamps use VALID calc (underscores), never space-less calc", () => {
    const dialog = readFileSync(
      fileURLToPath(new URL("../../components/ui/dialog.tsx", import.meta.url)),
      "utf8",
    );
    expect(dialog).not.toMatch(/calc\(100[vd]{2}h?-\d+px\)/);
    expect(dialog).not.toMatch(/calc\(100dvh-\d+px\)/);
    expect(dialog).toMatch(/max-w-\[calc\(100vw_-_32px\)\]/);
  });

  it("the interface style is one compact single-select — no fabricated previews (023-B.4)", () => {
    expect(settingsSource).not.toMatch(/InterfaceStylePreview/);
    // The selector keeps controlled selection semantics and the selected
    // choice's one concise description.
    expect(settingsSource).toMatch(/data-interface-style-hint/);
    expect(settingsSource).toMatch(/INTERFACE_STYLE_HINT_KEY\[selectedStyle\]/);
  });

  it("switches section content only — never the window (022 GSAP pane)", () => {
    expect(settingsSource).toMatch(/data-settings-section=\{activeSection\}/);
    // The pane interpolation is GSAP on the tabContent token; no Motion
    // and no ad-hoc durations.
    expect(settingsSource).toMatch(/VD_MOTION\.tabContent/);
    expect(settingsSource).not.toMatch(/AnimatePresence|from "motion/);
  });

  it("owns animation timing through the tokens, not ad-hoc springs", () => {
    expect(settingsSource).not.toMatch(/type: "spring"/);
    expect(settingsSource).not.toMatch(/duration:\s*0?\.\d+/);
  });

  it("navigates with full-width centered tab rows, not a floating pill box", () => {
    expect(settingsSource).toMatch(/role="tablist"/);
    expect(settingsSource).toMatch(/role="tab"/);
    expect(settingsSource).toMatch(/aria-selected=\{active\}/);
    expect(settingsSource).toMatch(/justify-center/);
    expect(settingsSource).not.toMatch(/Tabs\.ListContainer/);
  });

  it("the window surface follows the interface style (019-D live preview)", () => {
    // The theme emits window tokens when (and only when) a style is active;
    // the dialog shell consumes them so the choice is visible in place.
    expect(settingsSource).toMatch(/data-vd-wheel-scope="local"/);
    const themeSource = readFileSync(
      fileURLToPath(new URL("./appearance-theme.ts", import.meta.url)),
      "utf8",
    );
    expect(themeSource).toMatch(/--vd-window-alpha/);
    expect(themeSource).toMatch(/--vd-window-blur/);
    const dialogSource = readFileSync(
      fileURLToPath(new URL("../../components/ui/dialog.tsx", import.meta.url)),
      "utf8",
    );
    expect(dialogSource).toMatch(/bg-\[var\(--vdu-window\)\]/);
    expect(dialogSource).toMatch(/backdrop-blur-\[var\(--vdu-window-blur\)\]/);
  });
});
