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

describe("home-shell.css transform ownership", () => {
  it("gives .vela-item no transform transition", () => {
    // Anchor at line start: the grid-scoped item rule must not shadow this.
    const base = css.match(/^\.vela-item\s*\{([\s\S]*?)\}/m);
    expect(base).not.toBeNull();
    const transition = base![1]!.match(/transition:\s*([^;]+);/);
    expect(transition).not.toBeNull();
    expect(transition![1]!.trim()).toBe("none");
    expect(base![1]!).not.toMatch(/transition:\s*transform/);
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
    // A drag preview (or cell correction) must never be written onto the
    // item box itself: that is what dnd-kit transforms, and the two would
    // fight. Anchored so the grid-scoped rule cannot shadow the base rule.
    const base = css.match(/^\.vela-item\s*\{([\s\S]*?)\}/m);
    expect(base).not.toBeNull();
    expect(base![1]!).not.toMatch(/transform:/);
    const body = ruleBlock(".vela-item__body");
    expect(body).toMatch(/transform:\s*var\(--vd-canvas-drag-preview,\s*none\)/);
  });
});

describe("home-shell.css geometry contract (task 017)", () => {
  it("composes the desktop as rail + workspace columns, never viewport paddings", () => {
    const workbench = ruleBlock(".vela-workbench");
    expect(workbench).toMatch(/display:\s*flex/);

    const viewport = ruleBlock(".vela-section-viewport");
    expect(viewport).toMatch(/--vd-section-padding-top:\s*56px/);
    expect(viewport).toMatch(/--vd-section-padding-bottom:\s*30px/);
    // The artificial 186px left padding for the floating rail is gone: the
    // rail is a real flex column now.
    expect(css).not.toMatch(/--vd-grid-padding-left/);
  });

  it("places .vela-canvas on exactly the freeform stage box", () => {
    const canvas = ruleBlock(".vela-canvas");
    expect(canvas).toMatch(/position:\s*absolute/);
    expect(canvas).toMatch(/inset:\s*0/);
  });

  it("reserves extra bottom space only when a dock actually exists", () => {
    const docked = ruleBlock('.vela-desktop[data-has-dock="true"] .vela-section-viewport');
    expect(docked).toMatch(/--vd-section-padding-bottom:\s*108px/);
  });

  it("scopes percent-space absolute items to the freeform canvas only", () => {
    // Anchor at line start so the grid-scoped rule cannot shadow the base.
    const base = css.match(/^\.vela-item\s*\{([\s\S]*?)\}/m);
    expect(base).not.toBeNull();
    expect(base![1]!).toMatch(/position:\s*absolute/);
    // Grid items are grid-area children instead.
    const gridItem = ruleBlock(".vela-grid-host .vela-item");
    expect(gridItem).toMatch(/position:\s*relative/);
  });

  it("runs the grid host as a real CSS grid with auto rows and a gap", () => {
    const host = ruleBlock(".vela-grid-host");
    expect(host).toMatch(/display:\s*grid/);
    expect(host).toMatch(/grid-auto-rows:\s*var\(--vd-grid-cell-size\)/);
    expect(host).toMatch(/gap:\s*var\(--vd-grid-gap\)/);
  });

  it("sizes every item from its box and keeps the body as the visual layer", () => {
    const body = ruleBlock(".vela-item__body");
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/inset:\s*0/);

    const wrap = ruleBlock(".vela-item__icon-wrap");
    expect(wrap).toMatch(/position:\s*absolute/);
    expect(wrap).toMatch(/inset:\s*0/);
  });

  it("anchors the label to the tile bottom without touching the geometry", () => {
    const label = ruleBlock(".vela-item__label");
    expect(label).toMatch(/position:\s*absolute/);
    expect(label).toMatch(/bottom:/);
    expect(label).toMatch(/text-overflow:\s*ellipsis/);
    // 017-C: label size is presentation — baseline × per-app scale, clamped.
    expect(label).toMatch(/clamp\(9px,\s*calc\(12\.5px\s*\*\s*var\(--vd-app-label-scale,\s*1\)\),\s*24px\)/);
  });

  it("scales the desktop label off the item box through cqmin (017-C)", () => {
    const desktop = ruleBlock(".vela-canvas .vela-item__label, .vela-grid-host .vela-item__label");
    expect(desktop).toMatch(/clamp\(9px,\s*calc\(14cqmin\s*\*\s*var\(--vd-app-label-scale,\s*1\)\),\s*24px\)/);
    // The body is the label's query container; the glyph keeps its own.
    expect(ruleBlock(".vela-item__body")).toMatch(/container-type:\s*size/);
    // No media override may pin the label font again — that would mute
    // labelScale and the responsive baseline on small screens.
    const media = css.match(/@media \(max-width: 1023px\)\s*\{[\s\S]*?\n\}/);
    expect(media).not.toBeNull();
    expect(media![0]!).not.toMatch(/\.vela-item__label[^{]*\{[^}]*font-size/);
  });

  it("fills the tile with the decoration and scales the glyph off the smaller side", () => {
    const tile = ruleBlock(".vela-canvas .vela-app-icon, .vela-grid-host .vela-app-icon");
    expect(tile).toMatch(/position:\s*absolute/);
    expect(tile).toMatch(/inset:\s*0/);
    expect(tile).not.toMatch(/container-type/);
    expect(ruleBlock(".vela-item__icon-wrap")).toMatch(/container-type:\s*size/);
    expect(tile).toMatch(/cqmin/);

    const glyph = ruleBlock(".vela-canvas .vela-app-icon__glyph, .vela-grid-host .vela-app-icon__glyph");
    expect(glyph).toMatch(/62cqmin/);
    expect(glyph).toMatch(/var\(--vd-app-icon-scale,\s*1\)/);
  });

  it("contains an uploaded image inside the box without cropping it", () => {
    const image = ruleBlock(".vela-canvas .vela-app-icon__image, .vela-grid-host .vela-app-icon__image");
    expect(image).toMatch(/object-fit:\s*contain/);
    // 017-C: the image IS the glyph — it follows the same responsive,
    // iconScale-aware box as the library glyphs instead of filling the tile.
    expect(image).toMatch(/62cqmin/);
    expect(image).toMatch(/var\(--vd-app-icon-scale,\s*1\)/);
    expect(image).toMatch(/margin:\s*auto/);
  });

  it("keeps the dock button fixed while every glyph source scales (017-C)", () => {
    const glyphs = ruleBlock(
      ".vela-dock__item .vela-app-icon__glyph, .vela-dock__item .vela-app-icon__image"
    );
    expect(glyphs).toMatch(/min\(calc\(24px\s*\*\s*var\(--vd-app-icon-scale,\s*1\)\),\s*40px\)/);
    // The button box itself stays presentation-free: no per-app var may
    // size the dock button.
    const dock = ruleBlock(".vela-dock__item, .vela-dock__utility");
    expect(dock).toMatch(/width:\s*44px/);
    expect(dock).toMatch(/height:\s*44px/);
    expect(dock).not.toMatch(/var\(--vd-app-icon-scale/);
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

describe("home-shell.css visible square grid (task 017)", () => {
  it("keeps the old center-dot marker model fully removed", () => {
    expect(css).not.toMatch(/\.vela-desktop__grid-guide/);
    expect(css).not.toMatch(/\.vela-desktop__lattice/);
    expect(css).not.toMatch(/--vd-grid-dot/);
  });

  it("sizes the shared icon box through the single --vd-slot-icon-size variable", () => {
    const icon = ruleBlock(".vela-item__icon");
    expect(icon).toMatch(/width:\s*var\(--vd-slot-icon-size\)/);
    expect(icon).toMatch(/height:\s*var\(--vd-slot-icon-size\)/);
    const responsive = css.match(/@media \(max-width: 1023px\)\s*\{[\s\S]*?\n\}/);
    expect(responsive).not.toBeNull();
    expect(responsive![0]!).toMatch(/--vd-slot-icon-size:\s*calc\(var\(--vd-icon-size\)\s\*\s*0\.84\)/);
  });
});
