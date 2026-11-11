import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  bootIntoWorkspace,
  escapeDialog,
  failOnConsoleError,
  openSettings,
  pillRoot,
  seedUniqueWorkspace,
  wheelFlick,
} from "./helpers";
import { TWO_SECTIONS, thirtySections } from "../fixtures/seed";

/**
 * Task 018 visual-review evidence: screenshots and motion recordings for
 * design review — desktop sizes (1440×900, 1280×720), a narrow layout
 * (390×844), increased zoom, light/dark themes, all Settings tabs, the
 * App Visual Editor tabs, and the pill/section transition in motion.
 * Everything lands in artifacts/task-018/ (gitignored, never deleted).
 */

const SHOT = "../../artifacts/task-018/screenshots";

test.use({ video: "on" });

test.beforeEach(async ({ page }) => {
  failOnConsoleError(page);
});

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: false });
}

test("desktop + settings matrix at 1440×900, dark and light", async ({ page, request }) => {
  await seedUniqueWorkspace(request, "shot-main", TWO_SECTIONS);
  await bootIntoWorkspace(page, "Desk shot-main");
  await shoot(page, "desktop-1440-dark");

  // Settings: all three tabs.
  await openSettings(page);
  await shoot(page, "settings-appearance-dark");
  const dialog = page.locator("[data-settings-dialog]");
  await dialog.getByRole("tab", { name: /布局|Layout/ }).click();
  await page.waitForTimeout(300);
  await shoot(page, "settings-layout-dark");
  await dialog.getByRole("tab", { name: /通用|General/ }).click();
  await page.waitForTimeout(300);
  await shoot(page, "settings-general-dark");
  await escapeDialog(page);

  // Light theme through a persisted appearance change.
  await openSettings(page);
  await dialog.getByRole("radio", { name: /浅色|Light/ }).first().click();
  await page.waitForTimeout(300);
  await shoot(page, "settings-appearance-light");
  await dialog.getByRole("button", { name: /保存|Save/ }).click();
  await expect(page.locator("[data-settings-dialog]")).toBeHidden({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await shoot(page, "desktop-1440-light");
});

test("visual editor tabs at 1440×900", async ({ page, request }) => {
  await seedUniqueWorkspace(request, "shot-editor", TWO_SECTIONS);
  await bootIntoWorkspace(page, "Desk shot-editor");

  await page
    .locator('.vela-item[title="Gamma"]')
    .first()
    .click({ button: "right", force: true });
  await page.getByRole("menuitem", { name: /编辑外观|Edit appearance/ }).first().click();
  const dialog = page.locator('[role="dialog"][class*="right-0"]');
  await expect(dialog).toBeVisible();
  await shoot(page, "visual-editor-icon");

  // The editor's icon-source tabs are ToggleButtons (图标库 default,
  // then 文字) — the old 标题/外观 tabs left with the adaptive size
  // rework. Shoot the resting library tab, open the nested color popover
  // (its rows live on the default view), then the 文字 editor.
  await page.waitForTimeout(250);
  await shoot(page, "visual-editor-library-tab");
  await dialog.locator("button[aria-label*='—']").first().click();
  await page.waitForTimeout(250);
  await shoot(page, "visual-editor-color-popover");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  await dialog.getByRole("button").filter({ hasText: /文字|Text/ }).first().click();
  await page.waitForTimeout(250);
  await shoot(page, "visual-editor-text-tab");
  // The nested color popover + the editor each consume one Escape.
  for (let attempt = 0; attempt < 3 && (await dialog.isVisible()); attempt += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
  }
  await expect(dialog).toBeHidden({ timeout: 5_000 });
});

test("laptop height and narrow layout and zoom", async ({ page, request }) => {
  await seedUniqueWorkspace(request, "shot-sizes", TWO_SECTIONS);

  await page.setViewportSize({ width: 1280, height: 720 });
  await bootIntoWorkspace(page, "Desk shot-sizes");
  await shoot(page, "desktop-1280-720");
  await openSettings(page);
  await shoot(page, "settings-1280-720");
  await escapeDialog(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await shoot(page, "desktop-390-844");

  await page.setViewportSize({ width: 1280, height: 800 });
  // Returning from phone width: the mobile shell mounted by matchMedia,
  // and the desktop shell needs a fresh boot to take over again.
  await page.reload();
  await expect(page.locator(".vela-desktop")).toBeVisible({ timeout: 20_000 });
  // Open Settings BEFORE the zoom: the desktop context menu's viewport
  // clamping mixes zoom spaces (its items can land outside the viewport),
  // which is a pre-existing menu-positioning quirk — not what this shot
  // documents. The zoomed SETTINGS WINDOW is: zoom the open dialog.
  await openSettings(page);
  await page.evaluate(() => {
    const root = document.documentElement;
    root.style.zoom = "1.25";
  });
  await page.waitForTimeout(300);
  await shoot(page, "settings-zoom-125");
  await escapeDialog(page);
  await shoot(page, "desktop-zoom-125");
});

test("long Chinese and English section names on the pill", async ({ page, request }) => {
  const sections = [
    {
      id: "page-long-zh",
      name: "这是一个非常长的中文分区名称用于省略号测试",
      apps: [],
    },
    {
      id: "page-long-en",
      name: "An Extremely Long English Section Name For Ellipsis",
      apps: [],
    },
    TWO_SECTIONS[1]!,
  ];
  await seedUniqueWorkspace(request, "shot-names", sections);
  await bootIntoWorkspace(page, "Desk shot-names");
  await shoot(page, "pill-long-names");
});

test("pill + section transition motion recording", async ({ page, request }) => {
  await seedUniqueWorkspace(request, "shot-motion", thirtySections());
  await bootIntoWorkspace(page, "Desk shot-motion");

  const pillBox = await pillRoot(page).boundingBox();
  const x = pillBox!.x + 40;
  const y = pillBox!.y + pillBox!.height / 2;

  // Continued deliberate paging (motion continuity + indicator glide).
  for (let index = 0; index < 4; index += 1) {
    await wheelFlick(page, x, y, true);
    await page.waitForTimeout(420);
  }
  // A reversal mid-sequence.
  await wheelFlick(page, x, y, false);
  await page.waitForTimeout(420);
  // A distant click (no queuing).
  await page.locator(".vela-pill__item", { hasText: "Section 20" }).click();
  await page.waitForTimeout(500);
  expect(await page.locator('.vela-pill__item[data-active="true"]').textContent()).toContain(
    "Section 20",
  );
});
