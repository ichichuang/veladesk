import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * task 029 (圆角修复): the per-app `--vd-app-icon-radius` must reach the
 * glyph PIXELS (uploaded images + multicolor library logos clip at their
 * own box) and the DOCK must consume the var instead of a fixed 12px —
 * the two renderer-level gaps that made the 028 slider look dead.
 */
const css = readFileSync(fileURLToPath(new URL("./home-shell.css", import.meta.url)), "utf8");

describe("app icon corner radius CSS contract (task 029)", () => {
  it("rounds and clips the image glyph layers at the per-app radius", () => {
    const rule = css.match(
      /\.vela-app-icon__image,\s*\n\.vela-app-icon__glyph--image\s*\{([\s\S]*?)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/border-radius:\s*var\(--vd-app-icon-radius, 0px\)/);
    expect(rule![1]).toMatch(/overflow:\s*hidden/);
  });

  it("the dock reads the per-app radius; the fixed 12px is only the fallback", () => {
    const rule = css.match(/\.vela-dock__item,\s*\n\.vela-dock__utility\s*\{([\s\S]*?)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/border-radius:\s*var\(--vd-app-icon-radius, 12px\)/);
    expect(rule![1]).not.toMatch(/border-radius:\s*12px;/);
  });

  it("keeps every var consumer wired (surface, plate, fixed slot, reflection, dock, glyph)", () => {
    // 028 shipped five consuming sites in this stylesheet (a sixth lives in
    // mobile-shell.css); task 029 adds the glyph layer and the dock — the
    // count must never drop below that.
    expect(css.match(/var\(--vd-app-icon-radius/g)?.length ?? 0).toBeGreaterThanOrEqual(7);
  });
});
