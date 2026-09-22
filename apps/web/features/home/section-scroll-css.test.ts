import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static regression for the task 017 scroll-ownership architecture:
 * the right-side section scroller is the one real content scroll container
 * (stable gutter, contained overscroll, never hidden), wheel input over
 * the LEFT RAIL belongs to section navigation (a deliberate non-passive
 * JS listener with an accumulator), and the old outer section-stack
 * scroll-snap model is gone.
 */

const css = readFileSync(fileURLToPath(new URL("./home-shell.css", import.meta.url)), "utf8");

function readSource(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

function ruleBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "m"));
  if (match === null) {
    throw new Error(`CSS rule not found: ${selector}`);
  }
  return match[1]!;
}

describe("home-shell.css right-side scroll ownership (task 017)", () => {
  it("makes the section scroller the one real content scroll container", () => {
    const scroller = ruleBlock(".vela-section-scroller");
    expect(scroller).toMatch(/overflow-y:\s*auto/);
    expect(scroller).toMatch(/overflow-x:\s*hidden/);
    expect(scroller).toMatch(/overscroll-behavior-y:\s*contain/);
    // A stable gutter: appearing/disappearing scrollbars never change the
    // Grid width or cell size.
    expect(scroller).toMatch(/scrollbar-gutter:\s*stable/);
    // Firefox: thin. The main scrollbar is never fully hidden.
    expect(scroller).toMatch(/scrollbar-width:\s*thin/);
  });

  it("keeps the WebKit scrollbar narrow and low contrast, not hidden", () => {
    const thumb = ruleBlock(".vela-section-scroller::-webkit-scrollbar-thumb");
    expect(thumb).toMatch(/background:/);
    const bar = ruleBlock(".vela-section-scroller::-webkit-scrollbar");
    expect(bar).not.toMatch(/display:\s*none/);
  });

  it("freezes the scroller via data-scroll-locked without changing scroll position", () => {
    const locked = ruleBlock('.vela-section-scroller[data-scroll-locked="true"]');
    expect(locked).toMatch(/overflow-y:\s*hidden/);
  });

  it("sizes the grid stage to fill at least the visible content height", () => {
    const stage = ruleBlock(".vela-grid-stage");
    expect(stage).toMatch(/min-height:\s*100%/);
  });

  it("keeps the freeform stage at exactly one viewport height", () => {
    const freeform = ruleBlock(".vela-freeform-stage");
    expect(freeform).toMatch(/height:\s*100%/);
    expect(freeform).not.toMatch(/min-height/);
  });

  it("removes the old outer section-stack scroll-snap model", () => {
    expect(css).not.toMatch(/\.vela-section-stack/);
    expect(css).not.toMatch(/scroll-snap-type/);
    expect(css).not.toMatch(/scroll-snap-align/);
    expect(css).not.toMatch(/\.vela-desktop__viewport/);
    // The artificial canvas left padding for the floating rail is gone.
    expect(css).not.toMatch(/--vd-grid-padding-left/);
  });

  it("draws the visible grid as isolated square slots, never continuous lines", () => {
    const slots = ruleBlock(".vela-grid-slots");
    expect(slots).toMatch(/position:\s*absolute/);
    expect(slots).toMatch(/pointer-events:\s*none/);
    // SVG is a replaced element: inset:0 alone keeps the intrinsic
    // 300x150 default, so covering the stage needs explicit sizes.
    expect(slots).toMatch(/width:\s*100%/);
    expect(slots).toMatch(/height:\s*100%/);
    // The squares are SVG rects in a pattern tile; the overlay itself must
    // not paint any background image (the old graph-paper line pair).
    expect(slots).not.toMatch(/background-image/);
    // The continuous-line model is gone entirely — no legacy class, no
    // full-width/full-height 1px gradient lines anywhere.
    expect(css).not.toMatch(/\.vela-grid-lines/);
    expect(css).not.toMatch(/--vd-grid-line\) 1px, transparent 1px/);
    // No per-cell marker nodes anywhere.
    expect(css).not.toMatch(/\.vela-desktop__grid-guide/);
    expect(css).not.toMatch(/\.vela-desktop__lattice/);
  });

  it("fades the visible grid in by opacity only, removed under reduced motion", () => {
    const slots = ruleBlock(".vela-grid-slots");
    expect(slots).toMatch(/animation:\s*vela-guides-in\s+140ms/);
    const keyframes = css.match(/@keyframes vela-guides-in\s*\{([\s\S]*?)\n\}/);
    expect(keyframes).not.toBeNull();
    expect(keyframes![1]!).not.toMatch(/transform/);

    const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
    const end = css.indexOf("@media", start + 1);
    const reduced = css.slice(start, end === -1 ? undefined : end);
    expect(reduced).toContain(".vela-grid-slots");
    expect(reduced).toMatch(/animation:\s*none/);
  });

  it("plays the section transition as a whole-page vertical movement", () => {
    const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
    for (const phase of ["enter-next", "enter-prev", "exit-next", "exit-prev"]) {
      const pattern =
        escapeRe(`.vela-section-view[data-phase="${phase}"]`) +
        "\\s*\\{[\\s\\S]*?animation:\\s*vela-section-" +
        escapeRe(phase);
      expect(css, phase).toMatch(new RegExp(pattern));
    }
    const enterNext = css.match(/@keyframes vela-section-enter-next\s*\{([\s\S]*?)\n\}/);
    expect(enterNext).not.toBeNull();
    expect(enterNext![1]!).toMatch(/translateY\(28px\)/);

    const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
    const end = css.indexOf("@media", start + 1);
    const reduced = css.slice(start, end === -1 ? undefined : end);
    expect(reduced).toContain(".vela-section-view");
  });
});

describe("left rail wheel navigation (task 017)", () => {
  it("registers one deliberate non-passive wheel listener on the rail list", () => {
    const rail = readSource("./section-rail.tsx");
    expect(rail).toMatch(/addEventListener\(\s*["']wheel["'],\s*onWheel,\s*\{\s*passive:\s*false\s*\}/);
    expect(rail).toContain("event.preventDefault();");
    // The accumulator is the pure module — no inline delta math.
    expect(rail).toContain("advanceWheelNav(");
    expect(rail).toContain("unlockWheelNav");
  });

  it("never mounts onWheel React props on the content scroll path", () => {
    for (const file of [
      "./desktop-shell.tsx",
      "./desktop-grid.tsx",
      "./section-view.tsx",
      "./dock.tsx",
    ]) {
      expect(readSource(file), file).not.toMatch(/onWheel/);
    }
  });

  it("gives the rail titles-only items with aria-current", () => {
    const rail = readSource("./section-rail.tsx");
    expect(rail).toContain('aria-current={active ? "page" : undefined}');
    expect(rail).toContain("page.name");
    // No footer, no ⋯ button, no sync status inside the rail.
    expect(rail).not.toMatch(/vela-rail__more|vela-rail__footer|SectionSyncStatus/);
  });

  it("keeps the rail keyboard model: arrows, Home/End, context-menu keys", () => {
    const rail = readSource("./section-rail.tsx");
    expect(rail).toMatch(/case "ArrowUp"/);
    expect(rail).toMatch(/case "ArrowDown"/);
    expect(rail).toMatch(/case "Home"/);
    expect(rail).toMatch(/case "End"/);
    expect(rail).toContain("isContextMenuKeyEvent");
  });

  it("keeps the global desktop keyboard free of section arrows", () => {
    const shell = readSource("./desktop-shell.tsx");
    expect(shell).not.toMatch(/sectionNavDirection/);
    expect(shell).not.toMatch(/scrollToSection/);
    // The active section is explicit state, never scroll-derived.
    expect(shell).toContain("useState<DesktopPageId | null>(");
    expect(shell).not.toMatch(/IntersectionObserver/);
  });

  it("marks local overlay scroll scopes", () => {
    for (const file of [
      "./context-menu.tsx",
      "./section-view.tsx",
      "./folder-overlay.tsx",
      "./launcher.tsx",
      "./settings-center.tsx",
      "./move-to-section-dialog.tsx",
    ] as const) {
      expect(readSource(file), file).toMatch(/data-vd-wheel-scope=/);
    }
  });
});
