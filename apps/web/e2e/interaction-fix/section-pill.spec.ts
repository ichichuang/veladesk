import { test, expect } from "@playwright/test";

import {
  bootSeededDesktop,
  deleteSeededWorkspaces,
  resetLocalWorkspaceStorage,
} from "./seed";

/**
 * t61 issue 2: the right SectionRail is GONE — one compact glass pill
 * above the dock switches sections. Verified: no permanent right column,
 * the grid centers on the whole width (left/right whitespace within 8px),
 * hover-free click switching, global ←/→ keyboard switching, and the
 * overflowing pill scrolls instead of paging.
 */
test.afterEach(async ({ request }) => {
  await deleteSeededWorkspaces(request);
});

test.describe("section pill (t61)", () => {
  test.beforeEach(async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootSeededDesktop(page, request);
  });

  test("no permanent right column; the grid is horizontally centered", async ({ page }) => {
    // The rail is gone entirely.
    expect(await page.locator(".vela-rail").count()).toBe(0);
    // The pill exists, sits above the dock, and is horizontally centered.
    const pill = page.locator(".vela-pill");
    await expect(pill).toBeVisible();
    const pillBox = (await pill.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(Math.abs(pillBox.x + pillBox.width / 2 - viewport.width / 2)).toBeLessThan(8);
    const dockBox = await page.locator(".vela-dock").boundingBox();
    expect(dockBox).not.toBeNull();
    expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(dockBox!.y + 2);

    // The grid frame centers: its left/right whitespace differ < 8px.
    // Scoped to the ACTIVE layer — warm neighbors mount real grids too.
    const stage = page.locator(
      '.vela-section-layer[data-active-section="true"] .vela-grid-stage',
    );
    const stageBox = (await stage.boundingBox())!;
    const frame = page.locator(
      '.vela-section-layer[data-active-section="true"] .vela-grid-frame',
    );
    const frameBox = (await frame.boundingBox())!;
    const leftWhitespace = frameBox.x - stageBox.x;
    const rightWhitespace =
      stageBox.x + stageBox.width - (frameBox.x + frameBox.width);
    expect(Math.abs(leftWhitespace - rightWhitespace)).toBeLessThan(8);
  });

  test("switches by click without any hover", async ({ page }) => {
    const target = page.locator('.vela-pill__item[data-page-id]', { hasText: "AI 工具" }).first();
    await target.click();
    await expect(
      page.locator('.vela-pill__item[data-active="true"]'),
    ).toHaveText(/AI 工具/);
    await expect(page.locator('.vela-section-layer[data-phase="active"]')).toHaveAttribute(
      "data-page-id",
      "sec-ai",
    );
  });

  test("switches by global ArrowRight/ArrowLeft with no input focused", async ({ page }) => {
    // Leave focus on the body (no input) — plain arrows page sections.
    await page.locator("body").click({ position: { x: 40, y: 360 } });
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('.vela-pill__item[data-active="true"]')).toHaveText(/AI 工具/);
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator('.vela-pill__item[data-active="true"]')).toHaveText(/前端开发/);
  });

  test("the pill never intersects the tile grid", async ({ page }) => {
    const pillBox = (await page.locator(".vela-pill").boundingBox())!;
    const tiles = page.locator(".vela-grid-host [data-item-id]");
    const count = await tiles.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const box = await tiles.nth(i).boundingBox();
      const intersects =
        box!.x < pillBox.x + pillBox.width &&
        box!.x + box!.width > pillBox.x &&
        box!.y < pillBox.y + pillBox.height &&
        box!.y + box!.height > pillBox.y;
      expect(intersects, `tile ${i} intersects the pill`).toBe(false);
    }
  });

  test("below 900px the pill stays above the dock and still switches", async ({ page }) => {
    await page.setViewportSize({ width: 880, height: 900 });
    await page.waitForTimeout(500);
    const pill = page.locator(".vela-pill");
    await expect(pill).toBeVisible();
    const pillBox = (await pill.boundingBox())!;
    const dockBox = (await page.locator(".vela-dock").boundingBox())!;
    expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(dockBox.y + 2);
    await page.locator('.vela-pill__item', { hasText: "AI 工具" }).first().click();
    await expect(page.locator('.vela-pill__item[data-active="true"]')).toHaveText(/AI 工具/);
  });

  test("short viewports collapse the pill to name + steppers", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 540 });
    await page.waitForTimeout(500);
    const pill = page.locator(".vela-pill");
    await expect(pill).toHaveAttribute("data-compact", "true");
    await expect(page.locator(".vela-pill__scroller")).toBeHidden();
    await page.locator(".vela-pill__stepper[aria-label*='下一个']").click();
    await expect(page.locator(".vela-pill__compact-name")).toHaveText(/AI 工具/);
  });

  test("many sections: the pill scrolls horizontally instead of paging", async ({
    page,
    request,
  }) => {
    // The beforeEach already booted the base fixture; the local-first
    // store would remember it and skip the picker on the next load, so
    // reset the storage before booting the many-sections variant.
    await resetLocalWorkspaceStorage(page);
    await bootSeededDesktop(page, request, { manySections: true });
    const scroller = page.locator(".vela-pill__scroller");
    await expect(scroller).toBeVisible();
    const overflowing = await scroller.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(overflowing).toBe(true);
    // The pill fits one row: its height stays capsule-sized.
    const pillBox = (await page.locator(".vela-pill").boundingBox())!;
    expect(pillBox.height).toBeLessThan(60);

    // The active segment scrolls into view on activation (scrollIntoView).
    const deep = page.locator(".vela-pill__item", { hasText: "扩展分区20" }).first();
    await deep.click();
    await expect(page.locator('.vela-pill__item[data-active="true"]')).toHaveText(/扩展分区20/);
    const visible = await deep.evaluate((el) => {
      const segment = el as HTMLElement;
      const strip = segment.closest(".vela-pill__scroller") as HTMLElement;
      return (
        segment.offsetLeft >= strip.scrollLeft &&
        segment.offsetLeft + segment.offsetWidth <=
          strip.scrollLeft + strip.clientWidth + 1
      );
    });
    expect(visible).toBe(true);
  });
});
