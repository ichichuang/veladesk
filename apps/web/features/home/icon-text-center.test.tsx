// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resolveAppContentLayout } from "./app-content-layout";
import { FIXED_SLOT_ICON_TEXT_BUDGET_EM, iconTextEmWidth, iconTextFitScale } from "./generated-icon";
import { IconText } from "./icon-text";

/*
 * fix/icon-text-center — regression contracts for the "search result icon
 * text is not centered" bug and its same-class siblings:
 *
 * 1. The shared `.vela-app-icon` tile owns centering (grid +
 *    place-items:center). Before, only `.vela-item__icon` / the dock button
 *    centered, so the launcher results and the mobile search results drew
 *    their initials as a block at the tile's top-left corner.
 * 2. Icon text is ONE nowrap line that shrinks to fit: 3–4 wide custom
 *    characters ("飞书文档", "NOTN") wrapped or spilled out of the tiles.
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

  it("icon text is a single unwrapped line box with the fit multiplier", () => {
    const rule = ruleBlock(homeCss, ".vela-app-icon__text");
    expect(rule).toMatch(/white-space:\s*nowrap/);
    expect(rule).toMatch(/line-height:\s*1\b/);
    expect(rule).toMatch(/font-size:\s*calc\(1em \* var\(--vd-icon-text-fit, 1\)\)/);
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

describe("icon text width model", () => {
  it("counts ideographs and emoji as 1em, Latin as narrow, marks as zero", () => {
    expect(iconTextEmWidth("微信")).toBe(2);
    expect(iconTextEmWidth("🚀")).toBe(1);
    expect(iconTextEmWidth("RE")).toBeCloseTo(1.44);
    expect(iconTextEmWidth("é")).toBeCloseTo(0.72);
    expect(iconTextEmWidth("  飞书 ")).toBe(2);
  });

  it("keeps every 1–2 character text at its size and shrinks wider text", () => {
    for (const text of ["M", "RE", "MD", "微信", "飞书", "🚀", "A画"]) {
      expect(iconTextFitScale(text), text).toBe(1);
    }
    for (const text of ["飞书文档", "NOTN", "AI画", "ABC"]) {
      const scale = iconTextFitScale(text);
      expect(scale, text).toBeLessThan(1);
      expect(iconTextEmWidth(text) * scale, text).toBeLessThanOrEqual(FIXED_SLOT_ICON_TEXT_BUDGET_EM + 0.001);
    }
  });

  it("<IconText> only emits the fit variable when the text needs it", () => {
    const { container } = render(
      <>
        <IconText text="微信" />
        <IconText text="飞书文档" />
      </>,
    );
    const [short, wide] = Array.from(container.querySelectorAll<HTMLElement>(".vela-app-icon__text"));
    expect(short!.textContent).toBe("微信");
    expect(short!.getAttribute("style")).toBeNull();
    expect(wide!.style.getPropertyValue("--vd-icon-text-fit")).toBe(String(iconTextFitScale("飞书文档")));
  });
});

describe("adaptive desktop tile caps generated text by width", () => {
  const layout = (text: string) =>
    resolveAppContentLayout({
      width: 200,
      height: 200,
      labelVisible: true,
      iconKind: "generated",
      generatedTextLength: Array.from(text).length,
      generatedTextEmWidth: iconTextEmWidth(text),
    });
  const withoutWidth = (text: string) =>
    resolveAppContentLayout({
      width: 200,
      height: 200,
      labelVisible: true,
      iconKind: "generated",
      generatedTextLength: Array.from(text).length,
    });

  it("leaves 1–2 character text unchanged", () => {
    for (const text of ["M", "RE", "微信", "🚀"]) {
      expect(layout(text).generatedTextSize, text).toBe(withoutWidth(text).generatedTextSize);
    }
  });

  it("fits 3–4 wide characters inside 90% of the icon box", () => {
    for (const text of ["飞书文档", "NOTN", "AI画"]) {
      const result = layout(text);
      expect(result.generatedTextSize! * iconTextEmWidth(text), text).toBeLessThanOrEqual(result.iconBoxSize * 0.9 + 0.005 * iconTextEmWidth(text)); // round2 slack
    }
    expect(layout("飞书文档").generatedTextSize!).toBeLessThan(withoutWidth("飞书文档").generatedTextSize!);
  });
});
