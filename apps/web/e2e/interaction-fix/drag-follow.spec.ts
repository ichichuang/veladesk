import { writeFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

import { bootSeededDesktop, deleteSeededWorkspaces } from "./seed";
import { enterArrangeMode } from "./helpers";

/**
 * t61 issue 1: the drag preview must FOLLOW THE POINTER every frame — for
 * every tile size, selected or not, inside the grid or out over the header
 * — with the grab offset preserved (press point relative to the tile).
 *
 * The recorder samples the tile's VISUAL box (.vela-item__body) and the
 * pointer every animation frame; each sampled frame asserts the tile
 * center sits within 8px of (pointer − grab offset). Both fixtures drag
 * INTO the header/search-bar band (outside the grid).
 */
test.afterEach(async ({ request }) => {
  await deleteSeededWorkspaces(request);
});

const MAX_LAG_PX = 8;

interface FollowFrame {
  readonly t: number;
  readonly pointer: { x: number; y: number };
  readonly body: { x: number; y: number; width: number; height: number };
}

/** Samples pointer + the dragged tile's visual box every animation frame. */
async function startFollowRecorder(page: import("@playwright/test").Page, tileId: string) {
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-item-id="${CSS.escape(id)}"]`);
    if (el === null) {
      throw new Error(`recorder target not found: ${id}`);
    }
    const visual = el.querySelector(":scope > .vela-item__body") ?? el;
    const frames: FollowFrame[] = [];
    (window as { __vdFollow?: unknown }).__vdFollow = frames;
    let px = 0;
    let py = 0;
    const onMove = (event: PointerEvent) => {
      px = event.clientX;
      py = event.clientY;
    };
    window.addEventListener("pointermove", onMove, { capture: true });
    const rec = () => {
      const r = visual.getBoundingClientRect();
      frames.push({
        t: performance.now(),
        pointer: { x: px, y: py },
        body: { x: r.x, y: r.y, width: r.width, height: r.height },
      });
      requestAnimationFrame(rec);
    };
    requestAnimationFrame(rec);
    (window as { __vdFollowStop?: () => void }).__vdFollowStop = () =>
      window.removeEventListener("pointermove", onMove, { capture: true } as AddEventListenerOptions);
  }, tileId);
}

async function collectFollowFrames(page: import("@playwright/test").Page): Promise<FollowFrame[]> {
  return page.evaluate(
    () => (window as { __vdFollow?: FollowFrame[] }).__vdFollow ?? [],
  );
}

/**
 * The per-frame contract: once the drag is live (the first samples after
 * the activation distance), the visual tile center tracks
 * pointer − grabOffset within {@link MAX_LAG_PX} on EVERY frame.
 *
 * grabOffset is CENTER-RELATIVE: (press point − tile center at press). A
 * center press keeps the center exactly under the pointer; an off-center
 * press keeps that grab point under the pointer instead.
 */
function assertFollowFrames(
  frames: readonly FollowFrame[],
  grabOffset: { x: number; y: number },
  label: string,
): { sampled: number; maxLag: number } {
  // Warm-up frames before the drag activated have pointer 0,0 — skip them.
  const live = frames.filter((frame) => frame.pointer.x !== 0 || frame.pointer.y !== 0);
  expect(live.length, `${label}: sampled live frames`).toBeGreaterThanOrEqual(20);

  // The ACTIVATION WINDOW: dnd-kit only takes over the source after its
  // activation distance, and its translate style rides one event behind —
  // the snap-in and the first few moved frames legitimately lag by that
  // handoff. Steady tracking is asserted from the 7th moved frame on.
  const rest = live[0]!;
  const moved = live.filter(
    (frame) =>
      Math.abs(frame.body.x - rest.body.x) > 1 || Math.abs(frame.body.y - rest.body.y) > 1,
  );
  const HANDOFF_FRAMES = 6;
  const active = moved.slice(HANDOFF_FRAMES);
  expect(active.length, `${label}: frames while the drag is live`).toBeGreaterThanOrEqual(20);

  let maxLag = 0;
  let worst = 0;
  moved.forEach((frame, index) => {
    if (index < HANDOFF_FRAMES) {
      return;
    }
    const center = {
      x: frame.body.x + frame.body.width / 2,
      y: frame.body.y + frame.body.height / 2,
    };
    const lagAgainst = (pointer: { x: number; y: number }) =>
      Math.hypot(
        center.x - (pointer.x - grabOffset.x),
        center.y - (pointer.y - grabOffset.y),
      );
    // The recorder's pointer updates on the raw event; the tile's style
    // write lands in the same task — a move landing between the two can
    // legitimately show the tile one move behind THIS frame's pointer. The
    // contract: within 8px of the pointer of THIS frame OR the previous
    // one (a stalled tile diverges from both and still fails).
    const previous = moved[index - 1]!.pointer;
    const lag = Math.min(lagAgainst(frame.pointer), lagAgainst(previous));
    if (lag > maxLag) {
      maxLag = lag;
      worst = index - HANDOFF_FRAMES;
    }
  });
  expect(
    maxLag,
    `${label}: worst frame #${worst} lag (center vs pointer − center-relative grab offset)`,
  ).toBeLessThan(MAX_LAG_PX);
  return { sampled: active.length, maxLag };
}

test.describe("drag follow (t61)", () => {
  test.beforeEach(async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // richScene: the fixture with the 2×2 hero tiles (app-vite) among 1×1s.
    await bootSeededDesktop(page, request, { richScene: true });
    await enterArrangeMode(page);
  });

  test("a selected 2×2 tile follows the pointer frame-by-frame, out over the header", async ({
    page,
  }) => {
    // SELECT the 2×2 hero first (Chris's exact scenario: selection ring +
    // resize handles visible while dragging).
    const tile = page.locator('[data-item-id="app-vite"]');
    await expect(tile).toBeVisible();
    const box = (await tile.boundingBox())!;
    expect(Math.round(box.width / box.height)).toBe(1); // the 2×2 square
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(tile).toHaveAttribute("data-selected", "true");
    await expect(page.locator(".vela-item__resize-handle").first()).toBeVisible();

    // The grab point sits deliberately OFF-center (a third into the tile):
    // the follow contract must preserve exactly THIS offset, not the
    // center — an anchor bug cannot pass by symmetry.
    const press = { x: box.x + box.width / 3, y: box.y + box.height / 4 };
    const grabOffset = {
      x: press.x - (box.x + box.width / 2),
      y: press.y - (box.y + box.height / 2),
    };
    await startFollowRecorder(page, "app-vite");

    // ≥30 steps up into the header/search-bar band (outside the grid).
    const startX = press.x;
    const startY = press.y;
    const endX = 560;
    const endY = 90;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let i = 1; i <= 30; i += 1) {
      await page.mouse.move(
        startX + ((endX - startX) * i) / 30,
        startY + ((endY - startY) * i) / 30,
        { steps: 1 },
      );
      await page.waitForTimeout(26);
    }

    const midDrag = await page.evaluate(() => {
      const el = document.querySelector('[data-item-id="app-vite"]');
      const visual = el!.querySelector(":scope > .vela-item__body");
      return visual instanceof HTMLElement
        ? getComputedStyle(visual).getPropertyValue("--vd-canvas-drag-preview") ||
            getComputedStyle(visual).transform
        : "none";
    });
    const frames = await collectFollowFrames(page);
    const analysis = assertFollowFrames(frames, grabOffset, "2×2 selected");

    // Evidence: the mid-drag frame (tile under the pointer, over the header).
    const { ensureArtifactRoot } = await import("./helpers");
    await page.screenshot({
      path: `${ensureArtifactRoot()}/drag-follow-2x2-midframe.png`,
    });

    // Release outside the grid: the drop settles to a legal cell without
    // freezing — the tile ends somewhere legal and nothing drags forever.
    await page.mouse.up();
    await page.waitForTimeout(900);
    const settled = await tile.boundingBox();
    expect(settled).not.toBeNull();
    await expect(tile).not.toHaveAttribute("data-dragging", "true");
    expect(await page.locator("[data-dragging='true']").count()).toBe(0);

    const artifact = {
      tile: "app-vite (2×2, selected)",
      grabOffset,
      midDrag,
      analysis,
      frames: frames.slice(0, 120),
    };
    writeFileSync(
      `${ensureArtifactRoot()}/drag-follow-2x2.json`,
      JSON.stringify(artifact, null, 2),
    );
  });

  test("an unselected 1×1 tile follows the pointer frame-by-frame", async ({ page }) => {
    const tile = page.locator('[data-item-id="app-mdn"]');
    await expect(tile).toBeVisible();
    const box = (await tile.boundingBox())!;
    expect(box.width).toBeLessThan(140); // a 1×1 cell
    // Off-center press again: bottom-right quadrant of the small tile.
    const press = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.72 };
    const grabOffset = {
      x: press.x - (box.x + box.width / 2),
      y: press.y - (box.y + box.height / 2),
    };

    await startFollowRecorder(page, "app-mdn");
    const startX = press.x;
    const startY = press.y;
    const endX = 800;
    const endY = 100;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let i = 1; i <= 30; i += 1) {
      await page.mouse.move(
        startX + ((endX - startX) * i) / 30,
        startY + ((endY - startY) * i) / 30,
        { steps: 1 },
      );
      await page.waitForTimeout(26);
    }
    const frames = await collectFollowFrames(page);
    const analysis = assertFollowFrames(frames, grabOffset, "1×1 plain");

    // Evidence: the 1×1 mid-drag frame too.
    const { ensureArtifactRoot } = await import("./helpers");
    await page.screenshot({
      path: `${ensureArtifactRoot()}/drag-follow-1x1-midframe.png`,
    });

    await page.mouse.up();
    await page.waitForTimeout(900);
    expect(await page.locator("[data-dragging='true']").count()).toBe(0);

    writeFileSync(
      `${ensureArtifactRoot()}/drag-follow-1x1.json`,
      JSON.stringify({ tile: "app-mdn (1×1)", grabOffset, analysis, frames: frames.slice(0, 120) }, null, 2),
    );
  });

  test("a drop over the header settles back to a legal cell smoothly (no freeze)", async ({
    page,
  }) => {
    const tile = page.locator('[data-item-id="app-react"]');
    const box = (await tile.boundingBox())!;
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let i = 1; i <= 16; i += 1) {
      await page.mouse.move(startX + 30 * (i / 16), startY - (startY - 70) * (i / 16), {
        steps: 1,
      });
      await page.waitForTimeout(26);
    }
    // Released far above the grid: the tile must return to a resting legal
    // position within the settle window (never stuck, never off-stage).
    await page.mouse.up();
    await page.waitForTimeout(1200);
    const settled = (await tile.boundingBox())!;
    expect(settled.y).toBeGreaterThan(100); // back inside the workbench
    expect(settled.x).toBeGreaterThan(0);
    expect(await page.locator("[data-dragging='true']").count()).toBe(0);
  });
});
