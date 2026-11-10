import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Shared helpers of the interaction-fix suite: boot, arrange-mode entry,
 * real pointer drags, and the in-page per-frame position recorder the
 * drop-settle assertions sample from.
 */

/**
 * Evidence root: <repo>/artifacts/interaction-fix (gitignored) — resolved
 * from THIS file so the specs land evidence there regardless of the CWD
 * the runner was invoked from.
 */
export const ARTIFACT_ROOT = resolve(__dirname, "../../../../artifacts/interaction-fix");

/** Ensures the evidence root exists (specs write screenshots/JSON there). */
export function ensureArtifactRoot(): string {
  mkdirSync(ARTIFACT_ROOT, { recursive: true });
  return ARTIFACT_ROOT;
}

export interface RecordedFrame {
  readonly t: number;
  readonly x: number;
  readonly y: number;
}

/** Boots the page and waits for the ready desktop (fresh context = demo boot). */
export async function bootDesktop(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.removeItem("veladesk:ui-locale");
  });
  await page.goto("/");
  await expect(page.locator(".vela-desktop")).toBeVisible({ timeout: 30_000 });
}

/** Enters arrange mode through the always-visible ⌘K door (no shortcut keys). */
export async function enterArrangeMode(page: Page): Promise<void> {
  const arranged = await page.locator(".vela-desktop").getAttribute("data-arrange");
  if (arranged === "true") {
    return;
  }
  await page.locator(".vela-helm-commandbar").click();
  const option = page.getByRole("option", { name: /切换到整理模式/ }).or(
    page.getByRole("option", { name: /切换到查看模式/ }),
  );
  await expect(option.first()).toBeVisible();
  // Only the 切换到整理模式 command changes anything when already viewing.
  const arrangeOption = page.getByRole("option", { name: /切换到整理模式/ });
  if (await arrangeOption.count()) {
    await arrangeOption.click();
  } else {
    await option.first().click();
  }
  await expect(page.locator(".vela-desktop")).toHaveAttribute("data-arrange", "true");
}

/** Switches the active section between 网格/自由 via the arrange toolbar. */
export async function setPlacementMode(page: Page, mode: "grid" | "freeform"): Promise<void> {
  const label = mode === "grid" ? "网格" : "自由";
  const button = page.locator(".vela-arrange-bar button", { hasText: label });
  await expect(button).toBeVisible();
  if ((await button.getAttribute("aria-pressed")) !== "true") {
    await button.click();
    await page.waitForTimeout(600);
  }
}

/**
 * Starts a per-frame recorder for a tile's VISUAL box (the
 * `.vela-item__body` — what the user sees, including the snap correction),
 * sampled on requestAnimationFrame until stopped.
 */
export async function startFrameRecorder(page: Page, tileId: string): Promise<void> {
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-item-id="${CSS.escape(id)}"]`);
    if (el === null) {
      throw new Error(`recorder target not found: ${id}`);
    }
    const visual = el.querySelector(":scope > .vela-item__body") ?? el;
    const frames: { t: number; x: number; y: number }[] = [];
    (window as { __vdFrames?: unknown }).__vdFrames = frames;
    const rec = () => {
      const r = visual.getBoundingClientRect();
      frames.push({ t: performance.now(), x: r.x, y: r.y });
      requestAnimationFrame(rec);
    };
    requestAnimationFrame(rec);
  }, tileId);
}

/** Collects the recorded frames so far (a copy). */
export async function collectFrames(page: Page): Promise<RecordedFrame[]> {
  return page.evaluate(
    () => (window as { __vdFrames?: { t: number; x: number; y: number }[] }).__vdFrames ?? [],
  );
}

/** The tile's current VISUAL (body) box. */
export async function visualBoxOf(page: Page, tileId: string) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-item-id="${CSS.escape(id)}"]`);
    if (el === null) {
      throw new Error(`tile not found: ${id}`);
    }
    const visual = el.querySelector(":scope > .vela-item__body") ?? el;
    const r = visual.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, tileId);
}

/** A real pointer drag from the tile's center by the given pixel delta. */
export async function dragTileBy(
  page: Page,
  tileId: string,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  const box = await page.locator(`[data-item-id="${tileId}"]`).boundingBox();
  if (box === null) {
    throw new Error(`tile not found: ${tileId}`);
  }
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      startX + (deltaX * i) / steps,
      startY + (deltaY * i) / steps,
      { steps: 1 },
    );
    await page.waitForTimeout(16);
  }
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The drop-settle contract, as one assertion set over the recorded frames:
 *
 *  1. NO RETURN-TO-ORIGIN: the first post-release frame sits at the release
 *     position (within the tolerance a first rAF can wobble), never back at
 *     the pre-drag cell.
 *  2. MONOTONIC APPROACH: from the release on, the distance to the final
 *     resting position never grows beyond a sub-pixel jitter band.
 *
 * Returns the analyzed slice for the artifact JSON.
 */
export function assertSettleFrames(
  frames: readonly RecordedFrame[],
  release: { x: number; y: number },
  origin: { x: number; y: number },
): { releaseToOrigin: number; firstFrameToRelease: number; maxRegression: number } {
  expect(frames.length).toBeGreaterThan(4);
  const last = frames[frames.length - 1]!;
  const first = frames[0]!;

  const firstFrameToRelease = distance(first, release);
  // The first sampled frame must be AT the release position, and clearly
  // not at (or near) the pre-drag origin: if the tile bounced home first,
  // firstFrameToOrigin would beat firstFrameToRelease.
  expect(firstFrameToRelease).toBeLessThan(28);
  const firstFrameToOrigin = distance(first, origin);
  expect(firstFrameToRelease).toBeLessThan(firstFrameToOrigin);

  let maxRegression = 0;
  let settled = distance(frames[0]!, last);
  for (const frame of frames) {
    const d = distance(frame, last);
    // A frame may jitter by a rounding pixel; it may never move AWAY from
    // the resting position by more than that.
    maxRegression = Math.max(maxRegression, d - settled);
    settled = Math.min(settled, d);
  }
  expect(maxRegression).toBeLessThan(2.5);
  // And it actually settles: the tail is at rest on the final position.
  const tail = frames.slice(-6);
  for (const frame of tail) {
    expect(distance(frame, last)).toBeLessThan(1.5);
  }
  return {
    releaseToOrigin: distance(release, origin),
    firstFrameToRelease,
    maxRegression,
  };
}
