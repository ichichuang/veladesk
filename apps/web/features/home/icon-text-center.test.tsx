// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resolveAppContentLayout } from "./app-content-layout";
import { generatedIconText, iconInitial } from "./generated-icon";
import { IconText } from "./icon-text";

/*
 * fix/icon-text-center — regression contracts for the "search result icon
 * text is not centered" bug and its same-class siblings:
 *
 * 1. The shared `.vela-app-icon` tile owns centering (grid +
 *    place-items:center). Before, only `.vela-item__icon` / the dock button
 *    centered, so the launcher results and the mobile search results drew
 *    their initials as a block at the tile's top-left corner.
 * 2. Icon text is ONE character (the first grapheme of the custom text or
 *    the name — the full name is always shown next to the tile), so 3–4
 *    character texts ("飞书文档", "NOTN") can no longer wrap or spill.
 * 3. Surfaces that render outside the shell roots (mobile sheets portal
 *    next to .vela-mobile-shell; the inspector Dialog portals outside
 *    .vela-desktop) and the mobile search row declare their own
 *    --vd-slot-icon-size; without it the tile collapsed onto its text.
 */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const homeCss = read("./home-shell.css");
const mobileCss = read("./mobile/mobile-shell.css");

function ruleBlock(css: string, selector: string): string {
  const escape = (part: string) => part.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = selector.split(",").map(escape).join("\\s*,\\s*");
  const match = css.match(new RegExp(`(?:^|\\})\\s*${pattern}\\s*\\{([\\s\\S]*?)\\}`, "m"));
  if (match === null) {
    throw new Error(`CSS rule not found: ${selector}`);
  }
  return match[1]!;
}

afterEach(cleanup);

describe("icon tile centers its glyph on every surface", () => {
  it(".vela-app-icon is a centering grid", () => {
    const rule = ruleBlock(homeCss, ".vela-app-icon");
    expect(rule).toMatch(/display:\s*grid/);
    expect(rule).toMatch(/place-items:\s*center/);
  });

  it("the other tile hosts keep their own centering", () => {
    for (const selector of [".vela-item__icon", ".vela-inspector__row-thumb", ".vela-add-recognition__thumb"]) {
      const rule = ruleBlock(homeCss, selector);
      expect(rule, selector).toMatch(/display:\s*grid/);
      expect(rule, selector).toMatch(/place-items:\s*center/);
    }
  });

  it("icon text is a single untracked line box at the single-character scale", () => {
    const rule = ruleBlock(homeCss, ".vela-app-icon__text");
    expect(rule).toMatch(/white-space:\s*nowrap/);
    expect(rule).toMatch(/line-height:\s*1\b/);
    expect(rule).toMatch(/letter-spacing:\s*0\b/);
    expect(rule).toMatch(/font-size:\s*calc\(1em \* var\(--vd-icon-initial-scale, [\d.]+\)\)/);
    expect(homeCss).not.toMatch(/--vd-icon-text-fit/);
  });

  it("the launcher and mobile search tiles have a slot size", () => {
    expect(ruleBlock(homeCss, ".vela-launcher__icon")).toMatch(/--vd-slot-icon-size:\s*26px/);
    expect(ruleBlock(mobileCss, ".vela-mobile-search__app-icon")).toMatch(/--vd-slot-icon-size:\s*\d+px/);
  });

  it("portalled surfaces declare the slot token themselves", () => {
    expect(
      ruleBlock(mobileCss, ".vela-mobile-sheet--bottom-host, .vela-mobile-sheet--fullscreen-host"),
    ).toMatch(/--vd-slot-icon-size:\s*52px/);
    expect(
      ruleBlock(mobileCss, ".vela-mobile-shell, .vela-mobile-sheet--bottom-host, .vela-mobile-sheet--fullscreen-host"),
    ).toMatch(/--vd-slot-icon-size:\s*54px/);
    expect(ruleBlock(homeCss, "header.vela-inspector__subject")).toMatch(/--vd-slot-icon-size:\s*\d+px/);
  });

  it("every icon-text renderer goes through <IconText>", () => {
    for (const file of ["./app-icon-renderer.tsx", "./launcher.tsx", "./dock.tsx", "./app-appearance-inspector.tsx", "./add-app-dialog.tsx"]) {
      const source = read(file);
      expect(source, file).not.toMatch(/<span className="vela-app-icon__text">/);
      expect(source, file).toMatch(/<IconText /);
    }
  });
});

describe("icon initial: one user-visible character", () => {
  it("takes the first grapheme: 中文首字, Latin uppercased, digits, whole emoji", () => {
    expect(iconInitial("微信")).toBe("微");
    expect(iconInitial("测试")).toBe("测");
    expect(iconInitial("React")).toBe("R");
    expect(iconInitial("github")).toBe("G");
    expect(iconInitial("123云盘")).toBe("1");
    expect(iconInitial("🚀 Launch")).toBe("🚀");
    expect(iconInitial("👨‍👩‍👧 Family")).toBe("👨‍👩‍👧");
    expect(iconInitial("🇨🇳 China")).toBe("🇨🇳");
    expect(iconInitial("👍🏽ok")).toBe("👍🏽");
    expect(iconInitial("éclair")).toBe("É");
    expect(iconInitial("e\u0301clair")).toBe("E\u0301");
  });

  it("skips leading whitespace/punctuation, never splits on uppercasing", () => {
    expect(iconInitial("  飞书文档 ")).toBe("飞");
    expect(iconInitial("《三体》")).toBe("三");
    expect(iconInitial("(beta) tool")).toBe("B");
    expect(iconInitial("!!!")).toBe("!");
    expect(iconInitial("ßtraße")).toBe("ß");
    expect(iconInitial("")).toBe("");
    expect(iconInitial("   ")).toBe("");
  });

  it("generated icon text is the name's initial", () => {
    expect(generatedIconText("微信公众平台")).toBe("微");
    expect(generatedIconText("ChatGPT")).toBe("C");
  });

  it("<IconText> renders only the first character, with no fit variable", () => {
    const { container } = render(
      <>
        <IconText text="微信" />
        <IconText text="飞书文档" />
        <IconText text="NOTN" />
        <IconText text="🚀" />
      </>,
    );
    const spans = Array.from(container.querySelectorAll<HTMLElement>(".vela-app-icon__text"));
    expect(spans.map((span) => span.textContent)).toEqual(["微", "飞", "N", "🚀"]);
    for (const span of spans) {
      expect(span.getAttribute("style")).toBeNull();
    }
  });
});

describe("adaptive desktop tile sizes a single character", () => {
  it("uses the full single-character share regardless of stored text length", () => {
    const one = resolveAppContentLayout({ width: 200, height: 200, labelVisible: true, iconKind: "generated", generatedTextLength: 1 });
    const unset = resolveAppContentLayout({ width: 200, height: 200, labelVisible: true, iconKind: "generated" });
    expect(unset.generatedTextSize).toBe(one.generatedTextSize);
    expect(one.generatedTextSize! / one.iconBoxSize).toBeCloseTo(0.56, 2);
  });
});
