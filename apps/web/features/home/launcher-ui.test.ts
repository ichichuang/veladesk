import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Task 021-B launcher surface contracts: the redesign is presentation
 * only — search/ranking/keyboard semantics keep their pure modules, the
 * results scroll through the canonical VdScrollArea with the search field
 * and hints OUTSIDE the scroller, app rows render through the SHARED icon
 * renderer, type metadata is quiet text (the old bordered capsule is
 * gone), and the selection stays keyboard-addressable.
 */

const launcher = readFileSync(fileURLToPath(new URL("./launcher.tsx", import.meta.url)), "utf8");
const css = readFileSync(fileURLToPath(new URL("./home-shell.css", import.meta.url)), "utf8");

function ruleBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "m"));
  if (match === null) {
    throw new Error(`CSS rule not found: ${selector}`);
  }
  return match[1]!;
}

describe("launcher structure (021-B)", () => {
  it("renders the results through the canonical VdScrollArea", () => {
    expect(launcher).toMatch(/<VdScrollArea\s+axis="y"\s+className="vela-launcher__results-scroll"/);
    expect(launcher).toMatch(/@components\/vd\/scroll-area/);
  });

  it("keeps the search header OUTSIDE the results scroller", () => {
    const inputIndex = launcher.indexOf("vela-launcher__input");
    const scrollIndex = launcher.indexOf("vela-launcher__results-scroll");
    expect(inputIndex).toBeGreaterThanOrEqual(0);
    expect(scrollIndex).toBeGreaterThan(inputIndex);
  });

  it("keeps the hint footer OUTSIDE the results scroller", () => {
    const scrollClose = launcher.lastIndexOf("</VdScrollArea>");
    const footerIndex = launcher.indexOf("vela-launcher__footer");
    expect(scrollClose).toBeGreaterThanOrEqual(0);
    expect(footerIndex).toBeGreaterThan(scrollClose);
  });

  it("groups results with the pure helper and renders headings per group", () => {
    expect(launcher).toMatch(/from "\.\/launcher-groups"/);
    expect(launcher).toMatch(/groupLauncherResults\(/);
    expect(launcher).toMatch(/flattenLauncherGroups\(/);
    expect(launcher).toMatch(/vela-launcher__group-label/);
  });
});

describe("launcher rows (021-B)", () => {
  it("renders app icons through the SHARED renderer, never a private one", () => {
    expect(launcher).toMatch(/AppIconGlyph/);
    expect(launcher).toMatch(/appIconDecorationProps/);
    // The compact variant is the shared slot variable — one geometry source.
    expect(ruleBlock(".vela-launcher__icon")).toMatch(/--vd-slot-icon-size:\s*26px/);
    // No duplicated icon implementation: no raw img/mask logic in the launcher.
    expect(launcher).not.toMatch(/maskImage|WebkitMaskImage|new Image\(|createObjectURL/);
  });

  it("keeps type metadata as quiet text — the bordered capsule badge is gone", () => {
    const kind = ruleBlock(".vela-launcher__kind");
    expect(kind).not.toMatch(/border:/);
    expect(kind).not.toMatch(/border-radius:\s*999px/);
    expect(kind).not.toMatch(/padding:\s*2px 8px/);
  });

  it("marks the selected row with a quiet accent bar, not a saturated slab", () => {
    const active = ruleBlock('.vela-launcher__option[data-active="true"]::before');
    expect(active).toMatch(/width:\s*2px/);
    const fill = ruleBlock('.vela-launcher__option[data-active="true"]');
    // The row fill is a quiet surface token, never a high-saturation accent fill.
    expect(fill).toMatch(/background:\s*var\(--vdu-bg-active/);
  });

  it("the panel entrance is GSAP-owned with open-driven presence (022)", () => {
    // The stylesheet keyframes are gone; the launcher panel is a
    // VdAnimatedSurface (launcher variant, popup-band duration) inside a
    // presence controller — no CSS animation on the panel.
    const panel = ruleBlock(".vela-launcher");
    expect(panel).not.toMatch(/animation:/);
    expect(launcher).toMatch(/VdAnimatedSurface/);
    expect(launcher).toMatch(/useVdPresence/);
    expect(launcher).toMatch(/variant="launcher"/);
    expect(launcher).toMatch(/open-driven/i);
  });
});

describe("launcher semantics preserved (013 contract, restyled 021-B)", () => {
  it("keeps the combobox pattern: aria-activedescendant over options, focus stays in the input", () => {
    expect(launcher).toMatch(/aria-activedescendant=\{activeIndex >= 0 \? optionId\(activeIndex\) : undefined\}/);
    expect(launcher).toMatch(/role="combobox"/);
    expect(launcher).toMatch(/role="option"/);
    expect(launcher).toMatch(/aria-selected=\{active\}/);
  });

  it("keeps pure keyboard/activation modules and Enter/Escape activation", () => {
    expect(launcher).toMatch(/moveLauncherIndex\(/);
    expect(launcher).toMatch(/searchLauncherEntries\(/);
    expect(launcher).toMatch(/case "Escape"/);
    expect(launcher).toMatch(/case "Enter"/);
    expect(launcher).toMatch(/LAUNCHER_MAX_RESULTS/);
  });

  it("scrolls the selected row into view with nearest semantics", () => {
    expect(launcher).toMatch(/scrollIntoView\(\{ block: "nearest" \}\)/);
  });

  it("never runs React state on scroll events", () => {
    expect(launcher).not.toMatch(/onScroll/);
  });
});
