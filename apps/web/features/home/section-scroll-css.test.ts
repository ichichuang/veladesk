import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static regression for the task 015 scroll architecture: the section
 * stack is a REAL native scroll container (CSS Scroll Snap, no JS wheel
 * physics), every section is exactly one snap viewport with
 * snap-stop always, and section content never scrolls vertically.
 */

const css = readFileSync(
  fileURLToPath(new URL("./home-shell.css", import.meta.url)),
  "utf8"
);

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

describe("home-shell.css section scroll-snap contract (task 015)", () => {
  it("makes the section stack the one real scroll container with mandatory y snapping", () => {
    const stack = ruleBlock(".vela-section-stack");
    expect(stack).toMatch(/position:\s*absolute/);
    expect(stack).toMatch(/inset:\s*0/);
    expect(stack).toMatch(/overflow-y:\s*auto/);
    expect(stack).toMatch(/overflow-x:\s*hidden/);
    expect(stack).toMatch(/scroll-snap-type:\s*y\s+mandatory/);
    expect(stack).toMatch(/overscroll-behavior-y:\s*contain/);
    // Scrollbar visually hidden, scrollability untouched.
    expect(stack).toMatch(/scrollbar-width:\s*none/);
  });

  it("hides the WebKit scrollbar too", () => {
    const block = ruleBlock(".vela-section-stack::-webkit-scrollbar");
    expect(block).toMatch(/display:\s*none/);
  });

  it("freezes the stack via data-scroll-locked without changing scroll position", () => {
    const locked = ruleBlock('.vela-section-stack[data-scroll-locked="true"]');
    expect(locked).toMatch(/overflow-y:\s*hidden/);
  });

  it("sizes every section to exactly one snap viewport with snap-stop always", () => {
    const section = ruleBlock(".vela-section");
    expect(section).toMatch(/position:\s*relative/);
    expect(section).toMatch(/block-size:\s*100%/);
    expect(section).toMatch(/min-block-size:\s*100%/);
    expect(section).toMatch(/scroll-snap-align:\s*start/);
    expect(section).toMatch(/scroll-snap-stop:\s*always/);
    // Section content NEVER scrolls vertically (hard product constraint).
    expect(section).toMatch(/overflow:\s*hidden/);
  });

  it("keeps the section grid canvas non-scrolling (overflow hidden)", () => {
    const viewport = ruleBlock(".vela-desktop__viewport");
    expect(viewport).toMatch(/overflow:\s*hidden/);
    expect(viewport).not.toMatch(/overflow-y:\s*auto/);
  });

  it("removes the top bar, page dots and topbar offset from the stylesheet", () => {
    expect(css).not.toMatch(/\.vela-topbar/);
    expect(css).not.toMatch(/\.vela-pages/);
    expect(css).not.toMatch(/--vd-topbar-height/);
    expect(css).not.toMatch(/\.vela-locale-switch/);
    expect(css).not.toMatch(/\.vela-segment/);
  });
});

describe("no JS wheel physics anywhere on the native scroll path", () => {
  it("mounts no onWheel handler in the desktop shell or the section stack path", () => {
    for (const file of [
      "./desktop-shell.tsx",
      "./desktop-grid.tsx",
      "./section-navigation.tsx",
      "./dock.tsx",
      "./use-section-navigation.ts",
    ]) {
      expect(readSource(file), file).not.toMatch(/onWheel/);
    }
  });

  it("never registers a wheel event listener or preventDefault pager", () => {
    for (const file of [
      "./desktop-shell.tsx",
      "./use-section-navigation.ts",
    ]) {
      const source = readSource(file);
      expect(source, file).not.toMatch(/addEventListener\(\s*["']wheel["']/);
      expect(source, file).not.toMatch(/deltaY/);
      expect(source, file).not.toMatch(/lockedUntil/);
    }
  });

  it("marks every local scroll surface with data-vd-wheel-scope local", () => {
    for (const [file, marker] of [
      ["./context-menu.tsx", "vela-context-menu"],
      ["./section-navigation.tsx", "vela-section-nav__list"],
      ["./folder-overlay.tsx", "vela-folder-overlay__grid"],
      ["./launcher.tsx", "vela-launcher__results"],
      ["./settings-center.tsx", "vela-settings__content"],
      ["./move-to-section-dialog.tsx", "vela-move-section__list"],
    ] as const) {
      expect(readSource(file), file).toMatch(/data-vd-wheel-scope="local"/);
      void marker;
    }
  });
});
