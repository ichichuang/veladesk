import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { enterArrangeMode } from "./helpers";
import { bootSeededDesktop, deleteSeededWorkspaces } from "./seed";

/**
 * Chris t77: (1) Grid resize handles work — per-cell snap (过半格即进位),
 * the preview frame tracks the pointer within half a pitch on every
 * sampled frame, the live badge names the committed span, every handle
 * direction resizes (the old size-step quantization made pure
 * vertical/horizontal growth impossible), release = preview, undo
 * restores; freeform stays continuous. (2) Wheel scrolling glides with
 * damping — multi-frame ramp, damped stop ≤ 600ms. (3) Hovering the
 * section pill, the vertical wheel pages exactly one section per gesture
 * (50px threshold, 350ms cooldown) and never scrolls the page.
 *
 * Evidence lands in artifacts/t77/ (mid-drag screenshots + frame JSON).
 */

const evidence = resolve(__dirname, "../../../../artifacts/t77");
mkdirSync(evidence, { recursive: true });

test.afterEach(async ({ request }) => {
  await deleteSeededWorkspaces(request);
});

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface ResizeFrame {
  readonly pointer: { readonly x: number; readonly y: number };
  readonly box: Box | null;
  readonly badge: string | null;
}

interface TileMetrics {
  readonly cellPx: number;
  readonly gapPx: number;
  readonly pitch: number;
}

async function gridPitchOf(page: Page): Promise<TileMetrics> {
  return page.evaluate(() => {
    const stage = document.querySelector(".vela-grid-stage");
    if (stage === null) throw new Error("no grid stage");
    const cellPx = parseFloat(getComputedStyle(stage).getPropertyValue("--vd-grid-cell-size"));
    const gapPx = parseFloat(getComputedStyle(stage).getPropertyValue("--vd-grid-gap"));
    return { cellPx, gapPx, pitch: cellPx + gapPx };
  });
}

/** The tile's rendered visual box (.vela-item__body — what the user sees). */
async function previewBoxOf(page: Page, tileId: string): Promise<Box | null> {
  return page.evaluate((id) => {
    const body = document.querySelector(
      `[data-item-id="${CSS.escape(id)}"] .vela-item__body`,
    );
    if (body === null) return null;
    return body.getBoundingClientRect().toJSON();
  }, tileId);
}

async function dragHandle(
  page: Page,
  tileId: string,
  handle: string,
  dx: number,
  dy: number,
  steps: number,
  label: string,
): Promise<ResizeFrame[]> {
  const grip = page.locator(
    `[data-item-id="${tileId}"] .vela-item__resize-handle[data-handle="${handle}"]`,
  );
  const gripBox = (await grip.boundingBox())!;
  const startX = gripBox.x + gripBox.width / 2;
  const startY = gripBox.y + gripBox.height / 2;
  const frames: ResizeFrame[] = [];
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let index = 1; index <= steps; index += 1) {
    const px = startX + (dx * index) / steps;
    const py = startY + (dy * index) / steps;
    await page.mouse.move(px, py);
    frames.push({
      pointer: { x: px, y: py },
      box: await previewBoxOf(page, tileId),
      badge: await page.evaluate(() => {
        const badge = document.querySelector("[data-resize-badge]");
        return badge === null ? null : badge.getAttribute("data-resize-badge");
      }),
    });
  }
  await page.screenshot({ path: resolve(evidence, `resize-mid-${label}-${handle}.png`) });
  await page.mouse.up();
  await page.waitForTimeout(650);
  return frames;
}

function expectFrameTracksPointer(
  frames: ResizeFrame[],
  anchor: { x: number; y: number },
  pitch: number,
): void {
  // 过半格即进位: the preview edge follows the pointer within half a
  // pitch (+1px rounding slack) on every sampled frame. The handle
  // center sits ON the moving edge, so the raw pointer IS the edge
  // target.
  const limit = pitch / 2 + 1;
  for (const frame of frames) {
    expect(frame.box).not.toBeNull();
    const box = frame.box!;
    const right = anchor.x + box.width;
    const bottom = anchor.y + box.height;
    expect(Math.abs(right - frame.pointer.x), "preview right vs pointer").toBeLessThan(limit);
    expect(Math.abs(bottom - frame.pointer.y), "preview bottom vs pointer").toBeLessThan(limit);
  }
}

const RESIZE_VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
];

for (const viewport of RESIZE_VIEWPORTS) {
  test.describe(`t77 grid resize @ ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("SE handle: 1×1 → 2×2 → 3×2 → 1×1, per-frame tracking, badge, undo", async ({
      page,
      request,
    }) => {
      await bootSeededDesktop(page, request, { t77Scene: true });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.reload();
      await expect(page.locator(".vela-desktop")).toBeVisible({ timeout: 30_000 });
      await enterArrangeMode(page);
      const tileId = "app-mdn";
      const tile = page.locator(`[data-item-id="${tileId}"]`).first();
      await tile.click();
      await expect(page.locator(".vela-item__resize-handle")).toHaveCount(8);
      const { pitch, cellPx, gapPx } = await gridPitchOf(page);
      expect(pitch).toBeGreaterThan(80);

      const startBox = (await previewBoxOf(page, tileId))!;

      // 1×1 → 2×2 (+1.2 cells each way, 20+ sampled frames).
      const framesA = await dragHandle(page, tileId, "se", pitch * 1.2, pitch * 1.2, 22, `se-grow-${viewport.name}`);
      expectFrameTracksPointer(framesA, { x: startBox.x, y: startBox.y }, pitch);
      // Mid-drag badge names the live target size.
      const badgesA = framesA.map((frame) => frame.badge).filter((badge) => badge !== null);
      expect(badgesA).toContain("2×2");

      const twoBox = (await previewBoxOf(page, tileId))!;
      expect(twoBox.width).toBeCloseTo(2 * cellPx + gapPx, 0);
      expect(twoBox.height).toBeCloseTo(2 * cellPx + gapPx, 0);

      // 2×2 → 3×2 (wider, not taller: pure-width reachability).
      const framesB = await dragHandle(page, tileId, "se", pitch * 1.2, 0, 22, `se-widen-${viewport.name}`);
      expectFrameTracksPointer(framesB, { x: twoBox.x, y: twoBox.y }, pitch);
      expect(framesB.at(-1)!.badge).toBe("3×2");
      const threeBox = (await previewBoxOf(page, tileId))!;
      expect(threeBox.width).toBeCloseTo(3 * cellPx + 2 * gapPx, 0);
      expect(threeBox.height).toBeCloseTo(2 * cellPx + gapPx, 0);
      await page.screenshot({ path: resolve(evidence, `resize-committed-3x2-${viewport.name}.png`) });

      // 3×2 → 1×1: drag the SE handle back inside the tile.
      const framesC = await dragHandle(page, tileId, "se", -(2 * pitch * 0.92), -pitch * 0.92, 24, `se-shrink-${viewport.name}`);
      expectFrameTracksPointer(framesC, { x: threeBox.x, y: threeBox.y }, pitch);
      const backBox = (await previewBoxOf(page, tileId))!;
      expect(backBox.width).toBeCloseTo(cellPx, 0);
      expect(backBox.height).toBeCloseTo(cellPx, 0);

      // Undo steps back through the session: shrink → 3×2 → 2×2 → 1×1.
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(650);
      const undoneA = (await previewBoxOf(page, tileId))!;
      expect(undoneA.width).toBeCloseTo(threeBox.width, 0);
      expect(undoneA.height).toBeCloseTo(threeBox.height, 0);
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(650);
      const undoneB = (await previewBoxOf(page, tileId))!;
      expect(undoneB.width).toBeCloseTo(twoBox.width, 0);
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(650);
      const undoneC = (await previewBoxOf(page, tileId))!;
      expect(undoneC.width).toBeCloseTo(startBox.width, 1);
      expect(undoneC.height).toBeCloseTo(startBox.height, 1);
    });

    test("pure S/W/N handles grow rows/columns (the size-step root cause)", async ({
      page,
      request,
    }) => {
      await bootSeededDesktop(page, request, { t77Scene: true });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.reload();
      await expect(page.locator(".vela-desktop")).toBeVisible({ timeout: 30_000 });
      await enterArrangeMode(page);
      const tileId = "app-mdn";
      const tile = page.locator(`[data-item-id="${tileId}"]`).first();
      await tile.click();
      await expect(page.locator(".vela-item__resize-handle")).toHaveCount(8);
      const { pitch, cellPx, gapPx } = await gridPitchOf(page);
      const startBox = (await previewBoxOf(page, tileId))!;

      // Pure vertical growth (impossible under the old step snap).
      const framesS = await dragHandle(page, tileId, "s", 0, pitch * 1.4, 22, `s-grow-${viewport.name}`);
      const limit = pitch / 2 + 1;
      for (const frame of framesS) {
        expect(frame.box).not.toBeNull();
        expect(
          Math.abs(frame.box!.y + frame.box!.height - frame.pointer.y),
          "s-handle preview bottom vs pointer",
        ).toBeLessThan(limit);
      }
      expect(framesS.at(-1)!.badge).toBe("1×2");
      const sBox = (await previewBoxOf(page, tileId))!;
      expect(sBox.height).toBeCloseTo(2 * cellPx + gapPx, 0);
      expect(sBox.width).toBeCloseTo(cellPx, 0);
      // The top edge stays anchored.
      expect(sBox.y).toBeCloseTo(startBox.y, 0);

      // Undo, then west: origin moves with the dragged edge.
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(650);
      const framesW = await dragHandle(page, tileId, "w", -pitch * 1.4, 0, 22, `w-grow-${viewport.name}`);
      for (const frame of framesW) {
        expect(
          Math.abs(frame.box!.x - frame.pointer.x), // handle center = ON the left edge
          "w-handle preview left vs pointer",
        ).toBeLessThan(limit + 1);
      }
      expect(framesW.at(-1)!.badge).toBe("2×1");
      const wBox = (await previewBoxOf(page, tileId))!;
      expect(wBox.width).toBeCloseTo(2 * cellPx + gapPx, 0);
      // The right (anchored) edge stays put.
      expect(wBox.x + wBox.width).toBeCloseTo(startBox.x + startBox.width, 0);

      await page.keyboard.press("Control+z");
      await page.waitForTimeout(650);
      const framesN = await dragHandle(page, tileId, "n", 0, -pitch * 1.4, 22, `n-grow-${viewport.name}`);
      expect(framesN.at(-1)!.badge).toBe("1×2");
      const nBox = (await previewBoxOf(page, tileId))!;
      expect(nBox.height).toBeCloseTo(2 * cellPx + gapPx, 0);
      // The bottom (anchored) edge stays put.
      expect(nBox.y + nBox.height).toBeCloseTo(startBox.y + startBox.height, 0);
    });

    test("freeform resize stays continuous and follows the pointer", async ({
      page,
      request,
    }) => {
      await bootSeededDesktop(page, request, { t77Scene: true });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.reload();
      await expect(page.locator(".vela-desktop")).toBeVisible({ timeout: 30_000 });
      await enterArrangeMode(page);
      await page.locator(".vela-arrange-bar button", { hasText: "自由" }).click();
      await page.waitForTimeout(600);
      const tileId = "app-mdn";
      const tile = page.locator(`[data-item-id="${tileId}"]`).first();
      await tile.click();
      await expect(page.locator(".vela-item__resize-handle")).toHaveCount(8);
      const before = (await previewBoxOf(page, tileId))!;
      const frames = await dragHandle(page, tileId, "se", 120, 90, 24, "freeform-se");
      // Freeform is continuous: the box follows the pointer 1:1 (within a
      // frame's pointer travel) instead of snapping.
      const last = frames.at(-1)!;
      expect(last.box!.width).toBeCloseTo(before.width + 120, 0);
      expect(last.box!.height).toBeCloseTo(before.height + 90, 0);
      const after = (await previewBoxOf(page, tileId))!;
      expect(after.width).toBeGreaterThan(before.width + 60);
    });
  });
}

const scroller = '.vela-section-layer[data-active-section="true"] .vela-section-scroller';

test.describe("t77 scroll damping", () => {
  test("one wheel notch ramps over multiple frames and settles damped ≤600ms", async ({
    page,
    request,
  }) => {
    await bootSeededDesktop(page, request, { t77Scene: true });
    const surface = page.locator(scroller);
    await surface.evaluate((el) => {
      const spacer = document.createElement("div");
      spacer.style.height = "2500px";
      el.firstElementChild!.appendChild(spacer);
    });
    await page.mouse.move(700, 400);
    await surface.evaluate((el) => {
      const samples: Array<{ t: number; y: number }> = [];
      (window as unknown as { t77ScrollSamples: typeof samples }).t77ScrollSamples = samples;
      const start = performance.now();
      function frame() {
        samples.push({ t: performance.now() - start, y: el.scrollTop });
        if (performance.now() - start < 900) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(1000);
    const samples = await page.evaluate(
      () => (window as unknown as { t77ScrollSamples: Array<{ t: number; y: number }> }).t77ScrollSamples,
    );
    writeFileSync(resolve(evidence, "damped-wheel-frames.json"), JSON.stringify(samples, null, 2));

    // NOT one-frame-to-position: the ramp visits many distinct offsets…
    const distinct = new Set(samples.map((sample) => sample.y));
    expect(distinct.size).toBeGreaterThan(5);
    // …strictly increasing while gliding (damped, no back-jumps)…
    const yValues = samples.map((sample) => sample.y);
    for (let index = 1; index < yValues.length; index += 1) {
      expect(yValues[index]!).toBeGreaterThanOrEqual(yValues[index - 1]! - 0.5);
    }
    // …never a single-frame jump ≥ 60px (the notch is 100px)…
    for (let index = 1; index < yValues.length; index += 1) {
      expect(yValues[index]! - yValues[index - 1]!).toBeLessThan(60);
    }
    // …and the stop is damped AND prompt: settled within 600ms.
    expect(yValues.at(-1)!).toBeCloseTo(100, 0);
    expect(samples.filter((sample) => sample.t > 600).every((sample) => Math.abs(sample.y - 100) < 1)).toBe(true);
    await page.screenshot({ path: resolve(evidence, "damped-wheel.png") });
  });
});

test.describe("t77 pill hover wheel", () => {
  test.beforeEach(async ({ page, request }) => {
    await bootSeededDesktop(page, request, { t77Scene: true });
  });

  function activeSegment(page: Page) {
    return page.locator('.vela-pill__item[data-active="true"]');
  }

  test("hover + vertical wheel switches to the next section and never scrolls the page", async ({
    page,
  }) => {
    const surface = page.locator(scroller);
    await surface.evaluate((el) => {
      const spacer = document.createElement("div");
      spacer.style.height = "2500px";
      el.firstElementChild!.appendChild(spacer);
    });
    const pill = page.locator(".vela-pill");
    await expect(activeSegment(page)).toHaveText(/前端开发/);
    const pillBox = (await pill.boundingBox())!;
    await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(250);
    await expect(activeSegment(page)).toHaveText(/AI 工具/);
    // The page behind the pill did not scroll.
    expect(await surface.evaluate((el) => el.scrollTop)).toBe(0);
  });

  test("ten rapid small deltas switch exactly one section (cooldown)", async ({ page }) => {
    const pill = page.locator(".vela-pill");
    const pillBox = (await pill.boundingBox())!;
    await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
    // One continuous burst: 10 × 10px deltas inside a single gesture
    // window (dispatched in one script — real inter-event gaps of a
    // trackpad stream are ~8-16ms, never Playwright-call cadence).
    await page.evaluate(() => {
      const nav = document.querySelector(".vela-pill")!;
      for (let index = 0; index < 10; index += 1) {
        nav.dispatchEvent(
          new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 10 }),
        );
      }
    });
    await page.waitForTimeout(250);
    await expect(activeSegment(page)).toHaveText(/AI 工具/);
    // A second gesture after the cooldown pages again.
    await page.waitForTimeout(500);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(250);
    await expect(activeSegment(page)).toHaveText(/设计灵感/);
  });

  test("upward wheel switches to the previous section", async ({ page }) => {
    // Land on the third section first (click — the established path).
    await page.locator('.vela-pill__item', { hasText: "设计灵感" }).click();
    await expect(activeSegment(page)).toHaveText(/设计灵感/);
    const pillBox = (await page.locator(".vela-pill").boundingBox())!;
    await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(250);
    await expect(activeSegment(page)).toHaveText(/AI 工具/);
  });

  test("wheel away from the pill never switches sections", async ({ page }) => {
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, 120);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(400);
    await expect(activeSegment(page)).toHaveText(/前端开发/);
  });

  test("overflowing pill: a wheel switch reveals the new active segment", async ({
    page,
    request,
  }) => {
    // Swap to the many-sections fixture: clear the local-first store so
    // the next boot goes through the picker (the pattern of the t61 spec).
    await page.evaluate(() => {
      window.localStorage.clear();
      const req = indexedDB.deleteDatabase("veladesk-local");
      req.onsuccess = req.onerror = req.onblocked = () => undefined;
    });
    await bootSeededDesktop(page, request, { manySections: true });
    const strip = page.locator(".vela-pill__scroller");
    await expect(strip).toBeVisible();
    expect(await strip.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(true);
    const pillBox = (await page.locator(".vela-pill").boundingBox())!;
    await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
    // Page forward 8 gestures (each detent lands after the 350ms cooldown).
    for (let index = 0; index < 8; index += 1) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(430);
    }
    const active = page.locator('.vela-pill__item[data-active="true"]');
    // Sections: 前端开发, AI 工具, 设计灵感, 扩展分区1…20 → gesture 8 lands on 扩展分区6.
    await expect(active).toHaveText(/扩展分区6/);
    const revealed = await active.evaluate((el) => {
      const segment = el as HTMLElement;
      const parent = segment.closest(".vela-pill__scroller") as HTMLElement;
      return (
        segment.offsetLeft >= parent.scrollLeft &&
        segment.offsetLeft + segment.offsetWidth <= parent.scrollLeft + parent.clientWidth + 1
      );
    });
    expect(revealed).toBe(true);
    await page.screenshot({ path: resolve(evidence, "pill-overflow-wheel.png") });
  });
});
