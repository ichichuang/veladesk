import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { fileURLToPath } from "node:url";

/**
 * Static contracts of the task 017-A visible Grid: ISOLATED SQUARE SLOTS,
 * never graph paper. The overlay is one pointer-transparent SVG whose
 * repeating pattern tile is a full pitch (cell + gap) square containing
 * exactly ONE stroked square — the rest of the tile stays transparent, so
 * the persisted gridGapPx is real blank space between neighbouring slots.
 * Every number comes from the shared square-grid metrics; nothing is
 * recomputed here.
 */
const source = readFileSync(
  fileURLToPath(new URL("./grid-slot-overlay.tsx", import.meta.url)),
  "utf8",
);
const grid = readFileSync(fileURLToPath(new URL("./desktop-grid.tsx", import.meta.url)), "utf8");

describe("grid slot overlay — isolated squares (task 017-A)", () => {
  it("draws exactly one square per pattern tile sized a full pitch", () => {
    expect(source).toContain("<pattern");
    expect(source).toContain('patternUnits="userSpaceOnUse"');
    // Tile = pitch (cell + gap) on BOTH axes; the square inside is cell only.
    expect(source).toMatch(/width=\{pitchPx\}/);
    expect(source).toMatch(/height=\{pitchPx\}/);
    expect(source).toMatch(/width=\{cellPx\}/);
    expect(source).toMatch(/height=\{cellPx\}/);
  });

  it("keeps slots stroke-only: one rect, no fill, no rounding, no shadow", () => {
    const pattern = source.match(/<pattern[\s\S]*?<\/pattern>/)?.[0] ?? "";
    expect(pattern).not.toBe("");
    expect((pattern.match(/<rect/g) ?? []).length).toBe(1);
    expect(pattern).toContain('fill="none"');
    expect(pattern).toContain('stroke="var(--vd-grid-line)"');
    expect(pattern).toMatch(/strokeWidth="1"/);
    expect(pattern).not.toMatch(/rx=|ry=|border-radius|box-shadow|filter/);
  });

  it("derives every number from the measured metrics, never recomputes", () => {
    // The component consumes cellPx/gapPx props; the sole geometry source
    // stays calculateSquareGridMetrics in the shared metrics module.
    expect(source).not.toMatch(/calculateSquareGridMetrics\(/);
    expect(source).toMatch(/const pitchPx = cellPx \+ gapPx/);
  });

  it("uses a per-instance pattern id so concurrent overlays never collide", () => {
    // Entering/exiting sections can mount two overlays at once; a shared
    // literal id would make one snapshot paint the other's geometry.
    expect(source).toMatch(/useId\(\)/);
    expect(source).not.toMatch(/id="vela-grid-slots-pattern"/);
  });

  it("is pointer-transparent, decorative and outside the layout path", () => {
    expect(source).toContain('className="vela-grid-slots"');
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain('focusable="false"');
    // Layout-neutrality lives in CSS; the component itself must not size
    // or position itself away from the grid content origin. `width="100%"`
    // (cover the content width) is the one allowed dimension.
    expect(source).not.toMatch(/style=\{|getBoundingClientRect|width="\d+"/);
  });

  it("mounts only in Arrange with measured metrics, fed the exact values", () => {
    expect(grid).toMatch(/\{arrange && gridMetrics !== null \? \(\s*<GridSlotOverlay/);
    expect(grid).toContain("cellPx={gridMetrics.cellPx}");
    expect(grid).toContain("gapPx={gridMetrics.gapPx}");
    // The old continuous-line div is gone for good.
    expect(grid).not.toContain("vela-grid-lines");
  });
});
