import { expect, test } from "@playwright/test";

import { buildGridSnapshot, seedWorkspace, type SeedSectionSpec } from "../fixtures/seed";
import {
  activeSectionName,
  appContextMenu,
  bootIntoWorkspace,
  dirtyEditorDraft,
  failOnConsoleError,
  railRoot,
  wheelFlick,
} from "../task-018/helpers";
import { captureGeometry, formatCapture, workbenchViolations, type GeometryCapture } from "./geometry";

/**
 * Task 019-A deterministic reproduction of the long-session workbench
 * displacement. ONE browser session, ONE page, a seeded deterministic
 * workspace; after EVERY operation the full geometry state is recorded
 * (rects of documentElement/body/desktop/workbench/rail/workspace,
 * computed displace-relevant styles on the workbench and every ancestor,
 * and the latched programmatic scroll of the desktop stage) and the
 * invariant is asserted:
 *
 *   |workbench.left| <= 0.5px  &&  |workbench.top| <= 0.5px
 *   workbench.width ~= viewport.width  &&  workbench.height ~= viewport.height
 *
 * Execution STOPS at the first failing operation — later operations are
 * skipped and every capture up to and including the failure is printed,
 * so the boundary operation and the exact ancestor state are on record.
 */

const WORKSPACE_NAME = "Desk 019 Repro";

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
  await page.mouse.click(700, 450, { button: "right" });
  await page.getByRole("menuitem", { name }).first().click();
}

async function currentRevision(
  request: import("@playwright/test").APIRequestContext,
  workspaceId: string,
): Promise<number> {
  const detail = (await (await request.get(`/api/v1/workspaces/${workspaceId}`)).json()) as {
    workspace: { revision: number };
  };
  return detail.workspace.revision;
}

test("A–J journey keeps the workbench pinned to the viewport", async ({ page, request }) => {
  failOnConsoleError(page);

  const snapshot = buildGridSnapshot("ws-019-repro", WORKSPACE_NAME, SECTIONS);
  (snapshot.preferences as Record<string, unknown>).layoutLocked = false;
  await seedWorkspace(request, snapshot);
  await bootIntoWorkspace(page, WORKSPACE_NAME);

  const captures: GeometryCapture[] = [];
  let failedAt: string | null = null;

  const checkpoint = async (label: string): Promise<void> => {
    const capture = await captureGeometry(page, label);
    captures.push(capture);
    const violations = workbenchViolations(capture);
    if (violations.length > 0 && failedAt === null) {
      failedAt = `${label}: ${violations.map((violation) => violation.detail).join("; ")}`;
    }
  };

  const guard = async (label: string, operation: () => Promise<void>): Promise<void> => {
    if (failedAt !== null) {
      return; // Early stop: never run later operations after a failure.
    }
    await operation();
    await checkpoint(label);
    if (failedAt !== null) {
      const history = captures.map(formatCapture).join("\n");
      throw new Error(`geometry invariant first failed after "${label}"\n${history}\n`);
    }
  };

  type Operation = readonly [string, () => Promise<void>];
  const journey = (): readonly Operation[] => [
    // A. clean desktop
    [
      "A boot",
      async () => {
        await expect(page.locator(".vela-item", { hasText: "Alpha" })).toBeVisible();
      },
    ],
    // B. section wheel changes (rail wheel navigation, both directions)
    [
      "B wheel home",
      async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        const rail = await railRoot(page).boundingBox();
        expect(rail).not.toBeNull();
        await wheelFlick(page, rail!.x + 40, rail!.y + 80, false);
        await expect.poll(() => activeSectionName(page), { timeout: 10_000 }).toBe("Home");
      },
    ],
    [
      "B wheel second",
      async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        const rail = await railRoot(page).boundingBox();
        expect(rail).not.toBeNull();
        await wheelFlick(page, rail!.x + 40, rail!.y + 80, true);
        await expect.poll(() => activeSectionName(page), { timeout: 10_000 }).toBe("Second");
        const home = page.locator(".vela-rail__item", { hasText: "Home" });
        await home.click();
        await expect.poll(() => activeSectionName(page), { timeout: 10_000 }).toBe("Home");
      },
    ],
    // C. arrange enter/leave
    [
      "C arrange enter",
      async () => {
        await desktopMenuAction(page, /整理桌面|Arrange/);
        await expect(page.getByRole("toolbar")).toBeVisible();
      },
    ],
    [
      "C arrange leave",
      async () => {
        await desktopMenuAction(page, /退出整理|Exit arrange/);
        await expect(page.getByRole("toolbar")).toBeHidden();
      },
    ],
    // D–F. arrange geometry work: gap, drag, resize (real pointer input)
    [
      "D enter arrange again",
      async () => {
        await desktopMenuAction(page, /整理桌面|Arrange/);
        await expect(page.getByRole("toolbar")).toBeVisible();
      },
    ],
    [
      "D gap max",
      async () => {
        const before = await currentRevision(request, "ws-019-repro");
        await page.locator(".vela-arrange-bar__gap-step").last().click();
        await expect
          .poll(() => currentRevision(request, "ws-019-repro"), { timeout: 10_000 })
          .toBe(before + 1);
      },
    ],
    [
      "E grid drag",
      async () => {
        const tile = page.locator(".vela-item", { hasText: "Alpha" }).first();
        const box = await tile.boundingBox();
        expect(box).not.toBeNull();
        const before = await currentRevision(request, "ws-019-repro");
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await page.mouse.down();
        await page.mouse.move(box!.x + box!.width / 2 + 220, box!.y + 160, { steps: 12 });
        await page.mouse.up();
        await expect
          .poll(() => currentRevision(request, "ws-019-repro"), { timeout: 10_000 })
          .toBe(before + 1);
      },
    ],
    [
      "F grid resize",
      async () => {
        const tile = page.locator(".vela-item", { hasText: "Alpha" }).first();
        await tile.hover();
        const handle = tile.locator('.vela-item__resize-handle[data-handle="se"]');
        await expect(handle).toBeVisible();
        const handleBox = await handle.boundingBox();
        const before = await currentRevision(request, "ws-019-repro");
        await page.mouse.move(handleBox!.x + 4, handleBox!.y + 4);
        await page.mouse.down();
        await page.mouse.move(handleBox!.x + 154, handleBox!.y + 12, { steps: 8 });
        await page.mouse.up();
        await expect
          .poll(() => currentRevision(request, "ws-019-repro"), { timeout: 10_000 })
          .toBe(before + 1);
      },
    ],
    [
      "F exit arrange",
      async () => {
        await desktopMenuAction(page, /退出整理|Exit arrange/);
        await expect(page.getByRole("toolbar")).toBeHidden();
      },
    ],
    // G. open/cancel Settings
    [
      "G settings cancel",
      async () => {
        await desktopMenuAction(page, /设置…|Settings/);
        const dialog = page.getByRole("dialog");
        await dialog.waitFor({ state: "visible", timeout: 10_000 });
        for (const tab of [/布局|Layout/, /通用|General/, /外观|Appearance/]) {
          await dialog.getByRole("button", { name: tab }).click();
          await page.waitForTimeout(200);
        }
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden", timeout: 10_000 });
      },
    ],
    // H. open/cancel app appearance editor
    [
      "H appearance cancel",
      async () => {
        await appContextMenu(page, "Alpha", /编辑外观|Edit appearance/);
        const editor = page.getByRole("dialog");
        await editor.waitFor({ state: "visible", timeout: 10_000 });
        await dirtyEditorDraft(page);
        await page.keyboard.press("Escape");
        await editor.waitFor({ state: "hidden", timeout: 10_000 });
      },
    ],
    // I. open/save app appearance editor
    [
      "I appearance save",
      async () => {
        const before = await currentRevision(request, "ws-019-repro");
        await appContextMenu(page, "Alpha", /编辑外观|Edit appearance/);
        const editor = page.getByRole("dialog");
        await editor.waitFor({ state: "visible", timeout: 10_000 });
        await dirtyEditorDraft(page);
        await editor.getByRole("button", { name: /保存|Save/ }).click();
        await editor.waitFor({ state: "hidden", timeout: 10_000 });
        expect(await currentRevision(request, "ws-019-repro")).toBe(before + 1);
      },
    ],
  ];

  await checkpoint("A boot prelude");
  for (const [label, operation] of journey()) {
    await guard(label, operation);
  }
  // J. repeat the whole sequence — displacement accumulated across cycles
  // in the original failure, so the second pass is where it showed.
  for (const [label, operation] of journey()) {
    await guard(`J ${label}`, operation);
  }

  expect(failedAt).toBeNull();
});
