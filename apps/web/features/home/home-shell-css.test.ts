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

  it("styles guide cells with a restrained 1px line, never a fill", () => {
    const guide = ruleBlock(".vela-desktop__grid-guide");
    expect(guide).toMatch(/border:\s*1px\s+solid\s+var\(--vd-grid-line\)/);
    expect(guide).not.toMatch(/background(?!-)/);
    expect(guide).toMatch(/border-radius:\s*\d+px/);
  });
});
