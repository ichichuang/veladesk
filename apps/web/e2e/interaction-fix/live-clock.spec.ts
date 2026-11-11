import { writeFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

import { bootSeededDesktop, deleteSeededWorkspaces } from "./seed";
import { ensureArtifactRoot } from "./helpers";

/**
 * t61 issue 3: the Helm clock shows SECONDS and every digit rolls.
 *
 * Contracts: HH:MM:SS (6 odometer reels + 2 breathing colons), the label
 * advances every second, a digit CHANGE carries a transform transition on
 * its reel (and no transition under prefers-reduced-motion), and a mid-roll
 * frame is captured as evidence.
 */
test.afterEach(async ({ request }) => {
  await deleteSeededWorkspaces(request);
});

test.describe("live clock (t61)", () => {
  test.beforeEach(async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await bootSeededDesktop(page, request);
  });

  test("shows HH:MM:SS with rolling digits; reduced motion swaps in place", async ({
    page,
    browserName,
  }) => {
    const time = page.locator(".vela-helm-clock__time");
    await expect(time).toBeVisible();
    const reels = time.locator(".vela-clock-digit__reel");
    await expect(reels).toHaveCount(6);
    await expect(time.locator(".vela-helm-clock__colon")).toHaveCount(2);
    // Seconds render inside the dimmer block.
    await expect(time.locator(".vela-helm-clock__seconds .vela-clock-digit__reel")).toHaveCount(2);

    const labelOf = () => time.getAttribute("aria-label");
    const first = await labelOf();
    expect(first).toMatch(/^\d{2}:\d{2}:\d{2}$/);

    // The seconds advance every boundary tick.
    await expect
      .poll(async () => (await labelOf()) !== first, { timeout: 4_000 })
      .toBe(true);
    const second = await labelOf();
    expect(second).not.toBe(first);

    // A change ROLLS: right after a second boundary the reel's COMPUTED
    // transform is still between cells (the inline style jumps instantly;
    // the CSS transition is what interpolates). Sample the computed
    // matrix across the boundary and require it to differ from the
    // settled end pose — i.e. a mid-roll frame exists.
    const roll = await page.evaluate(async () => {
      const reel = document.querySelectorAll<HTMLElement>(".vela-clock-digit__reel")[5]!;
      const rollMs = Math.round(parseFloat(getComputedStyle(reel).transitionDuration) * 1000);
      await new Promise<void>((resolve) => {
        const wait = 1000 - (Date.now() % 1000) + 8;
        setTimeout(resolve, wait);
      });
      // At +80ms into a 400ms roll the reel is ~20% through — clearly
      // between cells; at +900ms it has long settled.
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
      const midComputed = getComputedStyle(reel).transform;
      await new Promise<void>((resolve) => setTimeout(resolve, 820));
      const settledComputed = getComputedStyle(reel).transform;
      return { midComputed, settledComputed, rollMs };
    });

    // The roll transition exists and sits in the 350–450ms band.
    expect(roll.rollMs).toBeGreaterThanOrEqual(350);
    expect(roll.rollMs).toBeLessThanOrEqual(450);
    // The computed transform was caught BETWEEN cells (≠ settled pose).
    expect(roll.midComputed).not.toBe(roll.settledComputed);

    // Evidence: catch the clock mid-roll in a screenshot — shoot right
    // after the next second boundary, inside the 400ms roll window.
    await page.evaluate(() => {
      const wait = 1000 - (Date.now() % 1000) + 10;
      return new Promise<void>((resolve) => setTimeout(resolve, wait));
    });
    await page.screenshot({ path: `${ensureArtifactRoot()}/clock-roll-midframe.png` });

    // Evidence: the label plus the caught mid-roll frame.
    writeFileSync(
      `${ensureArtifactRoot()}/clock-roll.json`,
      JSON.stringify({ first, second, roll, browser: browserName }, null, 2),
    );
  });

  test("reduced motion: digits swap with no roll transition and the colon does not breathe", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(page.locator(".vela-helm-clock__time")).toBeVisible();

    const state = await page.evaluate(async () => {
      const reel = document.querySelectorAll<HTMLElement>(".vela-clock-digit__reel")[5]!;
      const transitionDuration = getComputedStyle(reel).transitionDuration;
      const colon = document.querySelector<HTMLElement>(".vela-helm-clock__colon")!;
      const colonAnimation = getComputedStyle(colon).animationName;
      // Across a second boundary the swap is a CUT: two samples INSIDE the
      // would-be roll window (+30ms and +120ms) show the same matrix — no
      // interpolation. (The wrap-park, a later identical-position snap,
      // deliberately sits outside this window.)
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1000 - (Date.now() % 1000) + 12);
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      const earlyComputed = getComputedStyle(reel).transform;
      await new Promise<void>((resolve) => setTimeout(resolve, 90));
      const lateComputed = getComputedStyle(reel).transform;
      return { transitionDuration, colonAnimation, earlyComputed, lateComputed };
    });

    expect(state.transitionDuration).toBe("0s");
    expect(state.colonAnimation).toBe("none");
    expect(state.lateComputed).toBe(state.earlyComputed);
  });
});
