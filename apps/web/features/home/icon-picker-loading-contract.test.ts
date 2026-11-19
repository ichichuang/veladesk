import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * task 029 loading contract for the icon picker: auto-load-more through an
 * IntersectionObserver sentinel (never an onScroll React prop — the
 * 021-A scroll-surface contract), ONE shared fetch path that caches every
 * decoded page (offset pages included), rehydrate-on-revisit, idle-time
 * prefetch of the next page, and lazy multicolor previews.
 */
const source = readFileSync(fileURLToPath(new URL("./icon-picker.tsx", import.meta.url)), "utf8");

describe("icon picker loading contract (task 029)", () => {
  it("auto-loads through an IntersectionObserver sentinel, never onScroll", () => {
    expect(source).toMatch(/new IntersectionObserver/);
    expect(source).toMatch(/vela-icon-picker__sentinel/);
    expect(source).toMatch(/rootMargin: "240px 0px"/);
    expect(source).not.toMatch(/onScroll/);
  });

  it("degrades silently when the host has no IntersectionObserver", () => {
    expect(source).toMatch(/typeof IntersectionObserver === "undefined"/);
  });

  it("shares ONE fetch path; every decoded page (offsets included) is cached", () => {
    expect(source).toMatch(/const fetchIconPage = useCallback/);
    expect(source).toMatch(/writeCachedIconPage\(url, decoded\)/);
    // The old "offset pages are never cached" restriction is gone.
    expect(source).not.toMatch(/review P2-3/);
  });

  it("rehydrates the cached offset chain on revisit", () => {
    expect(source).toMatch(/rehydrateIconPickerPages/);
  });

  it("prefetches the next page in idle time", () => {
    expect(source).toMatch(/requestIdleCallback/);
  });

  it("lazy-loads multicolor preview images", () => {
    expect(source).toMatch(/loading="lazy"/);
  });

  it("hovers a LARGE tooltip preview per cell (F4b: wordmarks identifiable)", () => {
    expect(source).toMatch(/VdTooltipProvider skipDelayDuration=\{120\}/);
    expect(source).toMatch(/media=\{<IconPreview iconId=\{entry\.id\} \/>\}/);
    // The native title popup is gone — one hover surface, not two.
    expect(source).not.toMatch(/title=\{entry\.label\}/);
    const css = readFileSync(fileURLToPath(new URL("./home-shell.css", import.meta.url)), "utf8");
    expect(css).toMatch(/\[data-vd-tooltip-media\] \.vela-icon-picker__preview\s*\{[\s\S]*?width: 56px/);
  });

  it("persists the grid's scroll offset with the browse context (F5)", () => {
    // Observe: passive imperative listener writing a ref — never a React
    // scroll prop, never scroll-driven state.
    expect(source).toMatch(/addEventListener\("scroll", persistScroll, \{ passive: true \}\)/);
    expect(source).not.toMatch(/onScroll/);
    // Restore: one shot on mount against the rehydrated grid.
    expect(source).toMatch(/scrollHostRef\.current\.scrollTop = top/);
    // Flush: the final offset rides the LAST session write at unmount.
    expect(source).toMatch(/scrollTop: scrollTopRef\.current/);
    // A filter change resets the offset — the new context starts at the top.
    expect(source).toMatch(/scrollTopRef\.current = 0;/);
  });
});
