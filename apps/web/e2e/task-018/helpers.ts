import type { Page, APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";

import {
  buildGridSnapshot,
  seedWorkspace,
  type SeedSectionSpec,
} from "../fixtures/seed";

/**
 * Shared task-018 browser-suite helpers: deterministic seeding, boot into
 * the ready desktop, and common UI entry points. All wheel input here is
 * SYNTHETIC (CDP-driven mouse.wheel streams shaped like recorded device
 * traces) — natural trackpad feel is called out separately in the report.
 */

export async function seedUniqueWorkspace(
  request: APIRequestContext,
  key: string,
  sections: readonly SeedSectionSpec[],
): Promise<string> {
  return seedWorkspace(request, buildGridSnapshot(`ws-${key}`, `Desk ${key}`, sections));
}

/** Boots the page and enters the seeded workspace (picker → desktop). */
export async function bootIntoWorkspace(page: Page, workspaceName: string): Promise<void> {
  await page.addInitScript(() => {
    // Deterministic boot: no lingering locale, fresh IDB per context anyway.
    window.localStorage.removeItem("veladesk:ui-locale");
  });
  await page.goto("/");
  // A single server workspace auto-pulls straight into the desktop; with
  // several, the picker appears — both paths land on the ready desktop.
  const pickerItem = page.locator(".vela-picker__item", { hasText: workspaceName });
  const desktop = page.locator(".vela-desktop");
  await expect(pickerItem.or(desktop)).toBeVisible({ timeout: 20_000 });
  if (await pickerItem.isVisible()) {
    await pickerItem.click();
  }
  await expect(desktop).toBeVisible({ timeout: 20_000 });
}

export async function activeSectionName(page: Page): Promise<string> {
  return (await page.locator('.vela-pill__item[data-active="true"]').textContent()) ?? "";
}

export function pillRoot(page: Page) {
  return page.locator(".vela-pill");
}

export function pillItem(page: Page, name: string) {
  return page.locator(".vela-pill__item", { hasText: name });
}

/**
 * One synthetic wheel event at the given pill point. Playwright's
 * mouse.wheel goes through the browser input pipeline (trusted event,
 * deltaMode=0 pixel deltas) — the same listener path a real device takes.
 * t61: the HORIZONTAL axis pages sections (trackpad-x / Shift+wheel).
 */
export async function wheelAt(
  page: Page,
  x: number,
  y: number,
  deltaX: number,
): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.wheel(deltaX, 0);
}

/**
 * A synthetic trackpad FLICK: ramp-up then geometric decay at ~12ms
 * cadence (the recorded macOS trace shape from the unit tests). t61: the
 * flick is HORIZONTAL — the section pill pages on trackpad-x / Shift+wheel.
 */
export async function wheelFlick(page: Page, x: number, y: number, down: boolean): Promise<void> {
  const magnitudes = [
    5, 12, 25, 40, 55, 60, 50, 42, 34, 27, 21, 16, 12, 9, 7, 5, 4, 3, 2, 1.5, 1,
  ];
  const sign = down ? 1 : -1;
  await page.mouse.move(x, y);
  for (const magnitude of magnitudes) {
    await page.mouse.wheel(sign * magnitude, 0);
    await page.waitForTimeout(12);
  }
}

/** Chained notch-mouse detents: one big spike per 120ms (horizontal). */
export async function wheelDetents(
  page: Page,
  x: number,
  y: number,
  down: boolean,
  count: number,
): Promise<void> {
  const sign = down ? 1 : -1;
  await page.mouse.move(x, y);
  for (let index = 0; index < count; index += 1) {
    await page.mouse.wheel(sign * 100, 0);
    await page.waitForTimeout(120);
  }
}

/** Opens the desktop context menu and clicks 设置… */
export async function openSettings(page: Page): Promise<void> {
  // A point that stays clear of tiles, dock and pill at every viewport
  // this suite uses — INCLUDING under documentElement zoom, where the
  // context menu's clamp math mixes zoom spaces and edges can push out.
  await page.mouse.click(120, 460, { button: "right" });
  await page.getByRole("menuitem", { name: /设置|Settings/ }).first().click();
  await expect(settingsDialog(page)).toBeVisible();
}

/**
 * The settings window surface (portalled into the themed overlay root).
 * Pinned to its marker: a HeroUI Select popover also carries role=dialog
 * while it exits, and the bare role locator strict-violates on the pair.
 */
export function settingsDialog(page: Page) {
  return page.locator("[data-settings-dialog]");
}

/**
 * Closes any open dialog with Escape and waits for it to be gone.
 * Counts only LIVE dialogs (a HeroUI Select popover keeps role=dialog
 * briefly with data-exiting while it animates out).
 */
export async function escapeDialog(page: Page): Promise<void> {
  // Escape first (the idiomatic close); if a nested overlay's exit has
  // focus stranded off-document the key can vanish, so the visible close
  // affordance finishes the job deterministically.
  await page.keyboard.press("Escape");
  // Let any exit animation finish before deciding whether a second,
  // button-driven close is needed (mid-exit nodes are unclickable).
  await page.waitForTimeout(450);
  const remaining = page.locator('[role="dialog"]:not([data-exiting])');
  if (await remaining.isVisible().catch(() => false)) {
    const close = remaining.getByRole("button", { name: /关闭设置|关闭|Close/ }).first();
    if (await close.isVisible().catch(() => false)) {
      await close.click();
    }
  }
  await expect(remaining).toBeHidden({ timeout: 10_000 });
}

/**
 * Drives a designed Slider by its real keyboard interface: focuses the
 * thumb (role=slider) and presses arrows. Returns the resulting
 * aria-valuenow so assertions read the control, never a native input.
 */
export async function nudgeSlider(
  page: Page,
  rootSelector: string,
  presses: number,
  key: "ArrowRight" | "ArrowLeft" = "ArrowRight",
): Promise<number> {
  const thumb = page.locator(rootSelector).getByRole("slider");
  await thumb.click();
  for (let index = 0; index < presses; index += 1) {
    await page.keyboard.press(key);
  }
  const raw = await thumb.getAttribute("aria-valuenow");
  return Number(raw ?? Number.NaN);
}

/** Right-clicks an app tile and activates a context-menu entry. */
export async function appContextMenu(page: Page, appName: string, entry: RegExp): Promise<void> {
  const tile = page.locator(".vela-item", { hasText: appName }).first();
  await expect(tile).toBeVisible();
  // View-mode tiles carry aria-disabled (drag is arrange-only) — force the
  // click past that actionability gate; the context menu is a real view-mode
  // affordance.
  await tile.click({ button: "right", force: true });
  await page.getByRole("menuitem", { name: entry }).first().click();
}

/**
 * Dirties the appearance-inspector draft through a REAL 019-B control:
 * picks a decoration style different from the currently selected one (the
 * manual icon/title size sliders no longer exist — sizes are adaptive,
 * and the inspector has flat sections, not tabs).
 */
export async function dirtyEditorDraft(page: Page): Promise<void> {
  const dialog = page.locator('[role="dialog"][class*="right-0"]');
  const options = dialog.locator(".vela-appearance-inspector__decoration");
  await expect(options.first()).toBeVisible();
  const count = await options.count();
  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index);
    if ((await option.getAttribute("data-selected")) !== "true") {
      await option.click();
      return;
    }
  }
  throw new Error("no unselected decoration style found");
}

/** Fails the test on any browser console error observed from now on. */
export function failOnConsoleError(page: Page): void {
  page.on("console", (message) => {
    if (message.type() === "error") {
      throw new Error(`console error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    throw new Error(`page error: ${error.message}`);
  });
}
