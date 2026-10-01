import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { fileURLToPath } from "node:url";

/**
 * Static contracts of the geometry-driven desktop tile (017-B, 019-B): the
 * CSS Grid area is the ONE rendered rectangle. The app surface fills it,
 * icon + title compose adaptively from resolver vars, and the legacy fixed
 * --vd-slot-icon-size never sizes a desktop tile (it stays valid for the
 * dock and the folder overlay).
 */
const css = readFileSync(fileURLToPath(new URL("./home-shell.css", import.meta.url)), "utf8");

function ruleBlock(selector: string): string {
  // Selector groups are written one selector per line in the stylesheet, so
  // each comma-separated part is matched with flexible whitespace.
  const escape = (part: string) => part.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = selector.split(",").map(escape).join("\\s*,\\s*");
  const match = css.match(new RegExp(`${pattern}\\s*\\{([\\s\\S]*?)\\}`, "m"));
  if (match === null) {
    throw new Error(`CSS rule not found: ${selector}`);
  }
  return match[1]!;
}

describe("grid tile fills its CSS Grid area (017-B / 019-B)", () => {
  it("gives .vela-grid-host apps the same geometry-driven surface as freeform", () => {
    const rule = ruleBlock(
      ".vela-canvas .vela-app-icon--surface, .vela-grid-host .vela-app-icon--surface",
    );
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/inset:\s*0/);
    expect(rule).toMatch(/width:\s*auto/);
    expect(rule).toMatch(/height:\s*auto/);
    // One fill contract for BOTH desktop hosts + the preview — no per-host
    // glyph formula, no per-app multiplier.
    expect(rule).not.toMatch(/--vd-app-icon-scale/);
    expect(rule).not.toMatch(/--vd-slot-icon-size/);
  });

  it("sizes grid glyphs from the adaptive icon box, shared with freeform and preview", () => {
    const rule = ruleBlock(
      ".vela-app-content__icon .vela-app-icon__glyph, .vela-app-content__icon .vela-app-icon__image",
    );
    expect(rule).toMatch(/width:\s*100%/);
    expect(rule).toMatch(/height:\s*100%/);
    // The bound is the fixed resolver box — no cqmin formula anywhere.
    expect(css).not.toMatch(/62cqmin/);
  });

  it("keeps uploaded images contained inside grid tiles", () => {
    const rule = ruleBlock(
      ".vela-app-content__icon .vela-app-icon__glyph, .vela-app-content__icon .vela-app-icon__image",
    );
    expect(rule).toMatch(/object-fit:\s*contain/);
  });

  it("gives grid folders the same fill semantics as apps", () => {
    const folder = ruleBlock(
      ".vela-canvas .vela-item__icon--folder, .vela-grid-host .vela-item__icon--folder",
    );
    expect(folder).toMatch(/position:\s*absolute/);
    expect(folder).toMatch(/width:\s*auto/);
    expect(folder).toMatch(/height:\s*auto/);
    // The folder tile is its own query container, so the svg's cqmin
    // resolves against the tile box instead of falling back to the
    // viewport.
    expect(folder).toMatch(/container-type:\s*size/);
    const svg = ruleBlock(
      ".vela-canvas .vela-item__icon--folder svg, .vela-grid-host .vela-item__icon--folder svg",
    );
    expect(svg).toMatch(/cqmin/);
  });

  it("never sizes a desktop tile from --vd-slot-icon-size", () => {
    // The fixed-slot sizing must remain ONLY on the base .vela-app-icon
    // (dock, folder overlay) — desktop tiles fill their geometry and
    // compose adaptively instead.
    const base = ruleBlock(".vela-app-icon");
    expect(base).toMatch(/--vd-slot-icon-size/);
    const desktop = ruleBlock(
      ".vela-canvas .vela-app-icon--surface, .vela-grid-host .vela-app-icon--surface",
    );
    expect(desktop).not.toMatch(/--vd-slot-icon-size/);
  });

  it("target-slot feedback is pointer-transparent and hard-snapped", () => {
    const layer = ruleBlock(".vela-grid-target-layer");
    expect(layer).toMatch(/position:\s*absolute/);
    expect(layer).toMatch(/pointer-events:\s*none/);
    const target = ruleBlock(".vela-grid-target");
    // Grid feels discrete: the feedback jumps cell-by-cell — any transition
    // must be an explicit `none`, never an easing.
    expect(target).toMatch(/transition:\s*none/);
  });
});
