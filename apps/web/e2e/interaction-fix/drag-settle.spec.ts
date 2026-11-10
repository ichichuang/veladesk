import { writeFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

import {
  assertSettleFrames,
  collectFrames,
  ensureArtifactRoot,
  dragTileBy,
  enterArrangeMode,
  setPlacementMode,
  startFrameRecorder,
  visualBoxOf,
} from "./helpers";
import { bootSeededDesktop, deleteSeededWorkspaces } from "./seed";

/**
 * Issue 1 (Chris t54): a released tile must continue FROM ITS RELEASE
 * POSITION into its committed geometry — never bounce back to its pre-drag
 * cell first, never teleport. Verified with real pointer events while an
 * in-page rAF recorder samples the tile's visual box every frame; the raw
 * samples land in artifacts as JSON.
 */
test.afterEach(async ({ request }) => {
  await deleteSeededWorkspaces(request);
});

test.describe("drop settle (grid + freeform)", () => {
  test.beforeEach(async ({ page, request }) => {
    await bootSeededDesktop(page, request);
    await enterArrangeMode(page);
  });

  test("grid drop continues from the release position", async ({ page }) => {
    await setPlacementMode(page, "grid");
    const tile = page.locator('[data-item-id]').filter({ hasText: 'React' }).first();
    await expect(tile).toBeVisible();
    const id = (await tile.getAttribute("data-item-id")) as string;
    const origin = await visualBoxOf(page, id);

    await dragTileBy(page, id, -190, -120);
    const release = await visualBoxOf(page, id);
    // The drag must have actually moved the tile somewhere else.
    expect(Math.hypot(release.x - origin.x, release.y - origin.y)).toBeGreaterThan(40);

    await startFrameRecorder(page, id);
    await page.mouse.up();
    await page.waitForTimeout(900);

    const frames = await collectFrames(page);
    const analysis = assertSettleFrames(frames, release, origin);
    const artifactRoot = ensureArtifactRoot();
    writeFileSync(
      `${artifactRoot}/drag-grid-frames.json`,
      JSON.stringify({ origin, release, analysis, frames }, null, 2),
    );
  });

  test("grid cancel (Escape) glides home from the release position", async ({ page }) => {
    await setPlacementMode(page, "grid");
    const id = (await page
      .locator('[data-item-id]')
      .filter({ hasText: 'React' })
      .first()
      .getAttribute("data-item-id")) as string;
    const origin = await visualBoxOf(page, id);

    await dragTileBy(page, id, 170, 120);
    const release = await visualBoxOf(page, id);
    expect(Math.hypot(release.x - origin.x, release.y - origin.y)).toBeGreaterThan(40);

    await startFrameRecorder(page, id);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(900);

    const frames = await collectFrames(page);
    const analysis = assertSettleFrames(frames, release, origin);
    // A cancel returns to the ORIGIN cell, and settles there.
    const last = frames[frames.length - 1]!;
    expect(Math.hypot(last.x - origin.x, last.y - origin.y)).toBeLessThan(2);
    const artifactRoot = ensureArtifactRoot();
    writeFileSync(
      `${artifactRoot}/drag-grid-cancel-frames.json`,
      JSON.stringify({ origin, release, analysis, frames }, null, 2),
    );
  });

  test("freeform drop continues from the release position", async ({ page }) => {
    await setPlacementMode(page, "freeform");
    const id = (await page
      .locator('[data-item-id]')
      .filter({ hasText: 'Vue' })
      .first()
      .getAttribute("data-item-id")) as string;
    await expect(page.locator(`[data-item-id="${id}"]`)).toBeVisible();
    const origin = await visualBoxOf(page, id);

    await dragTileBy(page, id, 210, 140);
    const release = await visualBoxOf(page, id);
    expect(Math.hypot(release.x - origin.x, release.y - origin.y)).toBeGreaterThan(40);

    await startFrameRecorder(page, id);
    await page.mouse.up();
    await page.waitForTimeout(900);

    const frames = await collectFrames(page);
    const analysis = assertSettleFrames(frames, release, origin);
    const last = frames[frames.length - 1]!;
    // The freeform commit lands exactly where the pointer let go (the
    // continuous preview is the commit), so the settle is short but must
    // still start at the release position.
    expect(Math.hypot(last.x - release.x, last.y - release.y)).toBeLessThan(4);
    const artifactRoot = ensureArtifactRoot();
    writeFileSync(
      `${artifactRoot}/drag-freeform-frames.json`,
      JSON.stringify({ origin, release, analysis, frames }, null, 2),
    );
  });
});
