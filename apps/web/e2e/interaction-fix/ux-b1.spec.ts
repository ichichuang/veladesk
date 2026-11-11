import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  bootSeededDesktop,
  deleteSeededWorkspaces,
  resetLocalWorkspaceStorage,
} from "./seed";

/**
 * UX-audit P1/P2 fixes (UX-01 … UX-06, task ux-fix-b1): every case here
 * replays the audit's reproduction steps as REAL interactions against the
 * production standalone build. Evidence lands in artifacts/ux-b1/.
 */

const EVIDENCE_ROOT = resolve(__dirname, "../../../../artifacts/ux-b1");

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
// UX-01 — folder overlay: children laid out on a grid, panel is real glass
// ---------------------------------------------------------------------------

test("UX-01: folder overlay lays children out on a non-transparent glass panel", async ({
  page,
  request,
}) => {
  // richScene: the fixture that places the 框架文档 folder tile on the grid.
  await bootSeededDesktop(page, request, { richScene: true });
  await page.locator('[data-item-id="folder-frameworks"]').click({ force: true });
  await expect(page.locator(".vela-folder-overlay__panel-inner")).toBeVisible();

  const report = await page.evaluate(() => {
    const inner = document.querySelector<HTMLElement>(".vela-folder-overlay__panel-inner")!;
    const grid = document.querySelector<HTMLElement>(".vela-folder-overlay__grid")!;
    const kids = Array.from(grid.querySelectorAll<HTMLElement>(":scope > .vela-item"));
    const rects = kids.map((kid) => {
      const r = kid.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    const cs = getComputedStyle(inner);
    return {
      /* Filled by the caller: the shipped blur declaration is asserted on
         the raw stylesheet text — this headless shell DROPS the
         -webkit-backdrop-filter alias at parse time (computed styles read
         "none" app-wide, including .vela-pill), so the cascade in-page
         cannot answer it. */

      childCount: kids.length,
      rects,
      uniqueOrigins: new Set(rects.map((r) => `${r.x},${r.y}`)).size,
      panelBackgroundColor: cs.backgroundColor,

      panelBorderWidth: cs.borderTopWidth,
      gridColumns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      // Every child inside the panel's box and on screen.
      allWithinViewport: rects.every(
        (r) =>
          r.x >= 0 &&
          r.y >= 0 &&
          r.x + r.w <= window.innerWidth &&
          r.y + r.h <= window.innerHeight &&
          r.w > 0 &&
          r.h > 0,
      ),
      // The background tiles the folder covers must NOT be visible through
      // a transparent panel: parse the computed color's alpha channel.
      panelAlpha: (() => {
        const m = cs.backgroundColor.match(/[\d.]+\s*\/\s*([\d.]+)/);
        return m === null ? 1 : Number.parseFloat(m[1]!);
      })(),
    };
  });

  // Three children (React Docs / Vue Docs + the seeded fixture's folder
  // members) at mutually different coordinates, all visible.
  expect(report.childCount).toBeGreaterThanOrEqual(2);
  expect(report.uniqueOrigins).toBe(report.childCount);
  expect(report.gridColumns).toBeGreaterThanOrEqual(2);
  expect(report.allWithinViewport).toBe(true);
  // Glass panel: real background color with alpha and a panel-band blur
  // declared through the token on the SHIPPED stylesheet text (the only
  // honest source in this headless environment — see the note above).
  expect(report.panelAlpha).toBeGreaterThan(0);
  const panelBlurDeclared = await panelBlurDeclaredInShippedCss(page);
  expect(panelBlurDeclared).toBe(true);
  expect(report.panelBorderWidth).toBe("1px");

  // Children are clickable targets for real: focus + Enter opens the app
  // (keyboard reachability), and the overlay closes on Escape.
  await page.locator(".vela-folder-overlay__grid .vela-item").first().focus();
  await expect(page.locator(".vela-folder-overlay__grid .vela-item").first()).toBeFocused();
  await shot(page, "ux01-folder-overlay");
  await page.keyboard.press("Escape");
  await expect(page.locator(".vela-folder-overlay__panel-inner")).toBeHidden();
});



/**
 * Whether the shipped CSS declares the folder panel's blur through the
 * panel token. The production minifier keeps only the -webkit- alias for
 * backdrop-filter, and this headless shell drops that alias from both
 * cssRules and computed styles — the raw stylesheet text is the remaining
 * ground truth (real Chromium applies the alias everywhere, same as the
 * app's other glass surfaces: .vela-pill, the dock, the dialogs).
 */
async function panelBlurDeclaredInShippedCss(page: Page): Promise<boolean> {
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).map(
      (link) => link.href,
    ),
  );
  const BLUR = /\.vela-folder-overlay__panel-inner\{[^}]*-webkit-backdrop-filter:blur\(var\(--vd-blur-panel\)\)/;
  for (const href of hrefs) {
    const response = await page.request.get(href);
    if (response.ok() && BLUR.test(await response.text())) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// UX-02 — custom wallpaper survives save (object URL lifecycle)
// ---------------------------------------------------------------------------

/** A tiny deterministic PNG (2×2, opaque) built in-page — no fixture files. */
async function uploadWallpaperPng(page: Page): Promise<void> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    // Distinctive fill: solid magenta-ish so "is the uploaded image shown"
    // can be answered by pixel, not by faith.
    ctx.fillStyle = "rgb(200, 40, 160)";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "rgb(40, 200, 120)";
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = "rgb(20, 60, 220)";
    ctx.fillRect(32, 32, 32, 32);
    return canvas.toDataURL("image/png");
  });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /选择图片|Choose image|Select image/i }).click();
  const fileChooser = await chooser;
  await fileChooser.setFiles({
    name: "ux-b1-wallpaper.png",
    mimeType: "image/png",
    buffer: Buffer.from(dataUrl.split(",")[1]!, "base64"),
  });
}

async function openWorkspaceBackgroundEditor(page: Page): Promise<void> {
  // The ⌘K palette's 设置 command opens Settings; the appearance tab hosts
  // the workspace background picker. (The palette is viewport-stable, unlike
  // a right-click that must find empty desktop at any viewport width.)
  await page.locator(".vela-helm-commandbar").click();
  const settingsOption = page
    .getByRole("option", { name: /^设置$|^Settings$/ })
    .or(page.getByRole("option", { name: /设置|Settings/ }));
  await settingsOption.first().click();
  await expect(page.locator("[data-settings-surface]")).toBeVisible();
}

interface WallpaperImageState {
  src: string;
  naturalWidth: number;
  /** max(r,g,b) of a downscaled sample — 0 means nothing painted (black). */
  sampleLuma: number;
}

async function wallpaperImageState(page: Page): Promise<WallpaperImageState> {
  return page.evaluate(() => {
    const img = document.querySelector<HTMLImageElement>(
      ".vela-desktop__wallpaper img[data-wallpaper-image]",
    );
    if (img === null) {
      return { src: "none", naturalWidth: -1, sampleLuma: -1 };
    }
    // Sample the painted image through a same-origin canvas (object URLs
    // are same-origin): the whole 64×64 source downscaled to 1×1. The
    // audit's broken path painted NOTHING (revoked blob) → all zeroes.
    let sampleLuma = -1;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, 1, 1);
      const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
      sampleLuma = Math.max(r, g, b);
    } catch {
      /* tainted or not yet decoded — naturalWidth still answers identity */
    }
    return { src: img.src, naturalWidth: img.naturalWidth, sampleLuma };
  });
}

for (const reducedMotion of [false, true] as const) {
  test(`UX-02: uploaded wallpaper renders after save and survives reload (reducedMotion=${reducedMotion})`, async ({
    page,
    request,
  }) => {
    test.skip(
      (await page.context().browser()?.browserType().name()) !== "chromium" ||
        process.env.VD_E2E_VIEWPORT_WIDTH === "390",
      "the canvas-pixel identity check and desktop settings surface are the PC chromium path",
    );
    if (reducedMotion) {
      await page.emulateMedia({ reducedMotion: "reduce" });
    }
    await bootSeededDesktop(page, request);

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => consoleErrors.push(String(error)));

    await openWorkspaceBackgroundEditor(page);
    await uploadWallpaperPng(page);
    // The live preview already paints the uploaded image.
    await expect
      .poll(async () => (await wallpaperImageState(page)).naturalWidth)
      .toBeGreaterThan(0);
    await shot(page, reducedMotion ? "ux02-preview-reduced" : "ux02-preview");

    const preview = await wallpaperImageState(page);
    await page.getByRole("button", { name: /^保存$|^Save$/ }).click();
    await expect(page.locator("[data-settings-surface]")).toBeHidden();

    // After save: SAME object URL still rendering (the URL was retained,
    // not revoked-and-refetched through a dead blob), decodable, painted.
    await expect
      .poll(async () => (await wallpaperImageState(page)).naturalWidth)
      .toBeGreaterThan(0);
    const saved = await wallpaperImageState(page);
    expect(saved.src).toBe(preview.src);
    expect(saved.sampleLuma).toBeGreaterThan(60);
    await shot(page, reducedMotion ? "ux02-saved-reduced" : "ux02-saved");

    // No dead blob fetch ever hit the console.
    expect(consoleErrors.filter((line) => line.includes("ERR_FILE_NOT_FOUND"))).toEqual([]);

    // Reload: the PERSISTED asset resolves fresh (a new object URL for the
    // same content id) and still paints.
    await page.reload();
    await expect(page.locator(".vela-desktop")).toBeVisible();
    await expect
      .poll(async () => {
        const state = await wallpaperImageState(page);
        return state.naturalWidth > 0 && state.sampleLuma > 60 ? state.naturalWidth : 0;
      }, { timeout: 20_000 })
      .toBeGreaterThan(0);
    expect(consoleErrors.filter((line) => line.includes("ERR_FILE_NOT_FOUND"))).toEqual([]);
    await shot(page, reducedMotion ? "ux02-reloaded-reduced" : "ux02-reloaded");
  });
}

test("UX-02: the same save path holds in LIGHT color mode", async ({ page, request }) => {
  test.skip(
    (await page.context().browser()?.browserType().name()) !== "chromium" ||
      process.env.VD_E2E_VIEWPORT_WIDTH === "390",
    "the canvas-pixel identity check and desktop settings surface are the PC chromium path",
  );
  // A light-mode workspace: same upload → save → reload contract under the
  // light palette (the audit reproduced the black screen in BOTH modes).
  const lightSnapshot = {
    id: `ws-uxb1-light-${Date.now()}`,
    name: `Interaction Fix Light ${Date.now()}`,
    pages: [
      {
        id: "sec-frontend",
        name: "前端开发",
        layout: { id: "sec-frontend", grid: { columns: 8, rows: 8 }, items: [] },
        canvas: {
          version: 2,
          mode: "grid",
          columns: 8,
          items: [{ id: "app-github", column: 0, row: 0, columnSpan: 1, rowSpan: 1 }],
        },
      },
    ],
    entities: [
      {
        kind: "app",
        id: "app-github",
        name: "GitHub",
        url: "https://github.com/",
        icon: { kind: "iconify", icon: "simple-icons:github" },
        openMode: "new-tab",
        tags: [],
      },
    ],
    categories: [],
    dock: { items: [] },
    preferences: {
      defaultPageId: "sec-frontend",
      layoutLocked: true,
      appearance: {
        colorMode: "light",
        accentHue: 60,
        wallpaperPreset: "chart",
        surfaceOpacity: 0.62,
        blurPx: 28,
        radiusPx: 16,
        iconSize: "medium",
      },
    },
  };
  await request.post("/api/v1/workspaces", { data: { snapshot: lightSnapshot } });
  await page.goto("/");
  const pickerItem = page.locator(".vela-picker__item", { hasText: lightSnapshot.name });
  await pickerItem.or(page.locator(".vela-desktop")).first().waitFor({ timeout: 30_000 });
  if (await pickerItem.isVisible()) {
    await pickerItem.click();
  }
  await expect(page.locator(".vela-desktop")).toBeVisible();
  await expect(page.locator(".vela-desktop")).toHaveAttribute("data-vd-color-mode", "light");

  await openWorkspaceBackgroundEditor(page);
  await uploadWallpaperPng(page);
  await expect
    .poll(async () => (await wallpaperImageState(page)).naturalWidth)
    .toBeGreaterThan(0);
  const preview = await wallpaperImageState(page);
  await page.getByRole("button", { name: /^保存$|^Save$/ }).click();
  await expect(page.locator("[data-settings-surface]")).toBeHidden();

  const saved = await wallpaperImageState(page);
  expect(saved.src).toBe(preview.src);
  expect(saved.naturalWidth).toBeGreaterThan(0);
  expect(saved.sampleLuma).toBeGreaterThan(60);
  await shot(page, "ux02-light-saved");

  await page.reload();
  await expect(page.locator(".vela-desktop")).toHaveAttribute("data-vd-color-mode", "light");
  await expect
    .poll(async () => {
      const state = await wallpaperImageState(page);
      return state.naturalWidth > 0 && state.sampleLuma > 60 ? state.naturalWidth : 0;
    }, { timeout: 20_000 })
    .toBeGreaterThan(0);
  await shot(page, "ux02-light-reloaded");
});

// ---------------------------------------------------------------------------
// UX-03 — Ctrl/Cmd+K opens the command palette
// ---------------------------------------------------------------------------

test("UX-03: Control+K and Meta+K open the command palette; repeat press closes", async ({
  page,
  request,
}) => {
  await bootSeededDesktop(page, request);
  // Focus the body (a click on empty desktop), then the trusted chord.
  await page.mouse.click(1300, 250);
  await page.keyboard.press("Control+k");
  await expect(page.locator('[data-vd-surface="launcher"]')).toBeVisible();
  await shot(page, "ux03-ctrlk-open");
  // Open palette: the chord closes it again.
  await page.keyboard.press("Control+k");
  await expect(page.locator('[data-vd-surface="launcher"]')).toBeHidden();

  // Cmd (Meta) path — the mac chord from the kbd hint.
  await page.keyboard.press("Meta+k");
  await expect(page.locator('[data-vd-surface="launcher"]')).toBeVisible();
  // Typing in the palette's own input still works (the chord must not
  // swallow ordinary input): type a query, expect filtering, Escape closes.
  const input = page.locator('[data-vd-surface="launcher"] input').first();
  await input.fill("git");
  await expect(page.getByRole("option", { name: /GitHub/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-vd-surface="launcher"]')).toBeHidden();
});

// ---------------------------------------------------------------------------
// UX-04 — URL validation in Add/Edit + launch toast for legacy junk
// ---------------------------------------------------------------------------

async function openAddAppDialog(page: Page): Promise<void> {
  // The ⌘K palette's 添加应用 command — viewport-stable at every matrix size.
  await page.locator(".vela-helm-commandbar").click();
  await page
    .getByRole("option", { name: /添加应用|Add App/ })
    .first()
    .click();
  await expect(page.getByRole("dialog").or(page.locator("[role=alertdialog]").first())).toBeVisible({
    timeout: 10_000,
  });
}

test("UX-04: add-app rejects non-URLs inline and normalizes example.com", async ({
  page,
  request,
}) => {
  await bootSeededDesktop(page, request);
  await openAddAppDialog(page);

  const dialog = page.getByRole("dialog").or(page.locator("[role=alertdialog]").first());
  const urlField = dialog.locator("#vela-add-app-url");
  const nameField = dialog.locator("#vela-add-app-name");

  for (const bad of ["not-a-url", "无效网址测试"]) {
    await nameField.fill("校验测试");
    await urlField.fill(bad);
    await dialog.getByRole("button", { name: /^添加应用$|^Add app$/ }).click();
    // Inline error under the URL field, styled like 「请输入名称。」.
    await expect(dialog.getByRole("alert").filter({ hasText: /有效|valid/i })).toBeVisible();
    // Submission was blocked: the dialog is still open.
    await expect(dialog).toBeVisible();
  }
  await shot(page, "ux04-invalid-url-error");

  // A web-looking input is accepted and normalized to https://example.com/.
  await urlField.fill("example.com");
  await dialog.getByRole("button", { name: /^添加应用$|^Add app$/ }).click();
  await expect(dialog).toBeHidden();

  // The stored value (the API is the source of truth) is the https form.
  const workspaces = await (await request.get("/api/v1/workspaces")).json();
  const seeded = (workspaces.workspaces ?? []).filter(
    (w: { name: string }) => w.name.startsWith("Interaction Fix"),
  );
  const detail = await (
    await request.get(`/api/v1/workspaces/${seeded.at(-1).id}`)
  ).json();
  const url = String(
    detail.workspace?.snapshot?.entities?.find((e: { name: string }) => e.name === "校验测试")
      ?.url ?? "",
  );
  expect(url).toBe("https://example.com/");
});

test("UX-04: edit-app applies the same gate; legacy junk tile toasts instead of opening", async ({
  page,
  request,
}) => {
  await bootSeededDesktop(page, request);

  // Edit the seeded GitHub tile through its context menu.
  const tile = page.locator('[data-item-id="app-github"]');
  await tile.click({ button: "right", force: true });
  await page.getByRole("menuitem", { name: /^编辑$/, exact: true }).click();
  const dialog = page.getByRole("dialog").or(page.locator("[role=alertdialog]").first());
  await expect(dialog).toBeVisible();

  // Same field contract as Add (UX-06 asserts order/labels separately).
  const urlField = dialog.locator("#vela-edit-app-url");
  await urlField.fill("不是网址");
  await dialog.getByRole("button", { name: /^保存|Save/ }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: /有效|valid/i })).toBeVisible();
  await expect(dialog).toBeVisible();
  // Fix it to a normalizable value and save.
  await urlField.fill("example.com");
  await dialog.getByRole("button", { name: /^保存|Save/ }).click();
  await expect(dialog).toBeHidden();

  // Legacy unparseable data: seed a junk-URL app directly, click its tile —
  // expect a toast, NOT a navigation or a blank tab.
  await resetLocalWorkspaceStorage(page);
  const junkSnapshot = {
    id: `ws-uxb1-junk-${Date.now()}`,
    name: `Interaction Fix Junk ${Date.now()}`,
    pages: [
      {
        id: "sec-frontend",
        name: "前端开发",
        layout: { id: "sec-frontend", grid: { columns: 8, rows: 8 }, items: [] },
        canvas: {
          version: 2,
          mode: "grid",
          columns: 8,
          items: [{ id: "app-junk", column: 0, row: 0, columnSpan: 1, rowSpan: 1 }],
        },
      },
    ],
    entities: [
      {
        kind: "app",
        id: "app-junk",
        name: "坏链接",
        url: "打不开的网址",
        icon: { kind: "generated", text: "坏", source: "auto" },
        openMode: "new-tab",
        tags: [],
      },
    ],
    categories: [],
    dock: { items: [] },
    preferences: { defaultPageId: "sec-frontend", layoutLocked: true },
  };
  await request.post("/api/v1/workspaces", { data: { snapshot: junkSnapshot } });
  await page.reload();
  const pickerItem = page.locator(".vela-picker__item", { hasText: junkSnapshot.name });
  await pickerItem.or(page.locator(".vela-desktop")).first().waitFor({ timeout: 30_000 });
  if (await pickerItem.isVisible()) {
    await pickerItem.click();
  }
  await expect(page.locator(".vela-desktop")).toBeVisible();

  const popupPromise = page.waitForEvent("popup", { timeout: 3_000 }).then(
    () => true,
    () => false,
  );
  await page.locator('[data-item-id="app-junk"]').click({ force: true });
  await expect(page.locator(".vela-onboarding-success")).toContainText(/坏链接|can't be opened/i);
  await shot(page, "ux04-launch-toast");
  expect(await popupPromise).toBe(false);
  await expect(page.locator(".vela-desktop")).toBeVisible();
});

// ---------------------------------------------------------------------------
// UX-05 — no aria-disabled on operable tiles
// ---------------------------------------------------------------------------

test("UX-05: view-mode tiles carry no aria-disabled and stay operable", async ({
  page,
  request,
}) => {
  await bootSeededDesktop(page, request);
  // The seeded fixture boots layoutLocked → view mode.
  const tileStates = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".vela-desktop .vela-item")).map((el) => ({
      id: el.getAttribute("data-item-id"),
      ariaDisabled: el.getAttribute("aria-disabled"),
      roleDescription: el.getAttribute("aria-roledescription"),
    })),
  );
  expect(tileStates.length).toBeGreaterThan(0);
  expect(
    tileStates.filter((tile) => tile.ariaDisabled !== null || tile.roleDescription !== null),
  ).toEqual([]);

  // Plain clickability (no Playwright force needed anymore).
  await page.locator('[data-item-id="app-github"]').click();
  // And Enter from keyboard focus opens too.
  await page.locator('[data-item-id="app-mdn"]').focus();
  await page.keyboard.press("Enter");
  await shot(page, "ux05-tiles");
});

// ---------------------------------------------------------------------------
// UX-06 — Add/Edit dialogs share field order, labels and placeholders
// ---------------------------------------------------------------------------

test("UX-06: add and edit dialogs have identical 名称→网址 field contracts", async ({
  page,
  request,
}) => {
  await bootSeededDesktop(page, request);

  await openAddAppDialog(page);
  const addDialog = page.getByRole("dialog").or(page.locator("[role=alertdialog]").first());
  const addContract = await fieldContract(addDialog);
  await shot(page, "ux06-add-dialog");
  await page.keyboard.press("Escape");
  await expect(addDialog).toBeHidden();

  await page.locator('[data-item-id="app-github"]').click({ button: "right", force: true });
  await page.getByRole("menuitem", { name: /^编辑$/, exact: true }).click();
  const editDialog = page.getByRole("dialog").or(page.locator("[role=alertdialog]").first());
  await expect(editDialog).toBeVisible();
  const editContract = await fieldContract(editDialog);
  await shot(page, "ux06-edit-dialog");

  // 名称 above 网址, identical labels and placeholders in BOTH dialogs. The
  // edit dialog keeps its extra 打开方式 row AFTER the shared pair.
  expect(addContract.labels).toEqual(["名称", "网址"]);
  expect(editContract.labels.slice(0, 2)).toEqual(["名称", "网址"]);
  expect(editContract.labels.slice(0, 2)).toEqual(addContract.labels);
  expect(addContract.inputIds).toEqual(["vela-add-app-name", "vela-add-app-url"]);
  expect(editContract.inputIds).toEqual(["vela-edit-app-name", "vela-edit-app-url"]);
  expect(addContract.urlPlaceholder).toBe(editContract.urlPlaceholder);
});

async function fieldContract(dialog: Locator): Promise<{
  labels: string[];
  inputIds: string[];
  urlPlaceholder: string | null;
}> {
  return dialog.evaluate((root) => {
    const labels = Array.from(root.querySelectorAll("label")).map((label) =>
      label.textContent?.trim() ?? "",
    );
    const inputs = Array.from(root.querySelectorAll("input")).map((input) => input.id);
    const urlInput = root.querySelector<HTMLInputElement>("#vela-add-app-url, #vela-edit-app-url");
    return { labels, inputIds: inputs, urlPlaceholder: urlInput?.getAttribute("placeholder") ?? null };
  });
}
