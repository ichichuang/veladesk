import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { fileURLToPath } from "node:url";

/**
 * Static contracts of the task 017-B geometry-driven Grid tile: the CSS
 * Grid area is the ONE rendered rectangle. App and folder tiles fill it,
 * glyphs size from the box through cqmin, and the legacy fixed
 * --vd-slot-icon-size never sizes a desktop tile (it stays valid for the
 * dock, folder overlay and editor preview).
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

describe("grid tile fills its CSS Grid area (task 017-B)", () => {
  it("gives .vela-grid-host apps the same geometry-driven tile as freeform", () => {
    const rule = ruleBlock(".vela-canvas .vela-app-icon, .vela-grid-host .vela-app-icon");
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/inset:\s*0/);
    expect(rule).toMatch(/width:\s*auto/);
    expect(rule).toMatch(/height:\s*auto/);
    // Text glyphs size from the box (cqmin), never the 62px slot.
    expect(rule).toMatch(/font-size:[^;]*cqmin/);
  });

  it("sizes grid glyphs from the item box through cqmin", () => {
    const rule = ruleBlock(
      ".vela-canvas .vela-app-icon__glyph, .vela-grid-host .vela-app-icon__glyph",
    );
    expect(rule).toMatch(/min\(calc\(62cqmin/);
  });

  it("keeps uploaded images contained inside grid tiles", () => {
    const rule = ruleBlock(
      ".vela-canvas .vela-app-icon__image, .vela-grid-host .vela-app-icon__image",
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
    // The folder tile is its own query container (folders have no
    // .vela-item__icon-wrap), so the svg's cqmin resolves against the tile
    // box instead of falling back to the viewport.
    expect(folder).toMatch(/container-type:\s*size/);
    const svg = ruleBlock(
      ".vela-canvas .vela-item__icon--folder svg, .vela-grid-host .vela-item__icon--folder svg",
    );
    expect(svg).toMatch(/cqmin/);
  });

  it("never sizes a desktop tile from --vd-slot-icon-size", () => {
    // The fixed-slot sizing must remain ONLY on the base .vela-app-icon
    // (dock, folder overlay, editor preview) — both desktop geometry hosts
    // override it with fill semantics, so iconScale can only touch glyphs.
    const base = ruleBlock(".vela-app-icon");
    expect(base).toMatch(/--vd-slot-icon-size/);
    const desktop = ruleBlock(".vela-canvas .vela-app-icon, .vela-grid-host .vela-app-icon");
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
