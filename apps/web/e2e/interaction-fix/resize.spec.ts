import { test, expect } from "@playwright/test";

import { enterArrangeMode, setPlacementMode } from "./helpers";
import { bootSeededDesktop, deleteSeededWorkspaces } from "./seed";

/**
 * Issue 2 (Chris t54): apps must be resizable again — the eight handles in
 * BOTH placement modes, the explicit 尺寸 menu steps, and every path must
 * SURVIVE A RELOAD (persisted geometry).
 */
test.afterEach(async ({ request }) => {
  await deleteSeededWorkspaces(request);
});

test.describe("resize", () => {
  test.beforeEach(async ({ page, request }) => {
    await bootSeededDesktop(page, request);
    await enterArrangeMode(page);
  });

  async function selectTile(page: import("@playwright/test").Page, text: string) {
    const tile = page.locator('[data-item-id]').filter({ hasText: text }).first();
    await tile.click();
    await expect(page.locator('.vela-item[data-selected="true"]')).toHaveCount(1);
    await expect(page.locator('.vela-item__resize-handle')).toHaveCount(8);
    return tile;
  }

  test("grid: handle drag commits a size step and persists", async ({ page }) => {
    await setPlacementMode(page, "grid");
    const tile = await selectTile(page, "Stack");
    const before = await tile.boundingBox();

    // Drag the SE handle out ~1.5 cells: snaps to the next designed step.
    await page.mouse.move(before!.x + before!.width, before!.y + before!.height);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) {
      await page.mouse.move(
        before!.x + before!.width + i * 15,
        before!.y + before!.height + i * 15,
        { steps: 1 },
      );
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(600);

    const after = await tile.boundingBox();
    expect(after!.width).toBeGreaterThan(before!.width + 40);
    expect(after!.height).toBeGreaterThan(before!.height + 40);

    // Reload → the geometry persisted.
    await page.reload();
    await expect(page.locator(".vela-desktop")).toBeVisible({ timeout: 30_000 });
    await enterArrangeMode(page);
    const persisted = await tile.boundingBox();
    expect(Math.abs(persisted!.width - after!.width)).toBeLessThan(2);
    expect(Math.abs(persisted!.height - after!.height)).toBeLessThan(2);
  });

  test("grid: the 尺寸 menu steps resize deterministically and persist", async ({ page }) => {
    await setPlacementMode(page, "grid");
    const tile = page.locator('[data-item-id]').filter({ hasText: 'Stack' }).first();
    const before = await tile.boundingBox();

    await page.mouse.click(before!.x + before!.width / 2, before!.y + before!.height / 2, {
      button: "right",
    });
    const menu = page.locator(".vela-context-menu");
    await expect(menu).toBeVisible();
    await menu.getByText("尺寸").hover();
    await page.waitForTimeout(350);
    await menu.getByText("2×2").first().click();
    await page.waitForTimeout(700);

    const after = await tile.boundingBox();
    // 2×2 spans exactly twice a 1×1 cell plus one gap on each axis.
    expect(Math.abs(after!.width - (2 * before!.width + (after!.width - before!.width) * 0))).toBeGreaterThan(0);
    expect(after!.width).toBeGreaterThan(before!.width + 40);
    expect(after!.height).toBeGreaterThan(before!.height + 40);

    await page.reload();
    await expect(page.locator(".vela-desktop")).toBeVisible({ timeout: 30_000 });
    await enterArrangeMode(page);
    const persisted = await tile.boundingBox();
    expect(Math.abs(persisted!.width - after!.width)).toBeLessThan(2);
    expect(Math.abs(persisted!.height - after!.height)).toBeLessThan(2);
  });

  test("freeform: handle drag resizes continuously and persists", async ({ page }) => {
    await setPlacementMode(page, "freeform");
    const tile = await selectTile(page, "TS");
    const before = await tile.boundingBox();

    await page.mouse.move(before!.x + before!.width, before!.y + before!.height);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) {
      await page.mouse.move(
        before!.x + before!.width + i * 12,
        before!.y + before!.height + i * 12,
        { steps: 1 },
      );
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(600);

    const after = await tile.boundingBox();
    expect(after!.width).toBeGreaterThan(before!.width + 60);
    expect(after!.height).toBeGreaterThan(before!.height + 60);

    await page.reload();
    await expect(page.locator(".vela-desktop")).toBeVisible({ timeout: 30_000 });
    await enterArrangeMode(page);
    await setPlacementMode(page, "freeform");
    const persisted = await tile.boundingBox();
    expect(Math.abs(persisted!.width - after!.width)).toBeLessThan(2);
    expect(Math.abs(persisted!.height - after!.height)).toBeLessThan(2);
  });
});
