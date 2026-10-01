import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  bootIntoWorkspace,
  escapeDialog,
  failOnConsoleError,
  openSettings,
  railRoot,
  seedUniqueWorkspace,
  wheelFlick,
} from "./helpers";
import { TWO_SECTIONS, thirtySections } from "../fixtures/seed";

/**
 * Task 018 visual-review evidence: screenshots and motion recordings for
 * design review — desktop sizes (1440×900, 1280×720), a narrow layout
 * (390×844), increased zoom, light/dark themes, all Settings tabs, the
 * App Visual Editor tabs, and the rail/section transition in motion.
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
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: /布局|Layout/ }).click();
  await page.waitForTimeout(300);
  await shoot(page, "settings-layout-dark");
  await dialog.getByRole("tab", { name: /通用|General/ }).click();
  await page.waitForTimeout(300);
  await shoot(page, "settings-general-dark");
  await escapeDialog(page);

  // Light theme through a persisted appearance change.
  await openSettings(page);
  await dialog.getByRole("button", { name: /浅色|Light/ }).first().click();
  await page.waitForTimeout(300);
  await shoot(page, "settings-appearance-light");
  await dialog.getByRole("button", { name: /保存|Save/ }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await shoot(page, "desktop-1440-light");
});

test("visual editor tabs at 1440×900", async ({ page, request }) => {
  await seedUniqueWorkspace(request, "shot-editor", TWO_SECTIONS);
  await bootIntoWorkspace(page, "Desk shot-editor");

  await page.locator(".vela-item", { hasText: "Gamma" }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: /编辑外观|Edit appearance/ }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shoot(page, "visual-editor-icon");

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: /标题|Title/ }).click();
  await page.waitForTimeout(250);
  await shoot(page, "visual-editor-title");
  await dialog.getByRole("tab", { name: /外观|Appearance/ }).click();
  await page.waitForTimeout(250);
  await shoot(page, "visual-editor-appearance");

  // The color popover open — nested-portal visual state.
  await dialog.locator("button[aria-label*='—']").first().click();
  await page.waitForTimeout(250);
  await shoot(page, "visual-editor-color-popover");
  await page.keyboard.press("Escape");
  await escapeDialog(page);
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
  await page.evaluate(() => {
    const root = document.documentElement;
    root.style.zoom = "1.25";
  });
  await page.waitForTimeout(300);
  await shoot(page, "desktop-zoom-125");
  await openSettings(page);
  await shoot(page, "settings-zoom-125");
  await escapeDialog(page);
});

test("long Chinese and English section names on the rail", async ({ page, request }) => {
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
  await shoot(page, "rail-long-names");
});

test("rail + section transition motion recording", async ({ page, request }) => {
  await seedUniqueWorkspace(request, "shot-motion", thirtySections());
  await bootIntoWorkspace(page, "Desk shot-motion");

  const railBox = await railRoot(page).boundingBox();
  const x = railBox!.x + 40;
  const y = railBox!.y + 80;

  // Continued deliberate paging (motion continuity + indicator glide).
  for (let index = 0; index < 4; index += 1) {
    await wheelFlick(page, x, y, true);
    await page.waitForTimeout(420);
  }
  // A reversal mid-sequence.
  await wheelFlick(page, x, y, false);
  await page.waitForTimeout(420);
  // A distant click (no queuing).
  await page.locator(".vela-rail__item", { hasText: "Section 20" }).click();
  await page.waitForTimeout(500);
  expect(await page.locator('.vela-rail__item[data-active="true"]').textContent()).toContain(
    "Section 20",
  );
});
