import { expect, test } from "@playwright/test";

import {
  activeSectionName,
  bootIntoWorkspace,
  failOnConsoleError,
  pillRoot,
  pillItem,
  seedUniqueWorkspace,
  wheelAt,
  wheelDetents,
  wheelFlick,
} from "./helpers";
import { TWO_SECTIONS, thirtySections } from "../fixtures/seed";

/**
 * Section-pill wheel navigation (task 018 streams, t61 pill contract).
 *
 * Contracts under test: the pill owns HORIZONTAL wheel navigation
 * (trackpad-x / Shift+wheel); one deliberate gesture = one step; momentum
 * tails do not cascade; reversals respond promptly; the right side
 * scrolls its own section only; navigation never writes revisions.
 */

test.beforeEach(async ({ page }) => {
  failOnConsoleError(page);
});

/** The pill's middle point (the strip is one capsule row tall). */
async function pillCenter(page: import("@playwright/test").Page) {
  const box = await pillRoot(page).boundingBox();
  expect(box).not.toBeNull();
  return { x: box!.x + 40, y: box!.y + box!.height / 2, box: box! };
}

test.describe("two-section fixture — pill hit coverage", () => {
  test("wheel over a segment and over the strip padding both navigate", async ({
    page,
    request,
  }) => {
    await seedUniqueWorkspace(request, "wheel-2", TWO_SECTIONS);
    await bootIntoWorkspace(page, "Desk wheel-2");
    await expect(pillItem(page, "Alpha")).toBeVisible();

    const { x, y, box } = await pillCenter(page);

    // 1. Directly over a segment label.
    await wheelAt(page, x, y, 120);
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Beta");

    // 2. Over the strip's leading padding (not a button) — same listener.
    await wheelAt(page, box.x + 6, y, -120);
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Alpha");
  });

  test("a flick with a long decaying tail advances exactly one section", async ({
    page,
    request,
  }) => {
    await seedUniqueWorkspace(request, "wheel-flick", TWO_SECTIONS);
    await bootIntoWorkspace(page, "Desk wheel-flick");

    const { x, y } = await pillCenter(page);
    await wheelFlick(page, x, y, true);
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Beta");
    // The tail is swallowed: still Beta after everything settles.
    await page.waitForTimeout(600);
    expect(await activeSectionName(page)).toBe("Beta");

    // At the end of the list, further forward-intent stays put (no wrap).
    await wheelFlick(page, x, y, true);
    await page.waitForTimeout(300);
    expect(await activeSectionName(page)).toBe("Beta");
  });

  test("a reversal during motion pages back promptly", async ({ page, request }) => {
    await seedUniqueWorkspace(request, "wheel-rev", TWO_SECTIONS);
    await bootIntoWorkspace(page, "Desk wheel-rev");

    const { x, y } = await pillCenter(page);

    // Forward flick, then an immediate deliberate back push mid-tail.
    await page.mouse.move(x, y);
    for (const magnitude of [40, 45, 38, 30, 24]) {
      await page.mouse.wheel(magnitude, 0);
      await page.waitForTimeout(12);
    }
    for (const magnitude of [30, 24, 18]) {
      await page.mouse.wheel(-magnitude, 0);
      await page.waitForTimeout(12);
    }
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Alpha");
  });

  test("chained deliberate detents advance one section per detent", async ({ page, request }) => {
    const sections = [
      TWO_SECTIONS[0]!,
      TWO_SECTIONS[1]!,
      { id: "page-gamma", name: "Gamma3", apps: [] },
    ];
    await seedUniqueWorkspace(request, "wheel-detents", sections);
    await bootIntoWorkspace(page, "Desk wheel-detents");

    const { x, y } = await pillCenter(page);
    await wheelDetents(page, x, y, true, 2);
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Gamma3");
  });

  test("ctrl-modified wheel never navigates (browser zoom stays native)", async ({
    page,
    request,
  }) => {
    await seedUniqueWorkspace(request, "wheel-ctrl", TWO_SECTIONS);
    await bootIntoWorkspace(page, "Desk wheel-ctrl");

    const { x, y } = await pillCenter(page);
    await page.mouse.move(x, y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(240, 0);
    await page.keyboard.up("Control");
    await page.waitForTimeout(300);
    expect(await activeSectionName(page)).toBe("Alpha");
  });

  test("a distant segment click selects it directly, no queuing", async ({ page, request }) => {
    await seedUniqueWorkspace(request, "wheel-click", TWO_SECTIONS);
    await bootIntoWorkspace(page, "Desk wheel-click");

    await pillItem(page, "Beta").click();
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Beta");
  });

  test("navigation writes no workspace revision", async ({ page, request }) => {
    const id = await seedUniqueWorkspace(request, "wheel-revcount", TWO_SECTIONS);
    await bootIntoWorkspace(page, "Desk wheel-revcount");

    const before = await (await request.get(`/api/v1/workspaces/${id}`)).json();
    const { x, y } = await pillCenter(page);
    await wheelAt(page, x, y, 120);
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Beta");
    const after = await (await request.get(`/api/v1/workspaces/${id}`)).json();
    expect(after.workspace.revision).toBe(before.workspace.revision);
  });
});

test.describe("thirty-section fixture — bounds and inertia", () => {
  test("an overflowing pill scrolls its strip; arrows page bounded and without cascades", async ({
    page,
    request,
  }) => {
    await seedUniqueWorkspace(request, "wheel-30", thirtySections());
    await bootIntoWorkspace(page, "Desk wheel-30");

    const { x, y } = await pillCenter(page);

    // t61 pill contract: with 30 sections the capsule OVERFLOWS, so the
    // wheel scrolls the strip itself (native) — it never hijacks paging.
    const scroller = page.locator(".vela-pill__scroller");
    await expect
      .poll(async () => scroller.evaluate((el) => el.scrollWidth > el.clientWidth + 1))
      .toBe(true);
    await wheelFlick(page, x, y, true);
    await page.waitForTimeout(400);
    expect(await activeSectionName(page)).toBe("Section 01");
    expect(
      await scroller.evaluate((el) => el.scrollLeft),
      "the overflowing strip consumed the flick natively"
    ).toBeGreaterThan(0);

    // Arrow paging still works over a long list, bounded, one step each.
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Section 02");
    for (let index = 0; index < 5; index += 1) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(120);
    }
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Section 07");

    // Back works and clamps at the first section.
    for (let index = 0; index < 20; index += 1) {
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(60);
    }
    await expect
      .poll(() => activeSectionName(page), { timeout: 8_000 })
      .toBe("Section 01");
  });

  test("leaving and re-entering the pill restarts wheel navigation cleanly", async ({
    page,
    request,
  }) => {
    await seedUniqueWorkspace(request, "wheel-reenter", TWO_SECTIONS);
    await bootIntoWorkspace(page, "Desk wheel-reenter");

    const { x, y } = await pillCenter(page);
    await wheelAt(page, x, y, 120);
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Beta");

    // Leave the pill entirely, idle, come back — no stale lock.
    await page.mouse.move(900, 300);
    await page.waitForTimeout(400);
    await wheelAt(page, x, y, -120);
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Alpha");
  });
});

test.describe("right side stays independent", () => {
  test("wheel over the section scroller scrolls that section only, at both boundaries", async ({
    page,
    request,
  }) => {
    // Enough apps to overflow the viewport: scrolling is observable.
    const manyApps = Array.from({ length: 40 }, (_, index) => ({
      id: `app-many-${index}`,
      name: `App ${index + 1}`,
      url: "https://example.com",
    }));
    const sections = [
      { id: "page-alpha", name: "Alpha", apps: manyApps },
      TWO_SECTIONS[1]!,
      { id: "page-many", name: "Many", apps: [] },
    ];
    await seedUniqueWorkspace(request, "wheel-right", sections);
    await bootIntoWorkspace(page, "Desk wheel-right");

    const scroller = page.locator(".vela-section-layer[data-active-section='true'] .vela-section-scroller");
    await expect(scroller).toBeVisible();
    // Self-validating fixture: the section content must actually overflow.
    await expect
      .poll(async () => scroller.evaluate((node) => node.scrollHeight - node.clientHeight), {
        timeout: 10_000,
      })
      .toBeGreaterThan(100);

    // Wheel over the right side: the section scrolls, the active section
    // never flips — including past the top boundary.
    await page.mouse.move(900, 450);
    for (let index = 0; index < 12; index += 1) {
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(16);
    }
    const scrollTop = await scroller.evaluate((node) => node.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
    expect(await activeSectionName(page)).toBe("Alpha");

    // Back to the very top and beyond: still Alpha, no upward flip.
    for (let index = 0; index < 12; index += 1) {
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(16);
    }
    expect(await activeSectionName(page)).toBe("Alpha");
  });

  test("wheel while a modal is up never navigates sections", async ({ page, request }) => {
    await seedUniqueWorkspace(request, "wheel-modal", TWO_SECTIONS);
    await bootIntoWorkspace(page, "Desk wheel-modal");

    await page.mouse.click(20, 500, { button: "right" });
    await page.getByRole("menuitem", { name: /设置|Settings/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Wheel over the settings surface (its own scroll region) — the pill
    // is behind the modal and the section never changes.
    const dialog = page.getByRole("dialog");
    const box = await dialog.boundingBox();
    await wheelAt(page, box!.x + box!.width - 30, box!.y + 120, 600);
    await page.waitForTimeout(300);
    expect(await activeSectionName(page)).toBe("Alpha");
    await expect(dialog).toBeVisible();
  });
});
