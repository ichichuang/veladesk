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

  it("keeps the hover lift excluded from dragging items", () => {
    const hover = ruleBlock('.vela-item[data-kind="app"]:hover:not([data-dragging="true"])');
    expect(hover).toMatch(/transform:\s*translateY\(-2px\)/);
  });
});
