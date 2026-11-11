import { expect, test } from "@playwright/test";

import { buildGridSnapshot, seedWorkspace, type SeedSectionSpec } from "../fixtures/seed";
import {
  activeSectionName,
  appContextMenu,
  bootIntoWorkspace,
  dirtyEditorDraft,
  escapeDialog,
  failOnConsoleError,
  pillRoot,
  wheelFlick,
} from "../task-018/helpers";
import { captureGeometry, workbenchViolations } from "./geometry";

/**
 * Task 019-A stress: TEN full long-session cycles in ONE browser page —
 * no reload, no context reset between cycles. Each cycle runs the
 * overlay-heavy journey (settings tabs + cancel, appearance editor
 * cancel, arrange gap/drag/resize, exit, rail wheel navigation) and then
 * asserts the geometry health of the stage:
 *
 *   - workbench origin (0,0) ± 0.5px and full viewport size;
 *   - the rail fully inside the viewport;
 *   - the settings modal horizontally centered on the viewport while open;
 *   - zero document scroll, zero latched desktop scroll;
 *   - no pointer-events:none residue on the interaction surfaces;
 *   - no transform residue on the workbench.
 */

const CYCLES = 10;

const WORKSPACE_NAME = "Desk 019 Stress";

const SECTIONS: readonly SeedSectionSpec[] = [
  {
    id: "page-home",
    name: "Home",
    apps: [
      { id: "app-one", name: "Alpha", url: "https://alpha.example" },
      { id: "app-two", name: "Beta", url: "https://beta.example" },
    ],
  },
  {
    id: "page-second",
    name: "Second",
    apps: [{ id: "app-three", name: "Gamma", url: "https://gamma.example" }],
  },
];

async function desktopMenuAction(
  page: import("@playwright/test").Page,
  name: RegExp,
): Promise<void> {
  await page.mouse.click(20, 500, { button: "right" });
  await page.getByRole("menuitem", { name }).first().click();
}

/** Enters arrange mode through the desktop menu (idempotent — the fixture
 *  may already boot arranged when layoutLocked is false). */
async function enterArrangeMode(page: import("@playwright/test").Page): Promise<void> {
  if ((await page.locator(".vela-desktop").getAttribute("data-arrange")) !== "true") {
    await desktopMenuAction(page, /整理桌面|Arrange/);
  }
  await expect(page.locator(".vela-desktop")).toHaveAttribute("data-arrange", "true");
}

interface CycleHealth {
  cycle: number;
  captureLabel: string;
  violations: ReturnType<typeof workbenchViolations>;
  railOnScreen: boolean;
  railDetail: string;
  bodyScroll: { left: number; top: number };
  pointerEvents: Record<string, string>;
  workbenchTransform: string;
}

async function assertCycleHealth(page: import("@playwright/test").Page, cycle: number): Promise<void> {
  const label = `cycle ${cycle} post-journey`;
  const capture = await captureGeometry(page, label);
  const violations = workbenchViolations(capture);
  const rail = capture.rects[".vela-pill"] ?? null;
  const railOnScreen =
    rail !== null &&
    rail.x >= -0.5 &&
    rail.y >= -0.5 &&
    rail.x + rail.width <= capture.viewport.width + 0.5 &&
    rail.y + rail.height <= capture.viewport.height + 0.5;
  const health: CycleHealth = {
    cycle,
    captureLabel: label,
    violations,
    railOnScreen,
    railDetail: rail ? `(${rail.x.toFixed(1)}, ${rail.y.toFixed(1)}) ${rail.width.toFixed(1)}×${rail.height.toFixed(1)}` : "null",
    bodyScroll: capture.documentScroll,
    pointerEvents: {},
    workbenchTransform: "unknown",
  };

  const residue = await page.evaluate(() => {
    const read = (selector: string): string => {
      const el = document.querySelector(selector);
      return el ? getComputedStyle(el).pointerEvents : "missing";
    };
    const workbench = document.querySelector(".vela-workbench");
    return {
      pointerEvents: {
        ".vela-desktop": read(".vela-desktop"),
        ".vela-workbench": read(".vela-workbench"),
        ".vela-pill": read(".vela-pill"),
        ".vela-workspace": read(".vela-workspace"),
      },
      workbenchTransform: workbench ? getComputedStyle(workbench).transform : "missing",
    };
  });
  health.pointerEvents = residue.pointerEvents;
  health.workbenchTransform = residue.workbenchTransform;

  expect(violations, JSON.stringify(health, null, 2)).toEqual([]);
  expect(health.railOnScreen, health.railDetail).toBe(true);
  expect(capture.documentScroll).toEqual({ left: 0, top: 0 });
  for (const [selector, value] of Object.entries(health.pointerEvents)) {
    expect(value, `${selector} pointer-events`).not.toBe("none");
  }
  expect(health.workbenchTransform).toBe("none");
}

test("ten continuous cycles stay geometrically stable", async ({ page, request }) => {
  // A ten-cycle journey outruns the default 60s budget on a loaded box.
  test.setTimeout(300_000);
  failOnConsoleError(page);

  const snapshot = buildGridSnapshot("ws-019-stress", WORKSPACE_NAME, SECTIONS);
  (snapshot.preferences as Record<string, unknown>).layoutLocked = false;
  await seedWorkspace(request, snapshot);
  await bootIntoWorkspace(page, WORKSPACE_NAME);
  await expect(page.locator(".vela-item", { hasText: "Alpha" })).toBeVisible();

  for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
    // --- Settings: tabs + escape -------------------------------------
    await desktopMenuAction(page, /设置…|Settings/);
    const settings = page.getByRole("dialog");
    await settings.waitFor({ state: "visible", timeout: 10_000 });
    // Modal centering WHILE OPEN: the dialog surface stays centered on the
    // viewport even though earlier cycles ran.
    const centered = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return { ok: false, detail: "dialog missing" };
      const { x, y, width, height } = dialog.getBoundingClientRect();
      const cx = x + width / 2;
      const cy = y + height / 2;
      const vx = window.innerWidth / 2;
      const vy = window.innerHeight / 2;
      return {
        ok: Math.abs(cx - vx) <= 1 && Math.abs(cy - vy) <= 1,
        detail: `center (${cx.toFixed(1)}, ${cy.toFixed(1)}) vs viewport (${vx.toFixed(1)}, ${vy.toFixed(1)})`,
      };
    });
    expect(centered.ok, centered.detail).toBe(true);
    for (const tab of [/布局|Layout/, /通用|General/, /外观|Appearance/]) {
      await settings.getByRole("tab", { name: tab }).click();
      await page.waitForTimeout(260);
    }
    // Accent is swatch-first in 019-D: dirty the draft with a swatch pick.
    await settings.getByRole("button", { name: /翠绿|Emerald/ }).click();
    await escapeDialog(page);

    // --- Appearance editor: edit + cancel ----------------------------
    await appContextMenu(page, "Alpha", /编辑外观|Edit appearance/);
    const editor = page.getByRole("dialog");
    await editor.waitFor({ state: "visible", timeout: 10_000 });
    await dirtyEditorDraft(page);
    await escapeDialog(page);

    // --- Arrange: gap, drag, resize, exit -----------------------------
    await enterArrangeMode(page);
    await expect(page.getByRole("toolbar")).toBeVisible();
    const gapStep = page.locator(".vela-arrange-bar__gap-step").last();
    if (await gapStep.isDisabled()) {
      // A previous cycle already maxed the gap — the step is a no-op then.
    } else {
      await gapStep.click();
    }
    await page.waitForTimeout(400);

    const tile = page.locator(".vela-item", { hasText: "Alpha" }).first();
    const box = await tile.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 220, box!.y + 160, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    // Handles ride the single-app SELECTION — click the tile first (a
    // previous step may have cleared or moved the selection).
    await tile.click({ force: true });
    await expect(tile).toHaveAttribute("data-selected", "true");
    const handle = tile.locator('.vela-item__resize-handle[data-handle="se"]');
    await expect(handle).toBeVisible();
    const handleBox = await handle.boundingBox();
    await page.mouse.move(handleBox!.x + 4, handleBox!.y + 4);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + 154, handleBox!.y + 12, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    await desktopMenuAction(page, /退出整理|Exit arrange/);
    await expect(page.getByRole("toolbar")).toBeHidden();

    // --- Rail wheel navigation ----------------------------------------
    await page.evaluate(() => window.scrollTo(0, 0));
    const rail = await pillRoot(page).boundingBox();
    expect(rail).not.toBeNull();
    await wheelFlick(page, rail!.x + 40, rail!.y + rail!.height / 2, true);
    await expect.poll(() => activeSectionName(page), { timeout: 10_000 }).toBe("Second");
    await page.evaluate(() => window.scrollTo(0, 0));
    const railAgain = await pillRoot(page).boundingBox();
    expect(railAgain).not.toBeNull();
    await wheelFlick(page, railAgain!.x + 40, railAgain!.y + railAgain!.height / 2, false);
    await expect.poll(() => activeSectionName(page), { timeout: 10_000 }).toBe("Home");

    // --- Health gate for THIS cycle ------------------------------------
    await assertCycleHealth(page, cycle);
  }

  // Final sanity after all ten cycles.
  expect(await page.locator("[data-dragging='true']").count()).toBe(0);
});
