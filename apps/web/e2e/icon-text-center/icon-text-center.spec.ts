import { expect, test, type Page } from "@playwright/test";

import { buildGridSnapshot, fetchRevision, seedWorkspace, type SeedSectionSpec } from "../fixtures/seed";
import { bootIntoWorkspace } from "../task-018/helpers";

/**
 * fix/icon-text-center — icon text must sit in the CENTER of its tile on
 * every surface (the launcher search results showed "微信" at the top-left
 * of the tile), on ONE line, inside the tile, for 1–4 characters of any
 * script.
 *
 * Measured with getBoundingClientRect: the text's layout box centre vs the
 * tile centre (≤ 1px), the text's line boxes (exactly one), the text's
 * glyph run vs the tile edges (inside), and the tile itself must be a real
 * tile (square, larger than its text) — a tile that lost its slot size
 * collapses onto the text and would otherwise "center" trivially.
 */

const PROBES: ReadonlyArray<{ id: string; text: string }> = [
  { id: "probe-1", text: "M" },
  { id: "probe-2", text: "RE" },
  { id: "probe-3", text: "微信" },
  { id: "probe-4", text: "AI画" },
  { id: "probe-5", text: "飞书文档" },
  { id: "probe-6", text: "NOTN" },
  { id: "probe-7", text: "🚀" },
];

const SECTIONS: readonly SeedSectionSpec[] = [
  {
    id: "page-probe",
    name: "Probe",
    apps: PROBES.map((probe, index) => ({
      id: probe.id,
      name: `Probe ${index + 1} ${probe.text}`,
      url: `https://probe-${index + 1}.example`,
    })),
  },
];

function probeSnapshot(workspaceId: string, name: string): Record<string, unknown> {
  const snapshot = buildGridSnapshot(workspaceId, name, SECTIONS);
  const entities = snapshot.entities as Array<Record<string, unknown>>;
  for (const probe of PROBES) {
    const entity = entities.find((candidate) => candidate.id === probe.id)!;
    entity.icon = { kind: "generated", text: probe.text, source: "custom" };
  }
  snapshot.dock = { items: PROBES.map((probe) => probe.id) };
  return snapshot;
}

const seeded: string[] = [];

test.afterEach(async ({ request }) => {
  // Leave the server catalog as found (it has a workspace limit).
  for (const id of seeded.splice(0)) {
    const expectedRevision = await fetchRevision(request, id);
    await request.delete(`/api/v1/workspaces/${id}`, { data: { expectedRevision } });
  }
});

interface Violation {
  readonly text: string;
  readonly surface: string;
  readonly problem: string;
}

/** Every visible icon text under `scope`, checked against its tile. */
async function iconTextViolations(page: Page, scope: string): Promise<{ checked: number; violations: Violation[] }> {
  return page.evaluate((scopeSelector) => {
    const violations: Violation[] = [];
    let checked = 0;
    for (const root of Array.from(document.querySelectorAll(scopeSelector))) {
      for (const text of Array.from(root.querySelectorAll<HTMLElement>(".vela-app-icon__text"))) {
        const box = text.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        const tile = text.closest(
          ".vela-app-content__icon, .vela-dock__item, .vela-item__icon, .vela-app-icon",
        );
        if (tile === null) continue;
        checked += 1;
        const t = tile.getBoundingClientRect();
        const label = text.textContent ?? "";
        const add = (problem: string) => violations.push({ text: label, surface: scopeSelector, problem });
        const dx = box.left + box.width / 2 - (t.left + t.width / 2);
        const dy = box.top + box.height / 2 - (t.top + t.height / 2);
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) add(`off-centre dx=${dx.toFixed(2)} dy=${dy.toFixed(2)}`);
        if (Math.abs(t.width - t.height) > 1) add(`tile not square ${t.width}x${t.height}`);
        const range = document.createRange();
        range.selectNodeContents(text);
        const rects = Array.from(range.getClientRects());
        const lines = new Set(rects.map((rect) => Math.round(rect.top))).size;
        if (lines !== 1) add(`wraps onto ${lines} lines`);
        const run = range.getBoundingClientRect();
        if (t.width <= run.height + 2) add(`tile collapsed onto its text (${t.width}px)`);
        if (run.left < t.left - 0.5 || run.right > t.right + 0.5) add(`text spills out ${run.width.toFixed(1)} > ${t.width}`);
      }
    }
    return { checked, violations };
  }, scope);
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "zh-CN" });

  test("desktop tiles, dock and launcher results center their icon text", async ({ page, request }) => {
    const run = Date.now().toString(36);
    seeded.push(`ws-icon-center-d-${run}`);
    await seedWorkspace(request, probeSnapshot(`ws-icon-center-d-${run}`, `Icon Center Desktop ${run}`));
    await bootIntoWorkspace(page, `Icon Center Desktop ${run}`);
    await expect(page.locator(".vela-app-content__icon .vela-app-icon__text").first()).toBeVisible();

    const desk = await iconTextViolations(page, ".vela-desktop");
    expect(desk.checked).toBeGreaterThanOrEqual(PROBES.length * 2 - 2); // tiles + dock (emoji counted)
    expect.soft(desk.violations).toEqual([]);

    await page.mouse.click(1010, 690, { button: "right" });
    await page.getByRole("menuitem", { name: /^(搜索|Search)/ }).first().click();
    await page.keyboard.type("Probe");
    await expect(page.locator(".vela-launcher__option").first()).toBeVisible();
    await page.waitForTimeout(300);
    const launcher = await iconTextViolations(page, ".vela-launcher");
    expect(launcher.checked).toBeGreaterThanOrEqual(PROBES.length - 1);
    expect.soft(launcher.violations).toEqual([]);
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, locale: "zh-CN" });

  test("mobile grid, dock and search results center their icon text", async ({ page, request }) => {
    const run = Date.now().toString(36);
    seeded.push(`ws-icon-center-m-${run}`);
    await seedWorkspace(request, probeSnapshot(`ws-icon-center-m-${run}`, `Icon Center Mobile ${run}`));
    await page.goto("/");
    const pickerItem = page.locator(".vela-picker__item", { hasText: `Icon Center Mobile ${run}` });
    const shell = page.locator(".vela-mobile-shell");
    await expect(pickerItem.or(shell)).toBeVisible({ timeout: 20_000 });
    if (await pickerItem.isVisible()) await pickerItem.click();
    await expect(page.locator(".vela-mobile-shell .vela-app-icon__text").first()).toBeVisible({ timeout: 20_000 });

    const home = await iconTextViolations(page, ".vela-mobile-shell");
    expect(home.checked).toBeGreaterThanOrEqual(PROBES.length - 1);
    expect.soft(home.violations).toEqual([]);

    await page.getByRole("button", { name: /^(搜索|Search)$/ }).first().click();
    await page.keyboard.type("Probe");
    await expect(page.locator(".vela-mobile-search__row").first()).toBeVisible();
    await page.waitForTimeout(300);
    const search = await iconTextViolations(page, "[data-vd-portal-root], .vela-mobile-shell");
    expect.soft(search.violations).toEqual([]);
    const rows = await page.locator(".vela-mobile-search__row .vela-app-icon__text").count();
    expect(rows).toBeGreaterThanOrEqual(PROBES.length - 1);
  });
});
