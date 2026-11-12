import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BrowserContext, CDPSession, Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { bootSeededDesktop, deleteSeededWorkspaces } from "./seed";

/**
 * UX-audit batch 3 (task ux-fix-b3): the mobile minimal edit path (UX-12)
 * driven with REAL CDP touch in hasTouch+isMobile contexts at 390×844 and
 * 375×667, plus the large-section scroll performance BASELINE (UX-13) at
 * 1440×900 and 1280×720 — rAF-sampled frame intervals during continuous
 * wheel scrolling of a 44-app section, recorded (never thresholded: the
 * headless environment has no GPU and the numbers exist for comparison
 * only). Evidence lands in artifacts/ux-b3/.
 */

const EVIDENCE_ROOT = resolve(__dirname, "../../../../artifacts/ux-b3");

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

// ---------------------------------------------------------------------------
// Mobile harness: a real phone context (hasTouch + isMobile) + CDP touch
// ---------------------------------------------------------------------------

interface PhoneProfile {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

const PHONES: readonly PhoneProfile[] = [
  { name: "390x844", width: 390, height: 844 },
  { name: "375x667", width: 375, height: 667 },
];

async function openPhoneContext(
  browser: import("@playwright/test").Browser,
  profile: PhoneProfile,
  options: { readonly reducedMotion?: "reduce" } = {},
): Promise<{ context: BrowserContext; page: Page; cdp: CDPSession }> {
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    hasTouch: true,
    isMobile: true,
    reducedMotion: options.reducedMotion ?? "no-preference",
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp };
}

/** A real touch press at viewport coordinates (CDP — synthetic TouchEvents are ignored). */
async function touchStart(cdp: CDPSession, x: number, y: number): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
}

async function touchMove(cdp: CDPSession, x: number, y: number): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x, y }],
  });
}

async function touchEnd(cdp: CDPSession): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** A light tap: press → one frame → release (still a real click). */
async function touchTap(cdp: CDPSession, x: number, y: number): Promise<void> {
  await touchStart(cdp, x, y);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await touchEnd(cdp);
}

/** A qualifying long press: down, 450ms+, up. */
async function longPress(cdp: CDPSession, x: number, y: number): Promise<void> {
  await touchStart(cdp, x, y);
  await new Promise((resolve) => setTimeout(resolve, 550));
  await touchEnd(cdp);
}

/** The ACTIVE pane's tile button for an app name. */
function mobileTile(page: Page, name: string): Locator {
  return page.locator('[data-swipe-slot="0"] .vela-mobile-tile__button', { hasText: name });
}

/** Center of an element in VIEWPORT coordinates (CDP input space). */
async function centerOf(locator: Locator): Promise<{ readonly x: number; readonly y: number }> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error("element has no box");
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Asserts every located control clears the 44×44 touch-target minimum. */
async function expectTouchTargets(controls: readonly Locator[], label: string): Promise<void> {
  for (const control of controls) {
    const box = await control.boundingBox();
    expect(box, `${label}: control must be rendered`).not.toBeNull();
    expect(box!.width, `${label}: width ≥44 (got ${box!.width})`).toBeGreaterThanOrEqual(43.5);
    expect(box!.height, `${label}: height ≥44 (got ${box!.height})`).toBeGreaterThanOrEqual(43.5);
  }
}

// ---------------------------------------------------------------------------
// UX-12 — the minimal mobile edit path, per phone profile
// ---------------------------------------------------------------------------

for (const phone of PHONES) {
  test.describe(`UX-12 mobile edit @${phone.name}`, () => {
    test("tap opens the link; long-press opens the menu; movement cancels it into swipe/scroll", async ({
      browser,
      request,
    }) => {
      const { context, page, cdp } = await openPhoneContext(browser, phone);
      try {
        // The stress section rides along so the vertical-scroll part of the
        // test has a genuinely scrollable pane.
        await bootSeededDesktop(page, request, { allowMobileShell: true, stressSection: true });
        await expect(page.locator(".vela-mobile-shell")).toBeVisible();

        // 1. A quick tap still launches the app in a new tab.
        const vue = await centerOf(mobileTile(page, "Vue"));
        const popup = page.waitForEvent("popup", { timeout: 10_000 });
        await touchTap(cdp, vue.x, vue.y);
        const opened = await popup;
        expect(opened.url()).toContain("vuejs.org");
        await opened.close();

        // 2. A qualifying hold (450ms, ≤8px travel) opens the action menu.
        const github = mobileTile(page, "GitHub");
        await expect(github).toBeVisible();
        const center = await centerOf(github);
        await longPress(cdp, center.x, center.y);
        const menu = page.getByRole("menu");
        await expect(menu).toBeVisible();
        for (const item of [/编辑/, /移到分区/, /删除/]) {
          await expect(menu.getByRole("menuitem", { name: item })).toBeVisible();
        }
        // Touch targets of the menu rows clear 44px.
        await expectTouchTargets(
          [menu.getByRole("menuitem", { name: /编辑/ }), menu.getByRole("menuitem", { name: /移到分区/ }), menu.getByRole("menuitem", { name: /删除/ })],
          "tile menu rows",
        );
        await shot(page, `ux12-${phone.name}-tile-menu`);

        // Esc closes the menu (the spec's keyboard close path).
        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();

        // 3. Hold, then move >8px BEFORE the threshold → no menu; the same
        //    horizontal travel drives the SECTION SWIPE (the shell's
        //    existing gesture stays intact).
        const activeTab = page.locator('.vela-mobile-tabs__tab[aria-selected="true"]');
        await expect(activeTab).toHaveText(/前端开发/);
        await touchStart(cdp, center.x, center.y);
        await new Promise((resolve) => setTimeout(resolve, 120));
        // Slide left past the slop, in small steps like a finger.
        for (let step = 1; step <= 12; step += 1) {
          await touchMove(cdp, center.x - step * 26, center.y + 1);
          await new Promise((resolve) => setTimeout(resolve, 16));
        }
        await new Promise((resolve) => setTimeout(resolve, 550));
        await touchEnd(cdp);
        await expect(menu).toBeHidden();
        await expect
          .poll(() => activeTab.textContent(), { timeout: 5000 })
          .toMatch(/AI 工具|设计灵感/);
        // The swipe also suppressed the tap-under-the-finger launch.
        await shot(page, `ux12-${phone.name}-swipe-after-cancel`);

        // 4. Hold, then move VERTICALLY >8px → no menu (verified on the
        //    44-app stress pane, which genuinely overflows the viewport).
        //    A raw CDP touch-drag does not drive this headless build's
        //    native scroll, so the scroll itself is then driven by the
        //    REAL touch scroll gesture (Input.synthesizeScrollGesture).
        await page.locator(".vela-mobile-tabs__tab", { hasText: "压测分区" }).click();
        await expect(
          page.locator('.vela-mobile-tabs__tab[aria-selected="true"]'),
        ).toHaveText(/压测分区/);
        const content = page.locator(".vela-mobile-shell__content");
        await expect
          .poll(() => content.evaluate((el) => el.scrollHeight - el.clientHeight))
          .toBeGreaterThan(50);
        const stressTile = await centerOf(
          page
            .locator('[data-swipe-slot="0"] .vela-mobile-tile__button')
            .filter({ has: page.locator(".vela-mobile-tile__label", { hasText: /^压测8$/ }) }),
        );
        await touchStart(cdp, stressTile.x, stressTile.y);
        await new Promise((resolve) => setTimeout(resolve, 120));
        for (let step = 1; step <= 10; step += 1) {
          await touchMove(cdp, stressTile.x, stressTile.y + step * 18);
          await new Promise((resolve) => setTimeout(resolve, 16));
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
        await touchEnd(cdp);
        await expect(menu).toBeHidden();

        // The native vertical touch scroll still owns the pane.
        await cdp.send("Input.synthesizeScrollGesture", {
          x: stressTile.x,
          y: stressTile.y,
          xDistance: 0,
          yDistance: -260,
          speed: 2000,
        });
        await expect
          .poll(() => content.evaluate((el) => el.scrollTop), { timeout: 5000 })
          .toBeGreaterThan(20);
        await shot(page, `ux12-${phone.name}-vertical-scroll`);
      } finally {
        await context.close();
      }
    });

    test("edit: rename persists across reload; an invalid URL is refused inline", async ({
      browser,
      request,
    }) => {
      const { context, page, cdp } = await openPhoneContext(browser, phone);
      try {
        await bootSeededDesktop(page, request, { allowMobileShell: true });
        const tile = mobileTile(page, "MDN");
        const center = await centerOf(tile);
        await longPress(cdp, center.x, center.y);
        await page.getByRole("menuitem", { name: /编辑/ }).click();

        // The shared edit dialog fits the phone (no破版): inside the
        // viewport, footer buttons visible.
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        const box = await dialog.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(phone.width + 0.5);
        expect(box!.y + box!.height).toBeLessThanOrEqual(phone.height + 0.5);
        // The focused-input contract: the form body scrolls (a soft
        // keyboard shrinking dvh never hides fields or the footer).
        await dialog.locator("#vela-edit-app-name").focus();
        const bodyOverflow = await dialog
          .locator("form > div.min-h-0")
          .evaluate((el) => getComputedStyle(el).overflowY);
        expect(bodyOverflow).toBe("auto");
        // The footer buttons stay inside the viewport.
        const footer = await dialog
          .getByRole("button", { name: /^保存更改$/ })
          .boundingBox();
        expect(footer!.y + footer!.height).toBeLessThanOrEqual(phone.height + 0.5);
        await shot(page, `ux12-${phone.name}-edit-dialog`);

        // Invalid URL (the b1 UX-04 gate): refused inline, dialog stays.
        await dialog.locator("#vela-edit-app-url").fill("不是网址");
        await dialog.getByRole("button", { name: /保存更改/ }).click();
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText(/请输入有效|网址/).first()).toBeVisible();

        // A valid rename lands and survives the reload.
        await dialog.locator("#vela-edit-app-url").fill("developer.mozilla.org");
        await dialog.locator("#vela-edit-app-name").fill("MDN 文档");
        await dialog.getByRole("button", { name: /保存更改/ }).click();
        await expect(dialog).toBeHidden();
        await expect(mobileTile(page, "MDN 文档")).toBeVisible();

        await page.reload();
        await expect(page.locator(".vela-mobile-shell")).toBeVisible();
        await expect(mobileTile(page, "MDN 文档")).toBeVisible();
      } finally {
        await context.close();
      }
    });

    test("move to section relocates the tile; delete → undo restores it in place", async ({
      browser,
      request,
    }) => {
      const { context, page, cdp } = await openPhoneContext(browser, phone);
      try {
        await bootSeededDesktop(page, request, { allowMobileShell: true });

        // Move Vite to 设计灵感 through the shared picker.
        const vite = mobileTile(page, "Vite");
        const center = await centerOf(vite);
        await longPress(cdp, center.x, center.y);
        await page.getByRole("menuitem", { name: /移到分区/ }).click();
        const picker = page.getByRole("dialog");
        await expect(picker).toBeVisible();
        await picker.getByRole("option", { name: /^设计灵感$/ }).click();
        await expect(picker).toBeHidden();
        await expect(vite).toBeHidden();

        // It now lives in the target section.
        await page.locator(".vela-mobile-tabs__tab", { hasText: "设计灵感" }).click();
        await expect(page.locator('[data-swipe-slot="0"] .vela-mobile-tile__button', { hasText: "Vite" })).toBeVisible();
        await shot(page, `ux12-${phone.name}-moved-tile`);

        // Back to 前端开发: delete React → toast → undo → restored.
        await page.locator(".vela-mobile-tabs__tab", { hasText: "前端开发" }).click();
        // Let the tab-content entrance settle so the reference box is the
        // resting layout (the same contract as the desktop UX-09 spec).
        await page.waitForTimeout(700);
        const react = mobileTile(page, "React");
        const before = await react.boundingBox();
        expect(before).not.toBeNull();
        const reactCenter = await centerOf(react);
        await longPress(cdp, reactCenter.x, reactCenter.y);
        await page.getByRole("menuitem", { name: /^删除$/, exact: true }).click();
        const confirm = page.getByRole("alertdialog");
        await confirm.getByRole("button", { name: /删除应用/ }).click();
        await expect(confirm).toBeHidden();
        await expect(react).toBeHidden();

        const toast = page.locator(".vela-onboarding-success");
        await expect(toast).toContainText(/已删除「React」|Deleted “React”/);
        await shot(page, `ux12-${phone.name}-delete-toast`);
        await toast.getByRole("button", { name: /^撤销$|^Undo$/ }).click();
        await expect(react).toBeVisible();
        const after = await react.boundingBox();
        expect(after).not.toBeNull();
        expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(2);
      } finally {
        await context.close();
      }
    });

    test("drawer: add an app to the current section; manage sections (create/rename/reorder/delete)", async ({
      browser,
      request,
    }) => {
      const { context, page, cdp } = await openPhoneContext(browser, phone);
      try {
        await bootSeededDesktop(page, request, { allowMobileShell: true });

        // --- 添加应用 through the drawer, targeted at the ACTIVE section.
        await page.getByRole("button", { name: /^菜单$/ }).click();
        const menuSheet = page.locator(".vela-mobile-sheet__surface--menu");
        await expect(menuSheet).toBeVisible();
        await expectTouchTargets(
          [
            menuSheet.getByRole("button", { name: /^添加应用$/ }),
            menuSheet.getByRole("button", { name: /^管理分区$/ }),
          ],
          "drawer edit entries",
        );
        await menuSheet.getByRole("button", { name: /^添加应用$/ }).click();
        const addDialog = page.getByRole("dialog");
        await expect(addDialog).toBeVisible();
        await addDialog.locator("#vela-add-app-name").fill("手机新增");
        await addDialog.locator("#vela-add-app-url").fill("m.example.com");
        await addDialog.getByRole("button", { name: /^添加应用$/ }).click();
        await expect(addDialog).toBeHidden();
        await expect(mobileTile(page, "手机新增")).toBeVisible();
        await shot(page, `ux12-${phone.name}-drawer-add`);

        // --- 管理分区: the phone-shaped list reusing the desktop edits.
        await page.getByRole("button", { name: /^菜单$/ }).click();
        await menuSheet.getByRole("button", { name: /^管理分区$/ }).click();
        const manage = page.locator(".vela-mobile-sheet__surface--folder");
        await expect(manage).toBeVisible();
        await expect(manage.getByText("管理分区")).toBeVisible();
        await shot(page, `ux12-${phone.name}-manage-sections`);

        // Every row's icon tools clear 44px.
        const firstRow = manage.locator(".vela-mobile-manage__row").first();
        await expectTouchTargets(
          [
            firstRow.getByRole("button", { name: /上移/ }),
            firstRow.getByRole("button", { name: /下移/ }),
            firstRow.getByRole("button", { name: /重命名分区/ }),
            firstRow.getByRole("button", { name: /删除分区/ }),
          ],
          "manage row tools",
        );

        // Reorder: AI 工具 moves ABOVE 前端开发 (the sheet stays open).
        const rowNames = () =>
          manage.locator(".vela-mobile-manage__name").allTextContents();
        const before = await rowNames();
        const aiRow = manage.locator(".vela-mobile-manage__row", { hasText: "AI 工具" });
        await aiRow.getByRole("button", { name: /上移/ }).click();
        await expect.poll(rowNames).not.toEqual(before);
        expect((await rowNames())[0]).toBe("AI 工具");
        // The tab strip follows the new order.
        await expect(
          page.locator(".vela-mobile-tabs__tab").first(),
        ).toHaveText(/AI 工具/);

        // Rename: the shared SectionDialog.
        const designRow = manage.locator(".vela-mobile-manage__row", { hasText: "设计灵感" });
        await designRow.getByRole("button", { name: /重命名分区/ }).click();
        const renameDialog = page.getByRole("dialog");
        await renameDialog.locator("#vela-section-name").fill("灵感库");
        await renameDialog.getByRole("button", { name: /^重命名$/ }).click();
        await expect(renameDialog).toBeHidden();
        await expect(
          page.locator(".vela-mobile-tabs__tab", { hasText: "灵感库" }),
        ).toBeVisible();

        // Create: a fresh section becomes ACTIVE and shows the empty-state
        // 添加应用 button (the UX-12 empty-section entry).
        await page.getByRole("button", { name: /^菜单$/ }).click();
        await menuSheet.getByRole("button", { name: /^管理分区$/ }).click();
        await manage.getByRole("button", { name: /^新建分区$/ }).click();
        const createDialog = page.getByRole("dialog");
        await createDialog.locator("#vela-section-name").fill("新手机分区");
        await createDialog.getByRole("button", { name: /^创建分区$/ }).click();
        await expect(createDialog).toBeHidden();
        await expect(
          page.locator('.vela-mobile-tabs__tab[aria-selected="true"]'),
        ).toHaveText(/新手机分区/);
        const emptyAdd = page.getByRole("button", { name: /^添加应用$/ });
        await expect(emptyAdd).toBeVisible();
        await expectTouchTargets([emptyAdd], "empty-section add");
        // A REAL touch tap (Playwright's actionability click would first run
        // scrollIntoViewIfNeeded, which can nudge the content scroller's
        // hidden horizontal overflow — a driver artifact, never user input).
        const emptyAddCenter = await centerOf(emptyAdd);
        await touchTap(cdp, emptyAddCenter.x, emptyAddCenter.y);
        const addDialog2 = page.getByRole("dialog");
        await addDialog2.locator("#vela-add-app-name").fill("空区首应用");
        await addDialog2.locator("#vela-add-app-url").fill("first.example.com");
        await addDialog2.getByRole("button", { name: /^添加应用$/ }).click();
        await expect(mobileTile(page, "空区首应用")).toBeVisible();
        await shot(page, `ux12-${phone.name}-empty-section-add`);

        // Delete: the domain refuses deleting a NON-EMPTY section — remove
        // the fresh section's one app through its tile menu first, then the
        // section delete goes through.
        const tile = mobileTile(page, "空区首应用");
        const center = await centerOf(tile);
        await longPress(cdp, center.x, center.y);
        await page.getByRole("menuitem", { name: /^删除$/, exact: true }).click();
        const confirmDel = page.getByRole("alertdialog");
        await expect(confirmDel).toBeVisible();
        await confirmDel.getByRole("button", { name: /删除应用/ }).click();
        await expect(tile).toBeHidden();

        await page.getByRole("button", { name: /^菜单$/ }).click();
        await menuSheet.getByRole("button", { name: /^管理分区$/ }).click();
        const freshRow = manage.locator(".vela-mobile-manage__row", { hasText: "新手机分区" });
        await freshRow.getByRole("button", { name: /删除分区/ }).click();
        await page.getByRole("alertdialog").getByRole("button", { name: /^删除分区$/ }).click();
        await expect(
          page.locator(".vela-mobile-tabs__tab", { hasText: "新手机分区" }),
        ).toBeHidden({ timeout: 10_000 });
        // The active section fell back to a surviving neighbor.
        await expect(
          page.locator('.vela-mobile-tabs__tab[aria-selected="true"]'),
        ).toHaveText(/AI 工具|前端开发|灵感库/);
      } finally {
        await context.close();
      }
    });

    test("reduced motion: no hold scale, the menu still opens", async ({
      browser,
      request,
    }) => {
      const { context, page, cdp } = await openPhoneContext(browser, phone, {
        reducedMotion: "reduce",
      });
      try {
        await bootSeededDesktop(page, request, { allowMobileShell: true });
        const tile = mobileTile(page, "GitHub");
        const center = await centerOf(tile);

        // Mid-hold: the tile does NOT scale under reduced motion.
        await touchStart(cdp, center.x, center.y);
        await new Promise((resolve) => setTimeout(resolve, 250));
        const transform = await tile.evaluate((el) => getComputedStyle(el).transform);
        await new Promise((resolve) => setTimeout(resolve, 350));
        await touchEnd(cdp);
        const menu = page.getByRole("menu");
        await expect(menu).toBeVisible();
        expect(transform === "none" || transform === "").toBeTruthy();
        // Scrim tap is the second close path (spec).
        await page.mouse.click(10, 10);
        await expect(menu).toBeHidden();
      } finally {
        await context.close();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// UX-13 — the 44-app section scroll performance baseline (1440×900, 1280×720)
// ---------------------------------------------------------------------------

interface ScrollFrameStats {
  readonly frameCount: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly longTasks: number;
  readonly sampledMs: number;
  readonly scrollHeight: number;
  readonly viewportHeight: number;
}

/**
 * Samples rAF frame intervals + long tasks for `durationMs` of IN-PAGE time
 * while the caller scrolls. Returned once the window closes.
 */
function startFrameSampler(
  scroller: Locator,
  durationMs: number,
): Promise<ScrollFrameStats> {
  return scroller.evaluate(
    (el, duration) =>
      new Promise<ScrollFrameStats>((resolve) => {
        const intervals: number[] = [];
        let longTasks = 0;
        let observer: PerformanceObserver | null = null;
        try {
          observer = new PerformanceObserver((list) => {
            longTasks += list.getEntries().length;
          });
          observer.observe({ entryTypes: ["longtask"] });
        } catch {
          observer = null; // longtask support is best-effort
        }
        let last = performance.now();
        const startedAt = last;
        const tick = (now: number): void => {
          intervals.push(now - last);
          last = now;
          if (now - startedAt < duration) {
            window.requestAnimationFrame(tick);
            return;
          }
          observer?.disconnect();
          intervals.sort((a, b) => a - b);
          const pick = (quantile: number): number =>
            intervals.length === 0
              ? 0
              : intervals[Math.min(intervals.length - 1, Math.floor(quantile * intervals.length))]!;
          resolve({
            frameCount: intervals.length,
            p50Ms: Math.round(pick(0.5) * 10) / 10,
            p95Ms: Math.round(pick(0.95) * 10) / 10,
            maxMs: Math.round((intervals[intervals.length - 1] ?? 0) * 10) / 10,
            longTasks,
            sampledMs: Math.round(performance.now() - startedAt),
            scrollHeight: el.scrollHeight,
            viewportHeight: el.clientHeight,
          });
        };
        window.requestAnimationFrame(tick);
      }),
    durationMs,
  );
}

for (const size of [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1280x720", width: 1280, height: 720 },
]) {
  test(`UX-13 baseline: continuous wheel scroll through the 44-app section @${size.name}`, async ({
    browser,
    request,
  }) => {
    test.skip(
      (await browser.browserType().name()) !== "chromium",
      "the baseline is the chromium headless path",
    );
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
    });
    const page = await context.newPage();
    try {
      await bootSeededDesktop(page, request, { stressSection: true });
      // Land on the stress section.
      await page.locator(".vela-pill__item", { hasText: "压测分区" }).first().click();
      await expect(
        page.locator('.vela-pill__item[data-active="true"]', { hasText: "压测分区" }),
      ).toBeVisible();
      await page.waitForTimeout(900); // let the section settle

      // Scoped to the ACTIVE layer: warm neighbour layers mount their own
      // scrollers with the same class.
      const scroller = page.locator(
        '.vela-section-layer[data-active-section="true"] .vela-section-scroller',
      );
      const scrollable = await scroller.evaluate((el) => el.scrollHeight > el.clientHeight + 2);
      expect(scrollable, "44 apps must overflow the viewport").toBeTruthy();

      // Sample while scrolling CONTINUOUSLY with the real wheel: down to the
      // bottom, back up, down again — the damped (Lenis) glide runs between
      // gestures, so the window covers both the impulse and the settle.
      const box = await scroller.boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      const SAMPLE_MS = 7000;
      const stats = startFrameSampler(scroller, SAMPLE_MS);
      const deadline = Date.now() + SAMPLE_MS - 300;
      let direction = 1;
      while (Date.now() < deadline) {
        await page.mouse.wheel(0, direction * 420);
        await page.waitForTimeout(140);
        const atEdge = await scroller.evaluate(
          (el, dir) =>
            dir > 0
              ? el.scrollTop + el.clientHeight >= el.scrollHeight - 4
              : el.scrollTop <= 4,
          direction,
        );
        if (atEdge) {
          direction = -direction;
        }
      }
      const result = await stats;

      // Baseline only — no thresholds. Persist for the report/JSON.
      const record = {
        viewport: size.name,
        section: "压测分区 (44 apps)",
        ...result,
        capturedAt: new Date().toISOString(),
        note: "headless Chromium without GPU — comparison baseline only, no thresholds",
      };
      const jsonPath = resolve(evidenceDir(), "perf-baseline.json");
      let records: unknown[] = [];
      try {
        const parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
        records = Array.isArray(parsed) ? parsed : [];
      } catch {
        records = [];
      }
      const filtered = records.filter(
        (entry): entry is Record<string, unknown> =>
          entry instanceof Object && (entry as Record<string, unknown>).viewport !== size.name,
      );
      filtered.push(record);
      writeFileSync(jsonPath, `${JSON.stringify(filtered, null, 2)}\n`);
      // Visible in the test log for the report.
      console.log(`UX-13 ${size.name}:`, JSON.stringify(result));
      await shot(page, `ux13-${size.name}-stress-section`);
    } finally {
      await context.close();
    }
  });
}
