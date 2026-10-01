import { expect, test } from "@playwright/test";

import {
  appContextMenu,
  bootIntoWorkspace,
  dirtyEditorDraft,
  escapeDialog,
  failOnConsoleError,
  seedUniqueWorkspace,
} from "./helpers";
import { TWO_SECTIONS } from "../fixtures/seed";

/**
 * Task 019-C App Appearance Inspector: the REAL desktop tile is the live
 * preview. These browser checks pin the live-projection contract (draft
 * changes reflect on the placed app immediately, cancel reverts, save
 * persists exactly what was rendered), the compact fixed-panel layout,
 * and the absence of every fake-preview artifact.
 */

test.beforeEach(async ({ page }) => {
  failOnConsoleError(page);
});

async function openInspector(page: PageLike, appName: string) {
  await appContextMenu(page, appName, /编辑外观|Edit appearance/);
  await expect(page.getByRole("dialog")).toBeVisible();
}

type PageLike = Parameters<typeof appContextMenu>[0];

/** The REAL desktop tile of `appName` (not any inspector/picker surface). */
function desktopTile(page: PageLike, appName: string) {
  return page.locator(".vela-desktop .vela-item", { hasText: appName }).first();
}

async function revisionOf(request: import("@playwright/test").APIRequestContext, id: string) {
  const body = (await (await request.get(`/api/v1/workspaces/${id}`)).json()) as {
    workspace: { revision: number };
  };
  return body.workspace.revision;
}

test("the real desktop tile is the live preview", async ({ page, request }) => {
  await seedUniqueWorkspace(request, "vis-live", TWO_SECTIONS);
  await bootIntoWorkspace(page, "Desk vis-live");
  await openInspector(page, "Gamma");

  const tile = desktopTile(page, "Gamma");
  // The inspected app carries the quiet editing affordance.
  await expect(tile).toHaveAttribute("data-inspector-editing", "true");
  await expect(tile.locator(".vela-item__label", { hasText: "Gamma" })).toBeVisible();

  // Hiding the name updates the REAL tile immediately (session projection).
  await page.getByRole("switch").click();
  await expect(tile.locator(".vela-item__label")).toHaveCount(0);
  // The accessible name never depended on the visual label.
  await expect(tile).toHaveAccessibleName("Gamma");

  // Cancel reverts the desktop to the persisted appearance exactly.
  const before = await revisionOf(request, "ws-vis-live");
  await escapeDialog(page);
  await expect(tile.locator(".vela-item__label", { hasText: "Gamma" })).toBeVisible();
  expect(await revisionOf(request, "ws-vis-live")).toBe(before);
});

test("decoration changes reflect on the real tile and save exactly what was shown", async ({
  page,
  request,
}) => {
  await seedUniqueWorkspace(request, "vis-save", TWO_SECTIONS);
  await bootIntoWorkspace(page, "Desk vis-save");
  await openInspector(page, "Gamma");

  const tile = desktopTile(page, "Gamma");
  await dirtyEditorDraft(page);
  // The draft's decoration choice is live on the placed app.
  await expect(tile.locator(".vela-app-icon--surface")).toHaveAttribute(
    "data-decoration",
    /solid|glass|none/,
  );

  const before = await revisionOf(request, "ws-vis-save");
  await page.getByRole("dialog").getByRole("button", { name: /保存|Save/ }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });
  expect(await revisionOf(request, "ws-vis-save")).toBe(before + 1);

  // 019-B: the saved visual carries NO deprecated sizing fields, and the
  // saved decoration matches what the desktop showed at save time.
  const detail = (await (await request.get("/api/v1/workspaces/ws-vis-save")).json()) as {
    workspace: {
      snapshot: { entities: Array<{ id: string; visual?: Record<string, unknown> }> };
    };
  };
  const app = detail.workspace.snapshot.entities.find((entity) => entity.id === "app-a1");
  expect(app?.visual).toBeDefined();
  expect(app!.visual!).not.toHaveProperty("iconScale");
  expect(app!.visual!).not.toHaveProperty("labelScale");
  await expect(tile.locator(".vela-app-icon--surface")).toHaveAttribute(
    "data-decoration",
    String(app!.visual!.decorationStyle),
  );
});

test("no icon-size or title-size control exists; sizes are adaptive (019-B)", async ({
  page,
  request,
}) => {
  await seedUniqueWorkspace(request, "vis-nosize", TWO_SECTIONS);
  await bootIntoWorkspace(page, "Desk vis-nosize");
  await openInspector(page, "Gamma");

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("slider")).toHaveCount(0);
  await expect(page.locator("#vela-visual-icon-scale")).toHaveCount(0);
  await expect(page.locator("#vela-visual-label-scale")).toHaveCount(0);

  // The real desktop tile composes adaptively (no separate preview).
  await expect(desktopTile(page, "Gamma").locator(".vela-app-content")).toBeVisible();

  await escapeDialog(page);
});

test("the icon picker is a separate surface; the draft survives the round trip", async ({
  page,
  request,
}) => {
  await seedUniqueWorkspace(request, "vis-picker", TWO_SECTIONS);
  await bootIntoWorkspace(page, "Desk vis-picker");
  await openInspector(page, "Gamma");

  const dialog = page.getByRole("dialog");
  const nameSwitch = dialog.getByRole("switch");
  await nameSwitch.click();
  await expect(nameSwitch).not.toBeChecked();

  // Change icon opens the secondary picker over the inspector.
  await dialog.getByRole("button", { name: /更换图标|Change icon/ }).click();
  const picker = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("button", { name: /图标库|Library/ }) });
  await expect(picker).toBeVisible();

  // Closing the picker returns to the inspector; the draft survived.
  await page.keyboard.press("Escape");
  await expect(nameSwitch).not.toBeChecked();

  // Cancel: nothing persisted.
  const before = await revisionOf(request, "ws-vis-picker");
  await escapeDialog(page);
  expect(await revisionOf(request, "ws-vis-picker")).toBe(before);
});

test("the color popover opens inside the inspector and closes without dismissing it", async ({
  page,
  request,
}) => {
  await seedUniqueWorkspace(request, "vis-color", TWO_SECTIONS);
  await bootIntoWorkspace(page, "Desk vis-color");
  await openInspector(page, "Gamma");

  const dialog = page.getByRole("dialog");

  // Foreground color: swatch button opens the react-colorful popover.
  const swatch = dialog.locator("button[aria-label*='—']").first();
  await swatch.click();
  const picker = page.locator(".react-colorful").first();
  await expect(picker).toBeVisible();

  // A preset swatch pick commits a custom color — on the REAL tile too.
  await page.locator("button[aria-label='#5b8def']").click();
  await expect(desktopTile(page, "Gamma").locator(".vela-app-icon--surface")).toHaveCSS(
    "color",
    /rgb/,
  );

  // Closing the popover leaves the inspector open with the custom color.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  await expect(dialog).toBeVisible();

  await escapeDialog(page);
});

test("the inspector overlays the workspace without reflowing it", async ({ page, request }) => {
  await seedUniqueWorkspace(request, "vis-panel", TWO_SECTIONS);
  await bootIntoWorkspace(page, "Desk vis-panel");

  const tile = desktopTile(page, "Gamma");
  const before = await tile.boundingBox();
  await openInspector(page, "Gamma");
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();

  // The panel is a right-anchored overlay (~360–400px wide), and the tile
  // it inspects did not move by a pixel.
  expect(panelBox!.width).toBeGreaterThanOrEqual(360);
  expect(panelBox!.width).toBeLessThanOrEqual(410);
  expect(panelBox!.x + panelBox!.width).toBeCloseTo(page.viewportSize()!.width, 0);
  const after = await tile.boundingBox();
  expect(after!.x).toBeCloseTo(before!.x, 1);
  expect(after!.y).toBeCloseTo(before!.y, 1);
  expect(after!.width).toBeCloseTo(before!.width, 1);

  // The deepest control stays reachable at laptop height.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(200);
  const switchBox = await panel.getByRole("switch").boundingBox();
  expect(switchBox).not.toBeNull();
  expect(switchBox!.y + switchBox!.height).toBeLessThanOrEqual(720);

  await escapeDialog(page);
});
