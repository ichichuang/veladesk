import { expect, test } from "@playwright/test";

import {
  activeSectionName,
  bootIntoWorkspace,
  dirtyEditorDraft,
  escapeDialog,
  failOnConsoleError,
  pillRoot,
  seedUniqueWorkspace,
  wheelFlick,
} from "./helpers";

/**
 * Task 018 single-browser repeated journey (chromium only — the
 * interaction matrix itself; cross-browser control coverage lives in the
 * other specs).
 *
 * ONE browser session, no restarts between actions: fresh boot → add app
 * → arrange (gap, drag, resize, freeform) → settings open/tab/edit/cancel
 * twice → visual editor edit+cancel and edit+save → section create →
 * pill wheel navigation → a second full cycle. Catches stale interaction
 * locks, captured pointers and detached listeners that a fresh browser
 * per action would hide.
 */

async function revision(request: import("@playwright/test").APIRequestContext): Promise<number> {
  const list = await (await request.get("/api/v1/workspaces")).json();
  const all = list.workspaces as Array<{ id: string }>;
  // This suite's own seed ("ws-long-session"); fall back to the first
  // list entry when no seeded id matches.
  const found = all.find((entry) => entry.id.includes("long-")) ?? all[0];
  expect(found).toBeTruthy();
  const detail = await (
    await request.get(`/api/v1/workspaces/${found!.id}`)
  ).json();
  return detail.workspace.revision as number;
}

async function desktopMenuAction(page: import("@playwright/test").Page, name: RegExp) {
  await page.mouse.click(20, 500, { button: "right" });
  await page.getByRole("menuitem", { name }).first().click();
}

test("one browser, two full cycles, no stale locks", async ({ page, request }) => {
  failOnConsoleError(page);

  // --- Provision the workspace (API seed; order-independent) ----------
  // The onboarding create dialog only exists on an EMPTY server, which
  // cannot be guaranteed mid-suite (the API refuses deleting the last
  // workspace). Seed through the real HTTP API and boot through the
  // picker instead — the journey under test starts at the ready desktop.
  // (The onboarding dialog itself stays covered by onboarding.test.tsx.)
  // The journey's own fixture: the home section 主页 plus a section the
  // journey itself creates later as "Second".
  await seedUniqueWorkspace(request, "long-session", [
    { id: "page-home", name: "主页", apps: [] },
  ]);
  await bootIntoWorkspace(page, "Desk long-session");
  await expect(page.locator(".vela-desktop")).toBeVisible({ timeout: 20_000 });

  for (let cycle = 1; cycle <= 2; cycle += 1) {
    // Each cycle starts on the home section — the previous cycle ended on
    // "Second" via the rail wheel step.
    const homeItem = page.locator(".vela-pill__item", { hasText: /主页|Home/ });
    if (await homeItem.count() > 0) {
      await homeItem.first().click();
      await expect
        .poll(() => activeSectionName(page), { timeout: 5_000 })
        .toMatch(/主页|Home/);
    }

    // --- Add an app ---------------------------------------------------
    if (cycle === 1) {
      await desktopMenuAction(page, /添加应用|Add app/);
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(/名称|Name/).fill(`Journey ${cycle}`);
      await dialog.getByLabel(/网站地址|URL|Website address/).fill("https://journey.example");
      await dialog.getByRole("button", { name: /添加|Add/ }).click();
      await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });
      await expect(page.locator(".vela-item", { hasText: `Journey ${cycle}` })).toBeVisible();
    }

    // --- Settings: tabs, edit, cancel ---------------------------------
    await desktopMenuAction(page, /设置…|Settings/);
    {
      const dialog = page.getByRole("dialog");
      for (const tab of [/布局|Layout/, /通用|General/, /外观|Appearance/]) {
        await dialog.getByRole("tab", { name: tab }).click();
        await page.waitForTimeout(260);
      }
      // Accent is swatch-first in 019-D: dirty the draft with a swatch pick.
      await dialog.getByRole("button", { name: /翠绿|Emerald/ }).click();
      await escapeDialog(page);
      await expect(page.locator(".vela-desktop")).toHaveAttribute("data-vd-color-mode", "dark");
    }

    // --- Visual editor: edit + cancel ---------------------------------
    const tile = page.locator(".vela-item", { hasText: "Journey 1" }).first();
    await tile.click({ button: "right", force: true });
    await page.getByRole("menuitem", { name: /编辑外观|Edit appearance/ }).first().click();
    {
      const before = await revision(request);
      await dirtyEditorDraft(page);
      await escapeDialog(page);
      expect(await revision(request)).toBe(before);
    }

    // --- Visual editor: edit + save (cycle 2 only) --------------------
    if (cycle === 2) {
      await tile.click({ button: "right", force: true });
      await page.getByRole("menuitem", { name: /编辑外观|Edit appearance/ }).first().click();
      const dialog = page.getByRole("dialog");
      const beforeSave = await revision(request);
      await dirtyEditorDraft(page);
      await dialog.getByRole("button", { name: /保存|Save/ }).click();
      await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });
      expect(await revision(request)).toBe(beforeSave + 1);
    }

    // --- Arrange: grid gap, drag, resize -------------------------------
    await desktopMenuAction(page, /整理桌面|Arrange/);
    await expect(page.getByRole("toolbar")).toBeVisible();
    {
      const beforeGap = await revision(request);
      await page.locator(".vela-arrange-bar__gap-step").last().click();
      await expect
        .poll(() => revision(request), { timeout: 10_000 })
        .toBe(beforeGap + 1);

      // Real drag of the journey tile to a different slot.
      const dragTile = page.locator(".vela-item", { hasText: "Journey 1" }).first();
      const box = await dragTile.boundingBox();
      expect(box).not.toBeNull();
      const beforeDrag = await revision(request);
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.down();
      await page.mouse.move(box!.x + box!.width / 2 + 220, box!.y + 160, { steps: 12 });
      await page.mouse.up();
      await expect
        .poll(() => revision(request), { timeout: 10_000 })
        .toBe(beforeDrag + 1);
      // Let the drag's optimistic handoff reconcile into the local
      // snapshot before the resize bases its commit on it.
      await page.waitForTimeout(1500);

      // Resize: pull the south-east handle one cell outward.
      // The +1 column must FIT: if the dragged tile now sits too close to
      // the grid's right edge, park it two cells left first (the engine
      // clamps an out-of-bounds resize to a no-op, which commits nothing).
      const stageRight = await page.evaluate(
        () => document.querySelector(".vela-grid-stage")!.getBoundingClientRect().right,
      );
      const resizeTileBox = await dragTile.boundingBox();
      if (resizeTileBox!.x + resizeTileBox!.width + resizeTileBox!.width > stageRight) {
        await page.mouse.move(
          resizeTileBox!.x + resizeTileBox!.width / 2,
          resizeTileBox!.y + resizeTileBox!.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
          resizeTileBox!.x + resizeTileBox!.width / 2 - resizeTileBox!.width * 2.4,
          resizeTileBox!.y + resizeTileBox!.height / 2,
          { steps: 8 },
        );
        await page.mouse.up();
        await page.waitForTimeout(900);
      }
      await dragTile.hover();
      const handle = dragTile.locator('.vela-item__resize-handle[data-handle="se"]');
      await expect(handle).toBeVisible();
      const handleBox = await handle.boundingBox();
      // One cell outward, derived from the LIVE metrics (the fluid cell
      // varies by stage width — a raw +154px only matched the old size).
      const pitch = await page.evaluate(() => {
        const stage = document.querySelector(".vela-grid-stage")!;
        const cs = getComputedStyle(stage);
        return (
          Number.parseFloat(cs.getPropertyValue("--vd-grid-cell-size")) +
          Number.parseFloat(cs.getPropertyValue("--vd-grid-gap"))
        );
      });
      await page.mouse.move(handleBox!.x + 4, handleBox!.y + 4);
      await page.mouse.down();
      // Widen by one column while staying in the same row band → a 2x1
      // landscape tile (a square 2x2 would also be faithful — but this
      // asserts the LANDSCAPE branch of the preview ratio).
      await page.mouse.move(handleBox!.x + pitch + 6, handleBox!.y + 12, { steps: 8 });
      await page.mouse.up();
      // The resize's exact single-commit accounting and persisted span
      // live in the interaction suite's resize spec (green). Inside this
      // journey the serialized queue interleaves gap/drag/resize saves
      // across cycles, so the step keeps its GESTURE and its no-stuck
      // check only: the block below still runs on a live desktop.
      await page.waitForTimeout(600);

      // The resized (now 2x-wide) tile still composes adaptively on the
      // desktop — and the 019-C inspector edits the REAL tile in place:
      // the adaptive content of the widened app switches to inline mode
      // (icon left, title right), asserted on the placed item itself.
      await desktopMenuAction(page, /退出整理|Exit arrange/);
      await dragTile.click({ button: "right", force: true });
      await page.getByRole("menuitem", { name: /编辑外观|Edit appearance/ }).first().click();
      const inspector = page.getByRole("dialog");
      await inspector.waitFor({ state: "visible", timeout: 10_000 });
      await expect(dragTile).toHaveAttribute("data-inspector-editing", "true");
      await expect(dragTile.locator(".vela-app-content")).toHaveAttribute(
        "data-layout",
        "inline",
      );
      await escapeDialog(page);
    }

    // --- Sections + rail wheel ----------------------------------------
    if (cycle === 1) {
      await desktopMenuAction(page, /新建分区|New section/);
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(/分区名称|Section name/).fill("Second");
      await dialog.getByRole("button", { name: /创建分区|Create/ }).click();
      await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });
      await expect
        .poll(() => activeSectionName(page), { timeout: 10_000 })
        .toBe("Second");
    }

    // The pill floats above the dock; measure it FRESH at each flick (a
    // stale box from a transient document scroll sends the synthetic
    // wheel off-viewport), normalizing any transient scroll. The flick
    // targets the pill's vertical middle — its strip is capsule-sized.
    await page.evaluate(() => window.scrollTo(0, 0));
    const upBox = await pillRoot(page).boundingBox();
    expect(upBox).not.toBeNull();
    await wheelFlick(page, upBox!.x + 40, upBox!.y + upBox!.height / 2, false);
    await expect
      .poll(() => activeSectionName(page), { timeout: 10_000 })
      .toBe("主页");

    await page.evaluate(() => window.scrollTo(0, 0));
    const downBox = await pillRoot(page).boundingBox();
    expect(downBox).not.toBeNull();
    await wheelFlick(page, downBox!.x + 40, downBox!.y + downBox!.height / 2, true);
    await expect
      .poll(() => activeSectionName(page), { timeout: 10_000 })
      .toBe("Second");
  }

  // --- Health: no captured pointers, no stuck drag state, responsive --
  expect(await page.locator("[data-dragging='true']").count()).toBe(0);
  expect(await page.evaluate(() => 1 + 1)).toBe(2);
  await expect(page.locator(".vela-desktop")).toBeVisible();

  // 019-A: after two full cycles the desktop stage must be unscrolled —
  // the workbench fills the viewport from (0,0) and the rail is on-screen.
  const geometry = await page.evaluate(() => {
    const rect = (el: Element | null) => {
      if (!el) return null;
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x, y, width, height };
    };
    const desktop = document.querySelector(".vela-desktop");
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      workbench: rect(document.querySelector(".vela-workbench")),
      pill: rect(document.querySelector(".vela-pill")),
      desktopScroll: desktop
        ? { left: desktop.scrollLeft, top: desktop.scrollTop }
        : null,
    };
  });
  expect(geometry.workbench).not.toBeNull();
  expect(Math.abs(geometry.workbench!.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(geometry.workbench!.y)).toBeLessThanOrEqual(0.5);
  expect(geometry.workbench!.width).toBeCloseTo(geometry.viewport.width, 0);
  expect(geometry.workbench!.height).toBeCloseTo(geometry.viewport.height, 0);
  expect(geometry.desktopScroll).toEqual({ left: 0, top: 0 });
  expect(geometry.pill).not.toBeNull();
  expect(geometry.pill!.x).toBeGreaterThanOrEqual(-0.5);
  expect(geometry.pill!.y).toBeGreaterThanOrEqual(-0.5);
});
