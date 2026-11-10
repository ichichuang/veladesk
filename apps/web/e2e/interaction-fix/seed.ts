import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Deterministic fixture of the interaction-fix suite: one workspace, three
 * sections (前端开发 with the named dev tiles the specs drag, AI 工具,
 * 设计灵感), a folder and a dock — seeded through the real HTTP API so
 * every test context boots into the SAME desktop with NO user history.
 */
interface SeedApp {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

const FRONTEND_APPS: readonly SeedApp[] = [
  { id: "app-mdn", name: "MDN", url: "https://developer.mozilla.org" },
  { id: "app-github", name: "GitHub", url: "https://github.com" },
  { id: "app-stack", name: "Stack", url: "https://stackoverflow.com" },
  { id: "app-css", name: "CSS", url: "https://css-tricks.com" },
  { id: "app-react", name: "React", url: "https://react.dev" },
  { id: "app-vue", name: "Vue", url: "https://vuejs.org" },
  { id: "app-ts", name: "TS", url: "https://typescriptlang.org" },
  { id: "app-vite", name: "Vite", url: "https://vite.dev" },
  { id: "app-npm", name: "npm", url: "https://npmjs.com" },
];

const AI_APPS: readonly SeedApp[] = [
  { id: "app-chatgpt", name: "ChatGPT", url: "https://chat.openai.com" },
  { id: "app-claude", name: "Claude", url: "https://claude.ai" },
  { id: "app-figma", name: "Figma", url: "https://figma.com" },
];

const DESIGN_APPS: readonly SeedApp[] = [
  { id: "app-dribbble", name: "Dribbble", url: "https://dribbble.com" },
  { id: "app-awwwards", name: "Awwwards", url: "https://awwwards.com" },
];

/** Folder-only apps: members of the folder, never placed on a page. */
const FOLDER_APPS: readonly SeedApp[] = [
  { id: "app-react-docs", name: "React Docs", url: "https://react.dev/learn" },
  { id: "app-vue-docs", name: "Vue Docs", url: "https://vuejs.org/guide" },
];

function entity(app: SeedApp) {
  return {
    kind: "app",
    id: app.id,
    name: app.name,
    url: app.url,
    icon: { kind: "generated", text: app.name.slice(0, 1).toUpperCase(), source: "auto" },
    openMode: "new-tab",
    tags: [],
  };
}

function gridPage(id: string, name: string, apps: readonly SeedApp[], columns: number) {
  return {
    id,
    name,
    layout: { id, grid: { columns, rows: 8 }, items: [] },
    canvas: {
      version: 2,
      mode: "grid",
      columns,
      items: apps.map((app, index) => ({
        id: app.id,
        column: index % columns,
        row: Math.floor(index / columns),
        columnSpan: 1,
        rowSpan: 1,
      })),
    },
  };
}

/** Monotonic seed counter: every POST gets its own workspace id (the API
 * refuses duplicate ids with 409, and one run seeds per test). */
let seedSequence = 0;

/**
 * Seeds the interaction-fix workspace and returns its id. With
 * `manySections`, twelve extra one-app sections ride along — the rail's
 * overflow behavior needs more rows than a tall viewport can show.
 */
export async function seedInteractionWorkspace(
  request: APIRequestContext,
  options: { readonly manySections?: boolean } = {},
): Promise<string> {
  seedSequence += 1;
  // The NAME carries the sequence: every boot picks ITS OWN workspace from
  // the picker unambiguously (list order is server-defined and stale
  // fixtures from earlier tests survive the workspace-limit guard).
  fixtureName = `Interaction Fix ${seedSequence}`;
  const entities = [
    ...FRONTEND_APPS.map(entity),
    ...AI_APPS.map(entity),
    ...DESIGN_APPS.map(entity),
    ...FOLDER_APPS.map(entity),
    {
      kind: "folder",
      id: "folder-frameworks",
      name: "框架文档",
      children: FOLDER_APPS.map((app) => app.id),
    },
  ];
  const snapshot = {
    id: `ws-interaction-fix-${Date.now()}-${seedSequence}`,
    name: fixtureName,
    pages: [
      gridPage("sec-frontend", "前端开发", FRONTEND_APPS, 8),
      gridPage("sec-ai", "AI 工具", AI_APPS, 8),
      gridPage("sec-design", "设计灵感", DESIGN_APPS, 8),
      ...(options.manySections === true
        ? Array.from({ length: 20 }, (_, index) =>
            gridPage(`sec-many-${index}`, `扩展分区${index + 1}`, [
              { id: `app-many-${index}`, name: `应用${index + 1}`, url: `https://example.com/${index}` },
            ], 8),
          )
        : []),
    ],
    entities: [
      ...entities,
      ...(options.manySections === true
        ? Array.from({ length: 20 }, (_, index) =>
            entity({ id: `app-many-${index}`, name: `应用${index + 1}`, url: `https://example.com/${index}` }),
          )
        : []),
    ],
    categories: [],
    dock: { items: ["app-github", "app-mdn", "app-chatgpt", "app-figma"] },
    preferences: {
      defaultPageId: "sec-frontend",
      layoutLocked: true,
    },
  };
  const response = await request.post("/api/v1/workspaces", { data: { snapshot } });
  if (response.status() !== 201) {
    throw new Error(`seed failed (${response.status()}): ${await response.text()}`);
  }
  const created = (await response.json()) as { workspace?: { id?: string } };
  return created.workspace?.id ?? snapshot.id;
}

/** Wipes the local-first store so the next boot goes through the picker. */
export async function resetLocalWorkspaceStorage(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.localStorage.clear();
        const request = indexedDB.deleteDatabase("veladesk-local");
        const done = () => resolve();
        request.onsuccess = done;
        request.onerror = done;
        request.onblocked = done;
      }),
  );
}

/** The name of the most recently seeded fixture (the picker target). */
let fixtureName = "Interaction Fix";

/** Seeds and boots; options pass through to the seed. */
export async function bootSeededDesktop(
  page: Page,
  request: APIRequestContext,
  options: { readonly manySections?: boolean } = {},
): Promise<void> {
  await seedInteractionWorkspace(request, options);
  await page.addInitScript(() => {
    window.localStorage.removeItem("veladesk:ui-locale");
  });
  await page.goto("/");
  // One of several server workspaces → the picker; pick the fixture.
  const pickerItem = page.locator(".vela-picker__item", { hasText: fixtureName });
  // Phone widths mount the MOBILE shell — either shell means booted.
  const desktop = page.locator(".vela-desktop, .vela-mobile-shell");
  // .last(): earlier tests may leave an identical fixture behind (the
  // API refuses deleting the last workspace); the newest is this boot's own.
  await expect(pickerItem.last().or(desktop)).toBeVisible({ timeout: 30_000 });
  // Pick the NEWEST fixture (last in the list): an identical leftover
  // from an earlier test may sort first, and this boot just seeded its own.
  if (await pickerItem.last().isVisible()) {
    await pickerItem.last().click();
  }
  await expect(desktop).toBeVisible({ timeout: 30_000 });
}

/**
 * Deletes every workspace this run seeded. The server enforces a workspace
 * limit, and each test needs its OWN pristine fixture (the app's dirty
 * sync would otherwise push one test's geometry edits onto the next
 * test's boot), so every spec's afterEach calls this.
 */
export async function deleteSeededWorkspaces(request: APIRequestContext): Promise<void> {
  const list = await request.get("/api/v1/workspaces");
  if (list.status() !== 200) {
    return;
  }
  const payload = (await list.json()) as {
    workspaces?: { id: string; name: string; revision: number }[];
  };
  const seeded = (payload.workspaces ?? []).filter((workspace) => workspace.name.startsWith("Interaction Fix"));
  for (const workspace of seeded.slice(0, Math.max(0, seeded.length - 1))) {
    // Best effort: the API refuses deleting the LAST workspace (409), so
    // exactly one identical fixture may survive a run — harmless, the
    // picker picks by name and every fixture is the same data.
    await request.delete(`/api/v1/workspaces/${workspace.id}`, {
      data: { expectedRevision: workspace.revision },
    });
  }
}
