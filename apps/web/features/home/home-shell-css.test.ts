import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { fileURLToPath } from "node:url";

/**
 * Static regression for the transform-ownership contract (task 014-C): the
 * `.vela-item` rule must NOT declare a transform easing. A global item
 * transition animates (a) the drag source's dnd-kit transform teardown at
 * drop and (b) the transient preview transforms, which would trail the drag
 * source by the easing duration. The visual body re-scopes its own easing to
 * view-mode hover explicitly (016-C).
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
    const body = ruleBlock(
      '.vela-desktop[data-arrange="false"] .vela-item[data-kind="app"] .vela-item__body'
    );
    expect(body).toMatch(/transition:\s*transform\s+1[4-8]0ms\s+ease/);
    // Arrange mode must stay un-eased: no easing rule may target the body
    // without the view-mode scope.
    const easingRules = css.match(/^[^@\n]*\.vela-item__body\s*\{[^}]*transition[^}]*\}/gm) ?? [];
    expect(easingRules.length).toBeGreaterThan(0);
    for (const rule of easingRules) {
      expect(rule).toContain('[data-arrange="false"]');
    }
  });

  it("scopes the hover lift to view mode and excludes dragging items", () => {
    const hover = ruleBlock(
      '.vela-desktop[data-arrange="false"] .vela-item[data-kind="app"]:hover:not([data-dragging="true"]) .vela-item__body'
    );
    expect(hover).toMatch(/transform:\s*translateY\(-2px\)/);
    // Arrange mode must never apply a hover transform: the pointer rests on
    // the just-released item and would lift it 2px off its snapped rect.
    const unscoped = css.match(/^[^@\n]*\.vela-item[^{]*:hover[^{]*\{/m);
    if (unscoped !== null) {
      expect(unscoped[0]).toContain('[data-arrange="false"]');
    }
  });

  it("keeps the drag preview as a transform of the item body only", () => {
    // A drag preview (or snap correction) must never be written onto the item
    // box itself: that is what dnd-kit transforms, and the two would fight.
    const item = ruleBlock(".vela-item");
    expect(item).not.toMatch(/transform:/);
    const body = ruleBlock(".vela-item__body");
    expect(body).toMatch(/transform:\s*var\(--vd-canvas-drag-preview,\s*none\)/);
  });
});

describe("home-shell.css canvas geometry contract (016-C)", () => {
  it("keeps the usable content box as single-source custom properties on the viewport", () => {
    const viewport = ruleBlock(".vela-desktop__viewport");
    // The left padding reserves the section-nav rail, so the four edges stay
    // independent variables (task 015) — and nothing else defines them.
    expect(viewport).toMatch(/--vd-grid-padding-left:\s*186px/);
    expect(viewport).toMatch(/--vd-grid-padding-right:\s*34px/);
    expect(viewport).toMatch(/--vd-grid-padding-top:\s*30px/);
    expect(viewport).toMatch(/--vd-grid-padding-bottom:\s*30px/);
    expect(viewport).toMatch(/position:\s*absolute/);
    expect(viewport).toMatch(/overflow:\s*hidden/);
  });

  it("places .vela-canvas on exactly that content box", () => {
    const canvas = ruleBlock(".vela-canvas");
    expect(canvas).toMatch(/position:\s*absolute/);
    expect(canvas).toMatch(
      /inset:\s*var\(--vd-grid-padding-top\)\s+var\(--vd-grid-padding-right\)\s+var\(--vd-grid-padding-bottom\)\s+var\(--vd-grid-padding-left\)/
    );
  });

  it("reserves extra bottom space only when a dock actually exists", () => {
    const docked = ruleBlock('.vela-desktop[data-has-dock="true"] .vela-desktop__viewport');
    expect(docked).toMatch(/--vd-grid-padding-bottom:\s*108px/);
  });

  it("never places production items with CSS grid again", () => {
    // Placement is percent geometry inside .vela-canvas: a leftover grid
    // template, track or gap would silently resurrect the old model.
    expect(css).not.toMatch(/grid-template-columns:\s*repeat\(var\(--vd-grid-columns\)/);
    expect(css).not.toMatch(/grid-template-rows:\s*repeat\(var\(--vd-grid-rows\)/);
    expect(css).not.toMatch(/--vd-grid-column-gap/);
    expect(css).not.toMatch(/--vd-grid-row-gap/);
    expect(ruleBlock(".vela-desktop__viewport")).not.toMatch(/display:\s*grid/);
  });

  it("sizes every item from its rect and keeps the body as the visual layer", () => {
    const item = ruleBlock(".vela-item");
    expect(item).toMatch(/position:\s*absolute/);
    expect(item).toMatch(/padding:\s*0/);

    const body = ruleBlock(".vela-item__body");
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/inset:\s*0/);

    const wrap = ruleBlock(".vela-item__icon-wrap");
    expect(wrap).toMatch(/position:\s*absolute/);
    expect(wrap).toMatch(/inset:\s*0/);
  });

  it("anchors the label to the tile bottom without touching the rect", () => {
    const label = ruleBlock(".vela-item__label");
    expect(label).toMatch(/position:\s*absolute/);
    expect(label).toMatch(/bottom:/);
    expect(label).toMatch(/text-overflow:\s*ellipsis/);
  });

  it("fills the tile with the decoration and scales the glyph off the smaller side", () => {
    const tile = ruleBlock(".vela-canvas .vela-app-icon");
    expect(tile).toMatch(/position:\s*absolute/);
    expect(tile).toMatch(/inset:\s*0/);
    // An element is never its own query container, so the WRAP declares the
    // container and the tile's cqmin resolves against the rect's smaller side
    // (which is what keeps a landscape tile's glyph centered and unstretched).
    expect(tile).not.toMatch(/container-type/);
    expect(ruleBlock(".vela-item__icon-wrap")).toMatch(/container-type:\s*size/);
    expect(tile).toMatch(/cqmin/);

    const glyph = ruleBlock(".vela-canvas .vela-app-icon__glyph");
    expect(glyph).toMatch(/62cqmin/);
    // Legacy iconScale stays a glyph multiplier, never tile geometry.
    expect(glyph).toMatch(/var\(--vd-app-icon-scale,\s*1\)/);
  });

  it("contains an uploaded image inside the rect without cropping it", () => {
    const image = ruleBlock(".vela-canvas .vela-app-icon__image");
    expect(image).toMatch(/width:\s*100%/);
    expect(image).toMatch(/height:\s*100%/);
    expect(image).toMatch(/object-fit:\s*contain/);
  });
});

describe("home-shell.css resize handles (016-C)", () => {
  it("offers all eight handles with the matching cursors", () => {
    const expected: Readonly<Record<string, string>> = {
      nw: "nwse-resize",
      n: "ns-resize",
      ne: "nesw-resize",
      e: "ew-resize",
      se: "nwse-resize",
      s: "ns-resize",
      sw: "nesw-resize",
      w: "ew-resize",
    };

    for (const [handle, cursor] of Object.entries(expected)) {
      const rule = ruleBlock(`.vela-item__resize-handle[data-handle="${handle}"]`);
      expect(rule, handle).toMatch(new RegExp(`cursor:\\s*${cursor}`));
    }
  });

  it("makes the layer pointer-transparent so only handles take pointers", () => {
    const layer = ruleBlock(".vela-item__resize-layer");
    expect(layer).toMatch(/position:\s*absolute/);
    expect(layer).toMatch(/inset:\s*0/);
    expect(layer).toMatch(/pointer-events:\s*none/);

    const handle = ruleBlock(".vela-item__resize-handle");
    expect(handle).toMatch(/pointer-events:\s*auto/);
    expect(handle).toMatch(/touch-action:\s*none/);
  });

  it("keeps a small visual dot inside a comfortable hit area", () => {
    const handle = ruleBlock(".vela-item__resize-handle");
    const size = handle.match(/width:\s*([\d.]+)px/);
    expect(size).not.toBeNull();
    expect(parseFloat(size![1]!)).toBeGreaterThanOrEqual(16);

    const dot = ruleBlock(".vela-item__resize-handle::after");
    const inset = dot.match(/inset:\s*([\d.]+)px/);
    expect(inset).not.toBeNull();
    // An 18px hit box with a 5px inset paints an 8px dot.
    const visual = parseFloat(size![1]!) - 2 * parseFloat(inset![1]!);
    expect(visual).toBeGreaterThanOrEqual(6);
    expect(visual).toBeLessThanOrEqual(10);
  });
});

describe("home-shell.css snap lattice contract", () => {
  /**
   * The arrange-mode lattice is an ALIGNMENT HINT drawn at real cell
   * centers: markers keep zero box chrome — no border, no fill — and the
   * only visual is a tiny dot. A freeform section renders no markers at all
   * (the renderer decides; this file only guarantees what a marker looks
   * like).
   */
  it("draws markers with no border and no background fill", () => {
    const guide = ruleBlock(".vela-desktop__grid-guide");
    expect(guide).toMatch(/border:\s*none/);
    expect(guide).toMatch(/background:\s*none/);
    // Exactly one guide rule may exist — no second rule can sneak a tile look
    // back in through another context.
    const guideRules = css.match(/^\.vela-desktop__grid-guide\s*\{/gm) ?? [];
    expect(guideRules.length).toBe(1);
  });

  it("marks a cell center with a tiny round dot, never a box or ring", () => {
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

  it("fades the marker layer in quickly, by opacity only", () => {
    const lattice = ruleBlock(".vela-desktop__lattice");
    expect(lattice).toMatch(/position:\s*absolute/);
    expect(lattice).toMatch(/inset:\s*0/);
    expect(lattice).toMatch(/pointer-events:\s*none/);
    const animation = lattice.match(/animation:\s*vela-guides-in\s+(\d+)ms/);
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

  it("disables the marker fade under reduced motion", () => {
    const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
    const end = css.indexOf("@media", start + 1);
    const reduced = css.slice(start, end === -1 ? undefined : end);
    expect(reduced).toContain(".vela-desktop__lattice");
    expect(reduced).toMatch(/animation:\s*none/);
  });

  it("sizes the shared icon box through the single --vd-slot-icon-size variable", () => {
    const icon = ruleBlock(".vela-item__icon");
    expect(icon).toMatch(/width:\s*var\(--vd-slot-icon-size\)/);
    expect(icon).toMatch(/height:\s*var\(--vd-slot-icon-size\)/);
    // The responsive shrink redefines the shared variable instead of
    // duplicating icon calcs, so the dock and the editor preview track it.
    const responsive = css.match(
      /@media \(max-width: 1023px\)\s*\{[\s\S]*?\n\}/
    );
    expect(responsive).not.toBeNull();
    expect(responsive![0]!).toMatch(/--vd-slot-icon-size:\s*calc\(var\(--vd-icon-size\)\s*\*\s*0\.84\)/);
  });
});
