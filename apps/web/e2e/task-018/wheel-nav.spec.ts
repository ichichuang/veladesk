import { expect, test } from "@playwright/test";

import {
  activeSectionName,
  bootIntoWorkspace,
  failOnConsoleError,
  railRoot,
  railItem,
  seedUniqueWorkspace,
  wheelAt,
  wheelDetents,
  wheelFlick,
} from "./helpers";
import { TWO_SECTIONS, thirtySections } from "../fixtures/seed";

/**
 * Task 018 full-left-column wheel navigation (synthetic input streams).
 *
 * Contracts under test: the ENTIRE rail column owns wheel navigation
 * (titles, gaps, blank space below); one deliberate gesture = one step;
 * momentum tails do not cascade; reversals respond promptly; the right
 * side scrolls its own section only; navigation never writes revisions.
 */

test.beforeEach(async ({ page }) => {
  failOnConsoleError(page);
});

test.describe("two-section fixture — full-column hit coverage", () => {
  test("wheel over the title, between titles and the blank bottom all navigate", async ({
    page,
    request,
  }) => {
    await seedUniqueWorkspace(request, "wheel-2", TWO_SECTIONS);
    await bootIntoWorkspace(page, "Desk wheel-2");
    await expect(railItem(page, "Alpha")).toBeVisible();

    const box = await railRoot(page).boundingBox();
    expect(box).not.toBeNull();

    // 1. Directly over the active title.
    await wheelAt(page, box!.x + 40, box!.y + 60, 120);
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Beta");

    // 2. Between the two titles (a gap, not a button).
    const alphaBox = await railItem(page, "Alpha").boundingBox();
    const betaBox = await railItem(page, "Beta").boundingBox();
    const betweenY = (alphaBox!.y + alphaBox!.height + betaBox!.y) / 2;
    await wheelAt(page, box!.x + 40, betweenY, -120);
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Alpha");

    // 3. Far below the last title — blank rail space, no click, no focus.
    await wheelAt(page, box!.x + 40, box!.y + box!.height - 30, 120);
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Beta");
  });

  test("a flick with a long decaying tail advances exactly one section", async ({
    page,
    request,
  }) => {
    await seedUniqueWorkspace(request, "wheel-flick", TWO_SECTIONS);
    await bootIntoWorkspace(page, "Desk wheel-flick");

    const box = await railRoot(page).boundingBox();
    await wheelFlick(page, box!.x + 40, box!.y + 80, true);
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Beta");
    // The tail is swallowed: still Beta after everything settles.
    await page.waitForTimeout(600);
    expect(await activeSectionName(page)).toBe("Beta");

    // At the end of the list, further down-intent stays put (no wrap).
    await wheelFlick(page, box!.x + 40, box!.y + 80, true);
    await page.waitForTimeout(300);
    expect(await activeSectionName(page)).toBe("Beta");
  });

  test("a reversal during motion pages back promptly", async ({ page, request }) => {
    await seedUniqueWorkspace(request, "wheel-rev", TWO_SECTIONS);
    await bootIntoWorkspace(page, "Desk wheel-rev");

    const box = await railRoot(page).boundingBox();
    const x = box!.x + 40;
    const y = box!.y + 80;

    // Down flick, then an immediate deliberate up push mid-tail.
    await page.mouse.move(x, y);
    for (const magnitude of [40, 45, 38, 30, 24]) {
      await page.mouse.wheel(0, magnitude);
      await page.waitForTimeout(12);
    }
    for (const magnitude of [30, 24, 18]) {
      await page.mouse.wheel(0, -magnitude);
      await page.waitForTimeout(12);
    }
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Alpha");
  });

  test("chained deliberate detents advance one section per detent", async ({
    page,
    request,
  }) => {
    const sections = [
      TWO_SECTIONS[0]!,
      TWO_SECTIONS[1]!,
      { id: "page-gamma", name: "Gamma3", apps: [] },
    ];
    await seedUniqueWorkspace(request, "wheel-detents", sections);
    await bootIntoWorkspace(page, "Desk wheel-detents");

    const box = await railRoot(page).boundingBox();
    await wheelDetents(page, box!.x + 40, box!.y + 80, true, 2);
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

    const box = await railRoot(page).boundingBox();
    await page.mouse.move(box!.x + 40, box!.y + 80);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 240);
    await page.keyboard.up("Control");
    await page.waitForTimeout(300);
    expect(await activeSectionName(page)).toBe("Alpha");
  });

  test("a distant title click selects it directly, no queuing", async ({
    page,
    request,
  }) => {
    await seedUniqueWorkspace(request, "wheel-click", TWO_SECTIONS);
    await bootIntoWorkspace(page, "Desk wheel-click");

    await railItem(page, "Beta").click();
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Beta");
  });

  test("navigation writes no workspace revision", async ({ page, request }) => {
    const id = await seedUniqueWorkspace(request, "wheel-revcount", TWO_SECTIONS);
    await bootIntoWorkspace(page, "Desk wheel-revcount");

    const before = await (await request.get(`/api/v1/workspaces/${id}`)).json();
    const box = await railRoot(page).boundingBox();
    await wheelAt(page, box!.x + 40, box!.y + 80, 120);
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Beta");
    const after = await (await request.get(`/api/v1/workspaces/${id}`)).json();
    expect(after.workspace.revision).toBe(before.workspace.revision);
  });
});

test.describe("thirty-section fixture — bounds and inertia", () => {
  test("continued deliberate input pages through, bounded and without cascades", async ({
    page,
    request,
  }) => {
    await seedUniqueWorkspace(request, "wheel-30", thirtySections());
    await bootIntoWorkspace(page, "Desk wheel-30");

    const box = await railRoot(page).boundingBox();
    const x = box!.x + 40;
    const y = box!.y + 80;

    // One flick = one step even in a long list.
    await wheelFlick(page, x, y, true);
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Section 02");

    // Continued deliberate detents walk further (5 detents → 07).
    await wheelDetents(page, x, y, true, 5);
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Section 07");

    // Up works and clamps at the first section.
    await wheelDetents(page, x, y, false, 20);
    await expect
      .poll(() => activeSectionName(page), { timeout: 8_000 })
      .toBe("Section 01");
  });

  test("leaving and re-entering the rail restarts wheel navigation cleanly", async ({
    page,
    request,
  }) => {
    await seedUniqueWorkspace(request, "wheel-reenter", thirtySections());
    await bootIntoWorkspace(page, "Desk wheel-reenter");

    const box = await railRoot(page).boundingBox();
    await wheelAt(page, box!.x + 40, box!.y + 80, 120);
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Section 02");

    // Leave the rail entirely, idle, come back — no stale lock.
    await page.mouse.move(900, 600);
    await page.waitForTimeout(400);
    await wheelAt(page, box!.x + 40, box!.y + 80, 120);
    await expect
      .poll(() => activeSectionName(page), { timeout: 5_000 })
      .toBe("Section 03");
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

    const scroller = page.locator(".vela-section-view[data-active-section='true'] .vela-section-scroller");
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

    await page.mouse.click(700, 450, { button: "right" });
    await page.getByRole("menuitem", { name: /设置|Settings/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Wheel over the settings surface (its own scroll region) — the rail
    // is behind the modal and the section never changes.
    const dialog = page.getByRole("dialog");
    const box = await dialog.boundingBox();
    await wheelAt(page, box!.x + box!.width - 30, box!.y + 120, 600);
    await page.waitForTimeout(300);
    expect(await activeSectionName(page)).toBe("Alpha");
    await expect(dialog).toBeVisible();
  });
});
