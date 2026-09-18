import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { fileURLToPath } from "node:url";

/**
 * Static regression for the transform-ownership contract (task 014-C): the
 * `.vela-item` rule must NOT declare a transform easing. A global item
 * transition animates (a) the drag source's dnd-kit transform teardown at
 * drop — the icon glides back to its old cell — and (b) the transient peer
 * preview transforms, which trail the drag source by the easing duration.
 * View-mode app hover re-scopes its own easing explicitly.
 */
const css = readFileSync(
  fileURLToPath(new URL("./home-shell.css", import.meta.url)),
  "utf8"
);

function ruleBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "m"));
  if (match === null) {
    throw new Error(`CSS rule not found: ${selector}`);
  }
  return match[1]!;
}

describe("home-shell.css transform ownership", () => {
  it("gives .vela-item no transform transition", () => {
    const body = ruleBlock(".vela-item");
    const transition = body.match(/transition:\s*([^;]+);/);
    expect(transition).not.toBeNull();
    expect(transition![1]!.trim()).toBe("none");
    expect(body).not.toMatch(/transition:\s*transform/);
  });

  it("scopes a transform easing to view-mode app hover only", () => {
    const body = ruleBlock('.vela-desktop[data-arrange="false"] .vela-item[data-kind="app"]');
    expect(body).toMatch(/transition:\s*transform\s+1[4-8]0ms\s+ease/);
  });

  it("scopes the hover lift to view mode and excludes dragging items", () => {
    const hover = ruleBlock(
      '.vela-desktop[data-arrange="false"] .vela-item[data-kind="app"]:hover:not([data-dragging="true"])'
    );
    expect(hover).toMatch(/transform:\s*translateY\(-2px\)/);
    // Arrange mode must never apply a hover transform: the pointer rests on
    // the just-dropped item and would lift it 2px off its snapped cell.
    const unscoped = css.match(/^[^@\n]*\.vela-item\[data-kind="app"\]:hover[^{]*\{/m);
    if (unscoped !== null) {
      expect(unscoped[0]).toContain('[data-arrange="false"]');
    }
  });

  it("keeps arrange-mode item transforms at none", () => {
    // No hover rule may declare a transform outside the view-mode scope.
    // Matching from line start keeps the full compound selector visible.
    const hoverRules = css.match(/^.*\.vela-item.*:hover.*\{[^}]*\}/gm) ?? [];
    expect(hoverRules.length).toBeGreaterThan(0);
    for (const rule of hoverRules) {
      if (/transform:/.test(rule)) {
        expect(rule).toContain('[data-arrange="false"]');
      }
    }
  });
});

describe("home-shell.css grid geometry contract", () => {
  it("defines the grid gap and padding as single-source custom properties on the viewport", () => {
    const viewport = ruleBlock(".vela-desktop__viewport");
    expect(viewport).toMatch(/--vd-grid-column-gap:\s*16px/);
    expect(viewport).toMatch(/--vd-grid-row-gap:\s*16px/);
    expect(viewport).toMatch(/--vd-grid-padding-x:\s*34px/);
    expect(viewport).toMatch(/--vd-grid-padding-y:\s*30px/);
    expect(viewport).toMatch(/gap:\s*var\(--vd-grid-row-gap\)\s+var\(--vd-grid-column-gap\)/);
    expect(viewport).toMatch(/padding:\s*var\(--vd-grid-padding-y\)\s+var\(--vd-grid-padding-x\)/);
    expect(viewport).not.toMatch(/(?:^|[\s;])gap:\s*16px/);
    expect(viewport).not.toMatch(/(?:^|[\s;])padding:\s*30px\s+34px/);
  });

  it("no longer fakes cell guides with a repeating background pitch", () => {
    expect(css).not.toMatch(/background-size:\s*var\(--vd-pitch/);
    expect(css).not.toMatch(/--vd-pitch-x/);
    expect(css).not.toMatch(/--vd-pitch-y/);
  });

  it("renders guide cells through an overlay sharing the viewport grid contract", () => {
    const guides = ruleBlock(".vela-desktop__grid-guides");
    expect(guides).toMatch(/position:\s*absolute/);
    expect(guides).toMatch(/inset:\s*0/);
    expect(guides).toMatch(/pointer-events:\s*none/);
    expect(guides).toMatch(/gap:\s*var\(--vd-grid-row-gap\)\s+var\(--vd-grid-column-gap\)/);
    expect(guides).toMatch(/padding:\s*var\(--vd-grid-padding-y\)\s+var\(--vd-grid-padding-x\)/);
    expect(guides).toMatch(
      /grid-template-columns:\s*repeat\(var\(--vd-grid-columns\),\s*minmax\(0,\s*1fr\)\)/
    );
    expect(guides).toMatch(
      /grid-template-rows:\s*repeat\(var\(--vd-grid-rows\),\s*minmax\(0,\s*1fr\)\)/
    );
  });
});

describe("home-shell.css snap lattice contract (014-E)", () => {
  /**
   * The arrange-mode grid is a LOGICAL SNAP LATTICE, never a visible tile
   * board: guide elements keep their DOM geometry (one per logical cell,
   * rect = CSS grid rect) but must carry zero box chrome — no border, no
   * fill. The only visual is a tiny dot at the slot's icon anchor.
   */
  it("draws guide cells with no border and no background fill", () => {
    const guide = ruleBlock(".vela-desktop__grid-guide");
    expect(guide).toMatch(/border:\s*none/);
    expect(guide).toMatch(/background:\s*none/);
    // Exactly one guide-cell rule may exist — no second rule can sneak a
    // tile look back in through another context.
    const guideRules = css.match(/^\.vela-desktop__grid-guide\s*\{/gm) ?? [];
    expect(guideRules.length).toBe(1);
  });

  it("marks the snap anchor with a tiny round dot, never a box or ring", () => {
    const marker = ruleBlock(".vela-desktop__grid-guide::after");
    for (const axis of ["width", "height"]) {
      const size = marker.match(new RegExp(`${axis}:\\s*([\\d.]+)px`));
      expect(size, `${axis} in px`).not.toBeNull();
      expect(parseFloat(size![1]!)).toBeLessThanOrEqual(8);
    }
    expect(marker).toMatch(/border-radius:\s*999px/);
    expect(marker).toMatch(/background:\s*var\(--vd-grid-dot\)/);
    // A border on the marker would read as a tiny tile/ring — forbidden.
    expect(marker).not.toMatch(/(?:^|[\s;])border:/);
  });

  it("anchors the dot at the slot's icon origin shared with .vela-item", () => {
    const marker = ruleBlock(".vela-desktop__grid-guide::after");
    // The icon's top-center is the one anchor that never moves: the item
    // column is flex-start, so tight rows may flex-shrink the icon box
    // vertically but its top edge stays at --vd-item-pad-top forever.
    expect(marker).toMatch(/top:\s*var\(--vd-item-pad-top\)/);
    expect(marker).toMatch(/left:\s*50%/);
    // Single source: the item's own top padding feeds the anchor calc, so
    // label length, icon size or locale can never shift the slot anchor.
    const item = ruleBlock(".vela-item");
    expect(item).toMatch(/padding:\s*var\(--vd-item-pad-top\)\s+4px/);
    // Horizontal anchor: items center their icon column.
    expect(item).toMatch(/align-items:\s*center/);
  });

  it("pins the slot anchor contract on items explicitly", () => {
    const item = ruleBlock(".vela-item");
    expect(item).toMatch(/align-self:\s*stretch/);
    expect(item).toMatch(/justify-self:\s*stretch/);
  });

  it("fades the guide layer in quickly, by opacity only", () => {
    const guides = ruleBlock(".vela-desktop__grid-guides");
    const animation = guides.match(/animation:\s*vela-guides-in\s+(\d+)ms/);
    expect(animation).not.toBeNull();
    const duration = parseInt(animation![1]!, 10);
    expect(duration).toBeGreaterThanOrEqual(120);
    expect(duration).toBeLessThanOrEqual(160);
    const keyframes = css.match(/@keyframes vela-guides-in\s*\{([\s\S]*?)\n\}/);
    expect(keyframes).not.toBeNull();
    // Markers may appear, never move: the fade must not touch transform.
    expect(keyframes![1]!).not.toMatch(/transform/);
    expect(keyframes![1]!).toMatch(/opacity:\s*0/);
  });

  it("disables the guide fade under reduced motion", () => {
    const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
    const end = css.indexOf("@media", start + 1);
    const reduced = css.slice(start, end === -1 ? undefined : end);
    expect(reduced).toContain(".vela-desktop__grid-guides");
    expect(reduced).toMatch(/animation:\s*none/);
  });

  it("sizes the icon box through the single --vd-slot-icon-size variable", () => {
    const icon = ruleBlock(".vela-item__icon");
    expect(icon).toMatch(/width:\s*var\(--vd-slot-icon-size\)/);
    expect(icon).toMatch(/height:\s*var\(--vd-slot-icon-size\)/);
    // The responsive shrink redefines the shared variable instead of
    // duplicating icon calcs, so the anchor dot tracks the icon everywhere.
    const responsive = css.match(
      /@media \(max-width: 1023px\)\s*\{[\s\S]*?\n\}/
    );
    expect(responsive).not.toBeNull();
    expect(responsive![0]!).toMatch(/--vd-slot-icon-size:\s*calc\(var\(--vd-icon-size\)\s*\*\s*0\.84\)/);
  });
});
