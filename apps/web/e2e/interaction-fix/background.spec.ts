import { writeFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

import { bootSeededDesktop, deleteSeededWorkspaces } from "./seed";
import { ensureArtifactRoot } from "./helpers";

/**
 * t61 issue 4: built-in backgrounds must actually PAINT. For every preset:
 * picking it in Settings stages a DRAFT (UX-07: the desktop keeps the
 * saved wallpaper while the dialog is open), Save paints it and persists
 * (survives a reload), Cancel discards it. The scope dropdown (workspace
 * default vs a section) is exercised for one preset.
 */
test.afterEach(async ({ request }) => {
  await deleteSeededWorkspaces(request);
});

const PRESETS = ["chart", "aurora", "midnight", "dawn", "mist"] as const;

/** The visible wallpaper surface's painted background, hashed for compare. */
function wallpaperState(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>(".vela-wallpaper-surface");
    if (surface === null) {
      return null;
    }
    const cs = getComputedStyle(surface);
    return {
      preset: surface.getAttribute("data-wallpaper-preset"),
      fit: surface.getAttribute("data-wallpaper-fit"),
      backgroundImage: cs.backgroundImage,
      backgroundColor: cs.backgroundColor,
    };
  });
}

/** Opens Settings → 外观 (the background editor tab). */
async function openAppearanceSettings(page: import("@playwright/test").Page) {
  await page.locator(".vela-helm-commandbar").click();
  const settings = page.getByRole("option", { name: "设置" });
  await settings.first().waitFor({ timeout: 5_000 });
  await settings.first().click();
  const surface = page.locator("[data-settings-surface]");
  await expect(surface).toBeVisible();
  return surface;
}

test.describe("backgrounds (t61)", () => {
  test.beforeEach(async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await bootSeededDesktop(page, request);
  });

  for (const preset of PRESETS) {
    test(`preset ${preset}: draft until Save, then persists over reload`, async ({ page }) => {
      await openAppearanceSettings(page);
      const card = page.locator(`[data-testid="wallpaper-preset-${preset}"]`);
      await expect(card).toBeVisible();
      await card.click();

      // Draft-only (UX-07): while the dialog is open the desktop keeps the
      // SAVED wallpaper — nothing changes before Save.
      await expect
        .poll(async () => (await wallpaperState(page))?.preset, { timeout: 2_000 })
        .toBe("chart");

      // Save: the preset paints and survives a reload.
      await page.getByRole("button", { name: "保存" }).click();
      await expect(page.locator("[data-settings-surface]")).toBeHidden({ timeout: 10_000 });
      await expect
        .poll(async () => (await wallpaperState(page))?.preset, { timeout: 5_000 })
        .toBe(preset);
      await page.reload();
      await expect(page.locator(".vela-desktop")).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(async () => (await wallpaperState(page))?.preset, { timeout: 10_000 })
        .toBe(preset);
      const persisted = await wallpaperState(page);
      expect(persisted!.backgroundImage.length).toBeGreaterThan(10);
    });
  }

  test("every preset paints a visibly different background (pairwise distinct)", async ({
    page,
  }) => {
    const seen = new Map<string, string>();
    for (const preset of PRESETS) {
      await openAppearanceSettings(page);
      await page.locator(`[data-testid="wallpaper-preset-${preset}"]`).click();
      await page.getByRole("button", { name: "保存" }).click();
      await expect(page.locator("[data-settings-surface]")).toBeHidden({ timeout: 10_000 });
      await expect
        .poll(async () => (await wallpaperState(page))?.preset, { timeout: 5_000 })
        .toBe(preset);
      const painted = await wallpaperState(page);
      seen.set(preset, painted!.backgroundImage);
    }
    const values = [...seen.values()];
    expect(new Set(values).size).toBe(PRESETS.length);
    writeFileSync(
      `${ensureArtifactRoot()}/background-presets.json`,
      JSON.stringify(Object.fromEntries(seen), null, 2),
    );
  });

  test("cancel restores the previous background (nothing persisted)", async ({ page }) => {
    // Baseline: the fixture's default chart scene.
    expect((await wallpaperState(page))?.preset).toBe("chart");

    await openAppearanceSettings(page);
    await page.locator('[data-testid="wallpaper-preset-midnight"]').click();
    // Draft-only (UX-07): the draft never reaches the desktop before Save,
    // so Cancel has nothing to roll back — the saved scene simply stays.
    await expect
      .poll(async () => (await wallpaperState(page))?.preset, { timeout: 2_000 })
      .toBe("chart");

    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.locator("[data-settings-surface]")).toBeHidden({ timeout: 10_000 });
    await expect
      .poll(async () => (await wallpaperState(page))?.preset, { timeout: 5_000 })
      .toBe("chart");
    await page.reload();
    await expect
      .poll(async () => (await wallpaperState(page))?.preset, { timeout: 10_000 })
      .toBe("chart");
  });

  test("per-section scope: a section keeps its own background after reload", async ({ page }) => {
    await openAppearanceSettings(page);
    // Scope: the section (AI 工具), not the workspace default.
    const scopeTrigger = page.locator("[data-settings-surface] button").filter({ hasText: "工作区默认" }).first();
    await scopeTrigger.click();
    await page.getByRole("option", { name: "AI 工具" }).click();
    await page.locator('[data-testid="wallpaper-preset-mist"]').click();

    // The edited section is NOT on screen — by design the desktop previews
    // only the ACTIVE section (the editor thumbnail carries the choice).
    // Save the override, then verify per-section persistence on the DESKTOP:
    // switching to AI 工具 paints mist; the first section keeps the
    // workspace default (chart).
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.locator("[data-settings-surface]")).toBeHidden({ timeout: 10_000 });

    await page.locator(".vela-pill__item", { hasText: "AI 工具" }).first().click();
    await expect
      .poll(async () => (await wallpaperState(page))?.preset, { timeout: 8_000 })
      .toBe("mist");

    await page.reload();
    // The app remembers its last section; mist must survive the reload.
    await expect
      .poll(async () => (await wallpaperState(page))?.preset, { timeout: 10_000 })
      .toBe("mist");

    await page.locator(".vela-pill__item", { hasText: "前端开发" }).first().click();
    await expect
      .poll(async () => (await wallpaperState(page))?.preset, { timeout: 8_000 })
      .toBe("chart");
  });
});
