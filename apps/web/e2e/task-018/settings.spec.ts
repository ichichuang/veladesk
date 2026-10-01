import { expect, test } from "@playwright/test";

import {
  activeSectionName,
  bootIntoWorkspace,
  escapeDialog,
  failOnConsoleError,
  openSettings,
  seedUniqueWorkspace,
  settingsDialog,
  wheelAt,
} from "./helpers";
import { TWO_SECTIONS } from "../fixtures/seed";

/**
 * Task 018/019-D Settings Center: one stable window across tabs, canonical
 * HeroUI controls (no browser-default range/select controls of our own),
 * draft semantics (preview vs Cancel vs Save), interface style as ONE
 * product choice instead of raw surface sliders, branded header, and no
 * product logo on the desktop.
 */

test.beforeEach(async ({ page }) => {
  failOnConsoleError(page);
});

test("the window keeps a stable envelope while switching sections", async ({ page, request }) => {
  await seedUniqueWorkspace(request, "set-stable", TWO_SECTIONS);
  await bootIntoWorkspace(page, "Desk set-stable");
  await openSettings(page);

  const dialog = settingsDialog(page);
  // Let the Motion entrance finish before measuring the envelope.
  await page.waitForTimeout(500);
  const before = await dialog.boundingBox();
  expect(before).not.toBeNull();
  // Desktop envelope: ~880–920px wide, ≤680px tall (bounded by viewport).
  expect(before!.width).toBeGreaterThanOrEqual(860);
  expect(before!.width).toBeLessThanOrEqual(940);
  expect(before!.height).toBeLessThanOrEqual(680);

  for (const name of [/布局|Layout/, /通用|General/, /外观|Appearance/]) {
    await dialog.getByRole("tab", { name }).click();
    await page.waitForTimeout(300);
  }
  const after = await dialog.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(after!.width - before!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(1);
  await escapeDialog(page);
});

test("Appearance uses designed controls and previews live", async ({ page, request }) => {
  await seedUniqueWorkspace(request, "set-appearance", TWO_SECTIONS);
  await bootIntoWorkspace(page, "Desk set-appearance");
  await openSettings(page);

  const dialog = settingsDialog(page);
  // Theme mode is a designed segmented toggle (pressed-state buttons).
  await dialog.getByRole("button", { name: /浅色|Light/ }).first().click();
  await expect(page.locator(".vela-desktop")).toHaveAttribute(
    "data-vd-color-mode",
    "light",
    { timeout: 5_000 },
  );

  // Accent is swatch-first: pressed-state swatch buttons and a custom
  // swatch — and no raw hue-degree slider, no native range input of ours.
  await expect(dialog.getByRole("button", { name: /海蓝|Ocean Blue/ })).toBeVisible();
  expect(await dialog.locator("input[type='range']:not([data-vdu])").count()).toBe(0);

  // The interface style is ONE choice with three preview options.
  await dialog.getByRole("radio", { name: /清爽|Clean/ }).click();
  await dialog.getByRole("radio", { name: /玻璃|Glass/ }).click();

  // Cancel drops the preview: the desktop reverts to the persisted mode.
  await escapeDialog(page);
  await expect(page.locator(".vela-desktop")).toHaveAttribute("data-vd-color-mode", "dark", {
    timeout: 5_000,
  });
});

test("Layout and General rows use Switch and Select; Save persists once", async ({
  page,
  request,
}) => {
  const id = await seedUniqueWorkspace(request, "set-layout", TWO_SECTIONS);
  await bootIntoWorkspace(page, "Desk set-layout");
  await openSettings(page);

  const dialog = settingsDialog(page);
  await dialog.getByRole("tab", { name: /布局|Layout/ }).click();

  // Start-in-view is a Switch, not a checkbox.
  const startSwitch = dialog.getByRole("switch");
  await expect(startSwitch).toBeVisible();
  await startSwitch.click();

  // Default-section selector is a designed Select (portalled listbox); the
  // trigger shows the current value.
  await dialog
    .getByRole("button")
    .filter({ hasText: /Alpha/ })
    .click();
  await page.getByRole("option", { name: "Beta" }).click();

  // Save → exactly one revision, then the window closes.
  const before = await (await request.get(`/api/v1/workspaces/${id}`)).json();
  await dialog.getByRole("button", { name: /保存|Save/ }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });
  const after = await (await request.get(`/api/v1/workspaces/${id}`)).json();
  expect(after.workspace.revision).toBe(before.workspace.revision + 1);
  expect(after.workspace.snapshot.preferences.defaultPageId).toBe("page-beta");
});

test("the branded header shows the logo once; the desktop shows none", async ({
  page,
  request,
}) => {
  await seedUniqueWorkspace(request, "set-brand", TWO_SECTIONS);
  await bootIntoWorkspace(page, "Desk set-brand");

  await expect(page.locator(".vela-desktop img[src*='brand/']")).toHaveCount(0);

  await openSettings(page);
  const logo = settingsDialog(page).locator("img[src='/brand/veladesk-logo.png']");
  await expect(logo).toBeVisible();
  const box = await logo.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(24);
  expect(box!.height).toBeLessThanOrEqual(40);
  await escapeDialog(page);
});

test("nested Select inside Settings never closes the parent", async ({ page, request }) => {
  await seedUniqueWorkspace(request, "set-nested", TWO_SECTIONS);
  await bootIntoWorkspace(page, "Desk set-nested");
  await openSettings(page);

  const dialog = settingsDialog(page);
  await dialog.getByRole("tab", { name: /布局|Layout/ }).click();
  await dialog
    .getByRole("button")
    .filter({ hasText: /Alpha/ })
    .click();
  await page.keyboard.press("Escape"); // dismiss the select listbox only
  await page.waitForTimeout(250);
  await expect(dialog).toBeVisible();
  await escapeDialog(page);
});

test("settings wheel never reaches the rail (modal interaction scope)", async ({
  page,
  request,
}) => {
  await seedUniqueWorkspace(request, "set-wheel", TWO_SECTIONS);
  await bootIntoWorkspace(page, "Desk set-wheel");
  await openSettings(page);

  const dialog = settingsDialog(page);
  const box = await dialog.boundingBox();
  await wheelAt(page, box!.x + box!.width - 20, box!.y + 200, 800);
  await page.waitForTimeout(250);
  expect(await activeSectionName(page)).toBe("Alpha");
  await expect(dialog).toBeVisible();
});
