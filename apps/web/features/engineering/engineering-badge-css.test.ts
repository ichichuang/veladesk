import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * F3 (walkthrough fix): the fixed engineering badge must yield while the
 * right-anchored appearance inspector owns the top-right corner — a
 * half-covered badge reads as a rendering defect, not stacking.
 */
const css = readFileSync(
  fileURLToPath(new URL("./engineering.css", import.meta.url)),
  "utf8"
);

describe("engineering badge vs inspector panel (F3)", () => {
  it("fades the badge out while the inspector panel is open", () => {
    expect(css).toMatch(
      /\.vela-desktop\[data-inspector-open="true"\] \.vela-engineering-badge\s*\{[\s\S]*?opacity: 0;[\s\S]*?pointer-events: none;/,
    );
  });

  it("the yield is animated, not a hard cut", () => {
    const badge = css.match(/\.vela-engineering-badge\s*\{([\s\S]*?)\}/);
    expect(badge).not.toBeNull();
    expect(badge![1]).toMatch(/transition:[\s\S]*opacity var\(--vd-motion-fast\) var\(--vd-motion-ease\)/);
  });
});
