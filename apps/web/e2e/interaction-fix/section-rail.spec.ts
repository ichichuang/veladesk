import { test, expect } from "@playwright/test";

import {
  bootSeededDesktop,
  deleteSeededWorkspaces,
  resetLocalWorkspaceStorage,
} from "./seed";

/**
 * Issue 4 (Chris t54): the section switcher must be ALWAYS visible and
 * hover-free — clickable rows, keyboard arrows, wheel paging; it occupies
 * its own layout space (bounding boxes never intersect the tile grid), it
 * scrolls when there are many sections, and below 900px it becomes the
 * horizontal bar.
 */
test.afterEach(async ({ request }) => {
  await deleteSeededWorkspaces(request);
});

test.describe("section rail", () => {
  test.beforeEach(async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootSeededDesktop(page, request);
  });

  test("switches by click without any hover", async ({ page }) => {
    const target = page.locator('.vela-rail__item[data-page-id]', { hasText: "AI 工具" }).first();
    await target.click();
    await expect(
      page.locator('.vela-rail__item[data-active="true"]'),
    ).toHaveText(/AI 工具/);
  });

  test("switches by keyboard: arrows + Enter, no pointer at all", async ({ page }) => {
    const active = page.locator('.vela-rail__item[data-active="true"]');
    await active.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(active).not.toHaveText(/前端开发/);
  });

  test("pages sections on deliberate wheel input over the rail", async ({ page }) => {
    const rail = page.locator(".vela-rail");
    const box = await rail.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 120);
    // One deliberate step (≥ WHEEL_STEP_PX of travel in one event).
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(400);
    const activeName = await page.locator('.vela-rail__item[data-active="true"]').textContent();
    expect(activeName).not.toContain("前端开发");
  });

  test("never intersects the tile grid (column at ≥900px)", async ({ page }) => {
    const railBox = await page.locator(".vela-rail").boundingBox();
    expect(railBox).not.toBeNull();
    const tiles = page.locator(".vela-grid-host [data-item-id]");
    const count = await tiles.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const box = await tiles.nth(i).boundingBox();
      const intersects =
        box!.x < railBox!.x + railBox!.width &&
        box!.x + box!.width > railBox!.x &&
        box!.y < railBox!.y + railBox!.height &&
        box!.y + box!.height > railBox!.y;
      expect(intersects, `tile ${i} intersects the rail`).toBe(false);
    }
  });

  test("below 900px it becomes the horizontal bar and still never covers tiles", async ({ page }) => {
    await page.setViewportSize({ width: 880, height: 900 });
    await page.waitForTimeout(500);
    const rail = page.locator(".vela-rail");
    await expect(rail).toHaveAttribute("data-orientation", "horizontal");
    const railBox = await rail.boundingBox();
    const tiles = page.locator(".vela-grid-host [data-item-id]");
    const count = await tiles.count();
    for (let i = 0; i < count; i += 1) {
      const box = await tiles.nth(i).boundingBox();
      const intersects =
        box!.x < railBox!.x + railBox!.width &&
        box!.x + box!.width > railBox!.x &&
        box!.y < railBox!.y + railBox!.height &&
        box!.y + box!.height > railBox!.y;
      expect(intersects, `tile ${i} intersects the horizontal bar`).toBe(false);
    }
    // And it still switches sections.
    await page.locator('.vela-rail__item', { hasText: "AI 工具" }).first().click();
    await expect(page.locator('.vela-rail__item[data-active="true"]')).toHaveText(/AI 工具/);
  });

  test("many sections: the list scrolls and the wheel yields to it", async ({
    page,
    request,
  }) => {
    // The beforeEach already booted the base fixture; the local-first
    // store would remember it and skip the picker on the next load, so
    // reset the storage before booting the many-sections variant.
    await resetLocalWorkspaceStorage(page);
    await bootSeededDesktop(page, request, { manySections: true });
    const list = page.locator(".vela-rail__list");
    await expect(list).toBeVisible();
    const overflowing = await list.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(overflowing).toBe(true);

    // Deliberate wheel over the overflowing list scrolls it natively and
    // does NOT page sections (the list owns its wheel then).
    const before = await page.locator('.vela-rail__item[data-active="true"]').textContent();
    const box = await list.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 80);
    await page.waitForTimeout(300);
    const scrolled = await list.evaluate((el) => el.scrollTop > 0);
    const after = await page.locator('.vela-rail__item[data-active="true"]').textContent();
    expect(scrolled).toBe(true);
    expect(after).toBe(before);

    // The active row scrolls back into view on activation (scrollIntoView).
    const deepRow = page.locator(".vela-rail__item", { hasText: "扩展分区20" }).first();
    await deepRow.click();
    await expect(page.locator('.vela-rail__item[data-active="true"]')).toHaveText(/扩展分区20/);
    const visible = await deepRow.evaluate((el) => {
      const row = el as HTMLElement;
      const list2 = row.closest(".vela-rail__list") as HTMLElement;
      return (
        row.offsetTop >= list2.scrollTop &&
        row.offsetTop <= list2.scrollTop + list2.clientHeight
      );
    });
    expect(visible).toBe(true);
  });
});
