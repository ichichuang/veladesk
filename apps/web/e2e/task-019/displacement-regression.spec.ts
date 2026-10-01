import { expect, test } from "@playwright/test";

import { buildGridSnapshot, seedWorkspace, type SeedSectionSpec } from "../fixtures/seed";
import { bootIntoWorkspace, failOnConsoleError } from "../task-018/helpers";
import { captureGeometry, workbenchViolations } from "./geometry";

/**
 * Task 019-A RED regression (must fail before the fix, pass after).
 *
 * Root cause (trace-proven 2026-09-22): `.vela-desktop` was
 * `overflow: hidden` — a programmatically scrollable box whose ambient
 * ::before layer (inset: -20% + blur) permanently extends its scrollable
 * overflow ~288px right / ~183px down. Native ancestor scrolling (element
 * focus() restoration, scrollIntoView, hover actionability) then LATCHED
 * scrollLeft/Top on the desktop that no user gesture could scroll back,
 * displacing the in-flow workbench by exactly the latched scroll amount
 * and accumulating across overlay sessions.
 *
 * This spec replays the shortest sequence the failing trace showed to
 * latch a scroll — arrange mode, max grid gap, a real drag, then a hover
 * (whose actionability performs scroll-into-view on the ancestors) — and
 * asserts the geometry invariant with real mouse input only.
 */

const SECTIONS: readonly SeedSectionSpec[] = [
  {
    id: "page-home",
    name: "Home",
    apps: [
      { id: "app-one", name: "Alpha", url: "https://alpha.example" },
      { id: "app-two", name: "Beta", url: "https://beta.example" },
    ],
  },
];

async function desktopMenuAction(
  page: import("@playwright/test").Page,
  name: RegExp,
): Promise<void> {
  await page.mouse.click(700, 450, { button: "right" });
  await page.getByRole("menuitem", { name }).first().click();
}

test("arrange drag + hover cannot latch scroll on the desktop stage", async ({ page, request }) => {
  failOnConsoleError(page);

  const snapshot = buildGridSnapshot("ws-019-reg", "Desk 019 Regression", SECTIONS);
  // Arrange is the mode this journey lives in; do not lock it out.
  (snapshot.preferences as Record<string, unknown>).layoutLocked = false;
  await seedWorkspace(request, snapshot);
  await bootIntoWorkspace(page, "Desk 019 Regression");

  await desktopMenuAction(page, /整理桌面|Arrange/);
  await expect(page.getByRole("toolbar")).toBeVisible();

  // Largest gap step — the proven failing configuration.
  await page.locator(".vela-arrange-bar__gap-step").last().click();
  await page.waitForTimeout(400);

  // Real pointer drag of the first tile to a lower-right slot.
  const tile = page.locator(".vela-item", { hasText: "Alpha" }).first();
  const box = await tile.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 220, box!.y + 160, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  // The latching action from the trace: hover (actionability runs
  // scroll-into-view across every scrollable ancestor).
  await tile.hover();
  await page.waitForTimeout(300);

  const capture = await captureGeometry(page, "after-hover");
  const violations = workbenchViolations(capture);
  expect(violations, JSON.stringify(capture, null, 2)).toEqual([]);
});

test("overlay cycles cannot displace the desktop stage", async ({ page, request }) => {
  failOnConsoleError(page);

  const snapshot = buildGridSnapshot("ws-019-ovl", "Desk 019 Overlays", SECTIONS);
  (snapshot.preferences as Record<string, unknown>).layoutLocked = false;
  await seedWorkspace(request, snapshot);
  await bootIntoWorkspace(page, "Desk 019 Overlays");

  // Settings open/escape three times — focus restoration after each close
  // is a real-user scroll-into-view source.
  for (let round = 1; round <= 3; round += 1) {
    await desktopMenuAction(page, /设置…|Settings/);
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    for (const tab of [/布局|Layout/, /通用|General/, /外观|Appearance/]) {
      await dialog.getByRole("button", { name: tab }).click();
      await page.waitForTimeout(200);
    }
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 10_000 });
    await page.waitForTimeout(200);
  }

  const capture = await captureGeometry(page, "after-overlays");
  const violations = workbenchViolations(capture);
  expect(violations, JSON.stringify(capture, null, 2)).toEqual([]);
});
