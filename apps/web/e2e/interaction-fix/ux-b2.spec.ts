import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { bootSeededDesktop, deleteSeededWorkspaces } from "./seed";

/**
 * UX-audit P3 fixes (UX-07 … UX-11, task ux-fix-b2): every case replays
 * the audit's reproduction steps as REAL interactions against the
 * production standalone build. Evidence lands in artifacts/ux-b2/.
 */

const EVIDENCE_ROOT = resolve(__dirname, "../../../../artifacts/ux-b2");

function evidenceDir(): string {
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
  return EVIDENCE_ROOT;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: resolve(evidenceDir(), `${name}.png`) });
}

test.afterEach(async ({ request }) => {
  await deleteSeededWorkspaces(request);
});

/** Desktop-only surfaces under test — the mobile shell (≤767px) skips. */
function skipMobileShell(page: Page): void {
  void page;
  test.skip(
    process.env.VD_E2E_VIEWPORT_WIDTH === "390" ||
      process.env.VD_E2E_VIEWPORT_WIDTH === "375",
    "the desktop-only surfaces under test do not exist in the mobile shell",
  );
}

/** Opens Settings through the ⌘K palette (viewport-stable entry). */
async function openSettings(page: Page): Promise<void> {
  await page.locator(".vela-helm-commandbar").click();
  const settingsOption = page
    .getByRole("option", { name: /^设置…$|^Settings…?$/ })
    .or(page.getByRole("option", { name: /设置|Settings/ }));
  await settingsOption.first().click();
  await expect(page.locator("[data-settings-surface]")).toBeVisible();
}

// ---------------------------------------------------------------------------
// UX-07 — Settings is draft + Save: the desktop changes ONLY on Save
// ---------------------------------------------------------------------------

test("UX-07: appearance edits stay drafts until Save; Cancel rolls back", async ({
  page,
  request,
}) => {
  skipMobileShell(page);
  await bootSeededDesktop(page, request);

  const desktop = page.locator(".vela-desktop");
  const portalRoot = page.locator(
    "[data-vd-portal-root]:not([data-aria-hidden])",
  );
  // The RENDERED wallpaper identity is the preset surface the scene paints
  // (the legacy data-vd-wallpaper attr only tracks the legacy preset field).
  const renderedPreset = (id: string) =>
    page.locator(`.vela-desktop__wallpaper [data-wallpaper-preset="${id}"]`);
  await expect(desktop).toHaveAttribute("data-vd-color-mode", "dark");
  await expect(renderedPreset("chart")).toBeVisible();
  const accentBefore = await desktop.evaluate((el) =>
    getComputedStyle(el).getPropertyValue("--vd-accent-hue").trim(),
  );
  expect(accentBefore).not.toBe("");

  await openSettings(page);
  const surface = page.locator("[data-settings-surface]");

  // 1. Color mode → LIGHT: the DESKTOP stays dark; the settings surface
  //    itself (the overlay portal root) previews the draft live.
  await surface.getByRole("radio", { name: /^浅色$|^Light$/ }).click();
  await expect(desktop).toHaveAttribute("data-vd-color-mode", "dark");
  await expect(portalRoot).toHaveAttribute("data-vd-color-mode", "light");
  await shot(page, "ux07-light-draft-in-panel");

  // 2. Accent → 翠绿 (145): the desktop accent var is untouched.
  await surface.getByRole("button", { name: /^翠绿$|^Emerald$/ }).click();
  expect(
    await desktop.evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--vd-accent-hue").trim(),
    ),
  ).toBe(accentBefore);

  // 3. Wallpaper preset → 薄雾: the desktop keeps its saved preset.
  await surface.getByTestId("wallpaper-preset-mist").scrollIntoViewIfNeeded();
  await surface.getByTestId("wallpaper-preset-mist").click();
  await expect(renderedPreset("chart")).toBeVisible();

  // 4. Save applies everything at once.
  await surface.getByRole("button", { name: /^保存$|^Save$/ }).click();
  await expect(page.locator("[data-settings-surface]")).toBeHidden();
  await expect(desktop).toHaveAttribute("data-vd-color-mode", "light");
  await expect(renderedPreset("mist")).toBeVisible();
  await expect
    .poll(() =>
      desktop.evaluate((el) =>
        getComputedStyle(el).getPropertyValue("--vd-accent-hue").trim(),
      ),
    )
    .toBe("145");
  await shot(page, "ux07-saved-light-mist");

  // 5. A second session that ends in CANCEL rolls the draft back: the
  //    desktop keeps the SAVED state, never the abandoned draft.
  await openSettings(page);
  await surface.getByRole("radio", { name: /^深色$|^Dark$/ }).click();
  await surface.getByTestId("wallpaper-preset-dawn").scrollIntoViewIfNeeded();
  await surface.getByTestId("wallpaper-preset-dawn").click();
  await expect(desktop).toHaveAttribute("data-vd-color-mode", "light");
  await surface.getByRole("button", { name: /^取消$|^Cancel$/ }).click();
  await expect(page.locator("[data-settings-surface]")).toBeHidden();
  await expect(desktop).toHaveAttribute("data-vd-color-mode", "light");
  await expect(renderedPreset("mist")).toBeVisible();
  await shot(page, "ux07-cancel-keeps-saved");
});

// ---------------------------------------------------------------------------
// UX-08 — empty-section guidance
// ---------------------------------------------------------------------------

test("UX-08: an empty section shows the dashed guidance tile; adding an app clears it", async ({
  page,
  request,
}) => {
  skipMobileShell(page);
  await bootSeededDesktop(page, request);

  // Create a section through the desktop context menu (empty desktop area).
  await page.mouse.click(1300, 250, { button: "right" });
  await page.getByRole("menuitem", { name: /^新建分区$/ }).click();
  const dialog = page.getByRole("dialog").or(page.locator("[role=alertdialog]").first());
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^创建分区$|^Create section$/ }).click();
  await expect(dialog).toBeHidden();

  // The fresh (empty, now-active) section carries the guidance tile.
  const hint = page.locator(".vela-empty-section");
  await expect(hint).toBeVisible();
  await expect(hint).toContainText(/这个分区还没有应用|no apps yet/i);
  await expect(
    hint.getByRole("button", { name: /^添加应用$|^Add app$/ }),
  ).toBeVisible();
  await shot(page, "ux08-empty-section");

  // The primary action opens the shared Add dialog targeted at THIS section.
  await hint.getByRole("button", { name: /^添加应用$|^Add app$/ }).click();
  const addDialog = page.getByRole("dialog").or(page.locator("[role=alertdialog]").first());
  await expect(addDialog).toBeVisible();
  await addDialog.locator("#vela-add-app-name").fill("首个应用");
  await addDialog.locator("#vela-add-app-url").fill("example.com");
  await addDialog.getByRole("button", { name: /^添加应用$|^Add app$/ }).click();
  await expect(addDialog).toBeHidden();

  // The placeholder is gone and the app tile lives on the section.
  await expect(hint).toBeHidden();
  await expect(page.locator(".vela-item", { hasText: "首个应用" })).toBeVisible();
  await shot(page, "ux08-after-add");
});

// ---------------------------------------------------------------------------
// UX-09 — delete toast + undo
// ---------------------------------------------------------------------------

test("UX-09: deleting shows an undo toast; undo restores in place and persists", async ({
  page,
  request,
}) => {
  skipMobileShell(page);
  await bootSeededDesktop(page, request);

  const tile = page.locator('[data-item-id="app-github"]');
  // Let the boot paint settle so the reference box is the resting layout,
  // not a frame of the entrance choreography (sub-pixel mid-tween boxes).
  await page.waitForTimeout(1200);
  const before = await tile.boundingBox();
  expect(before).not.toBeNull();

  await tile.click({ button: "right", force: true });
  await page.getByRole("menuitem", { name: /^删除$/, exact: true }).click();
  const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog")).first();
  await confirm.getByRole("button", { name: /^删除应用$|^Delete app$/ }).click();
  await expect(confirm).toBeHidden();
  await expect(tile).toBeHidden();

  // The toast names the deleted app and offers undo.
  const toast = page.locator(".vela-onboarding-success");
  await expect(toast).toContainText(/已删除「GitHub」|Deleted “GitHub”/);
  await expect(toast.getByRole("button", { name: /^撤销$|^Undo$/ })).toBeVisible();
  await shot(page, "ux09-delete-toast");

  // Undo: the tile returns to the same spot — size, position and the dock
  // pin (the seed pins GitHub) all restored.
  await toast.getByRole("button", { name: /^撤销$|^Undo$/ }).click();
  await expect(tile).toBeVisible();
  await page.waitForTimeout(600);
  await expect(
    page.locator('.vela-dock__item[data-appearance-app-id="app-github"]'),
  ).toBeVisible();
  const after = await tile.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(after!.width - before!.width)).toBeLessThanOrEqual(2);

  // The undo survived a reload (it staged a real revision).
  await page.reload();
  await expect(page.locator(".vela-desktop")).toBeVisible();
  await expect(page.locator('[data-item-id="app-github"]')).toBeVisible();
  await shot(page, "ux09-undo-restored");
});

test("UX-09: without undo the deletion is real after reload", async ({ page, request }) => {
  skipMobileShell(page);
  await bootSeededDesktop(page, request);

  const tile = page.locator('[data-item-id="app-mdn"]');
  await tile.click({ button: "right", force: true });
  await page.getByRole("menuitem", { name: /^删除$/, exact: true }).click();
  const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog")).first();
  await confirm.getByRole("button", { name: /^删除应用$|^Delete app$/ }).click();
  await expect(page.locator('[data-item-id="app-mdn"]')).toBeHidden();
  // Let the ~6s undo window lapse without pressing undo.
  await page.waitForTimeout(7000);
  await expect(page.locator(".vela-onboarding-success")).toBeHidden();

  await page.reload();
  await expect(page.locator(".vela-desktop")).toBeVisible();
  await expect(page.locator('[data-item-id="app-mdn"]')).toBeHidden();
});

// ---------------------------------------------------------------------------
// UX-10 — light-mode tile boundary (computed contrast ≥ 3:1)
// ---------------------------------------------------------------------------

/** WCAG contrast of two sRGB [r,g,b] triplets (0–255). */
function contrastOf(a: readonly number[], b: readonly number[]): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = (c: readonly number[]) =>
    0.2126 * channel(c[0]!) + 0.7152 * channel(c[1]!) + 0.0722 * channel(c[2]!);
  const values = [lum(a), lum(b)].sort((x, y) => y - x);
  const hi = values[0] ?? 0;
  const lo = values[1] ?? 0;
  return (hi + 0.05) / (lo + 0.05);
}

test("UX-10: light-mode tiles carry a ≥3:1 boundary against the background", async ({
  page,
  request,
}) => {
  test.skip(
    (await page.context().browser()?.browserType().name()) !== "chromium",
    "the pixel-sampled contrast check is the chromium path",
  );
  skipMobileShell(page);
  await bootSeededDesktop(page, request);
  // Switch the live desktop to light mode through Settings + Save (UX-07).
  await openSettings(page);
  await page
    .locator("[data-settings-surface]")
    .getByRole("radio", { name: /^浅色$|^Light$/ })
    .click();
  await page
    .locator("[data-settings-surface]")
    .getByRole("button", { name: /^保存$|^Save$/ })
    .click();
  await expect(page.locator(".vela-desktop")).toHaveAttribute("data-vd-color-mode", "light");

  const tile = page.locator(
    '.vela-grid-host .vela-item[data-kind="app"] .vela-app-icon--surface',
  ).first();
  await expect(tile).toBeVisible();
  const borderTopWidth = await tile.evaluate(
    (el) => getComputedStyle(el).borderTopWidth,
  );
  const boxShadow = await tile.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(borderTopWidth).toBe("1px");
  expect(boxShadow).not.toBe("none");

  // Pixel-truth: sample the painted boundary against the backdrop right
  // outside the tile and the tile ground right inside it.
  const box = (await tile.boundingBox())!;
  const clip = {
    x: Math.round(box.x - 8),
    y: Math.round(box.y + box.height / 2 - 1),
    width: Math.round(box.width + 16),
    height: 2,
  };
  const buffer = await page.screenshot({ clip });
  const samples = await page.evaluate(
    async ({ dataUrl, edgeX }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const px = (x: number, y: number) => {
        const [r = 0, g = 0, b = 0] = ctx.getImageData(x, y, 1, 1).data;
        return [r, g, b];
      };
      return {
        border: px(edgeX, 1),
        outside: px(edgeX - 4, 1),
        inside: px(edgeX + 4, 1),
      };
    },
    {
      dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
      edgeX: 8,
    },
  );

  const boundaryVsBackground = contrastOf(samples.border, samples.outside);
  const boundaryVsTile = contrastOf(samples.border, samples.inside);
  expect(boundaryVsBackground).toBeGreaterThanOrEqual(3);
  expect(boundaryVsTile).toBeGreaterThanOrEqual(3);
  await shot(page, "ux10-light-tile-boundary");
});

// ---------------------------------------------------------------------------
// UX-11 — offline boot states + the prominent offline badge
// ---------------------------------------------------------------------------

test("UX-11: offline boot with local data enters the desktop; badge clears on reconnect", async ({
  page,
  request,
}) => {
  skipMobileShell(page);
  await bootSeededDesktop(page, request);

  // Server unreachable (API aborted — the page itself still loads): the
  // boot has LOCAL data, so it enters the desktop directly.
  await page.route("**/api/v1/**", (route) => route.abort());
  await page.reload();
  await expect(page.locator(".vela-desktop")).toBeVisible({ timeout: 30_000 });
  // No onboarding, no picker — and an explicit offline notice.
  await expect(page.locator(".vela-onboarding")).toBeHidden();
  await expect(page.locator(".vela-picker")).toBeHidden();
  await expect(page.locator(".vela-onboarding-success")).toContainText(
    /当前离线，正在使用本地数据|working from local data/i,
  );
  await shot(page, "ux11-offline-boot-local-data");

  // An edit while offline → the prominent offline badge (readable text,
  // an actionable button), desktop still fully usable.
  const pill = page.locator(".vela-pill__item", { hasText: "前端开发" }).first();
  await pill.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^重命名分区$/ }).click();
  const dialog = page.getByRole("dialog").or(page.locator("[role=alertdialog]").first());
  await expect(dialog).toBeVisible();
  await dialog.locator("#vela-section-name").fill("前端开发离线");
  await dialog.getByRole("button", { name: /^重命名$|^Rename$/ }).click();
  await expect(dialog).toBeHidden();

  const badge = page.locator(".vela-sync-status[data-state='offline']");
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(/离线|Offline/i);
  await expect(badge).toHaveAttribute("title", /.+/);
  await shot(page, "ux11-offline-badge");

  // Back online: the badge's own retry action clears it (a successful
  // sync leaves the workspace clean — nothing renders).
  await page.unroute("**/api/v1/**");
  await badge.click();
  await expect(badge).toBeHidden({ timeout: 20_000 });
});

test("UX-11: offline boot with NO local data shows cannot-connect + retry, not onboarding", async ({
  page,
}) => {
  skipMobileShell(page);
  await page.route("**/api/v1/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator(".vela-screen")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".vela-screen__lead")).toContainText(
    /无法连接服务器|Can't reach the server/i,
  );
  await expect(
    page.locator(".vela-screen__actions button", { hasText: /重新加载|Reload/ }),
  ).toBeVisible();
  // Definitely not the onboarding funnel.
  await expect(page.locator(".vela-onboarding")).toBeHidden();
  await expect(page.locator("#vela-onboarding-name")).toBeHidden();
  await shot(page, "ux11-offline-boot-no-data");
});
