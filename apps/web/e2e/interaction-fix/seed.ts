import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

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

/**
 * The RICH scene (viewport-matrix evidence): real favicon glyphs from the
 * self-hosted collections plus a mix of custom tile sizes — the layout-fill
 * composition as a user actually curates it (two 2×2 heroes, 2×1 strips, a
 * folder, plain 1×1s, one monogram holdout) filling all 8 stored columns
 * across 3 rows. Every icon id ships in @iconify-json packages bundled
 * with the standalone server, so the scene renders fully offline. The
 * extra row-2 apps exist ONLY in this scene — the behavior specs' fixture
 * stays byte-identical without `richScene`.
 */
interface RichTile {
  readonly column: number;
  readonly row: number;
  readonly columnSpan: number;
  readonly rowSpan: number;
}

const RICH_FRONTEND_TILES: readonly (readonly [string, RichTile])[] = [
  ["app-mdn", { column: 0, row: 0, columnSpan: 1, rowSpan: 1 }],
  ["app-github", { column: 1, row: 0, columnSpan: 2, rowSpan: 1 }],
  ["app-stack", { column: 3, row: 0, columnSpan: 1, rowSpan: 1 }],
  ["app-css", { column: 4, row: 0, columnSpan: 1, rowSpan: 1 }],
  ["app-react", { column: 5, row: 0, columnSpan: 1, rowSpan: 1 }],
  ["app-vue", { column: 6, row: 0, columnSpan: 1, rowSpan: 1 }],
  ["app-ts", { column: 7, row: 0, columnSpan: 1, rowSpan: 1 }],
  ["app-vite", { column: 0, row: 1, columnSpan: 2, rowSpan: 2 }],
  ["app-npm", { column: 2, row: 1, columnSpan: 2, rowSpan: 1 }],
  ["folder-frameworks", { column: 4, row: 1, columnSpan: 2, rowSpan: 1 }],
  ["app-docker", { column: 6, row: 1, columnSpan: 2, rowSpan: 2 }],
  ["app-yarn", { column: 2, row: 2, columnSpan: 2, rowSpan: 1 }],
  ["app-eslint", { column: 4, row: 2, columnSpan: 2, rowSpan: 1 }],
];

/** Rich-scene-only extra apps filling the second and third rows. */
const RICH_EXTRA_APPS: readonly SeedApp[] = [
  { id: "app-docker", name: "Docker", url: "https://docker.com" },
  { id: "app-yarn", name: "Yarn", url: "https://yarnpkg.com" },
  { id: "app-eslint", name: "ESLint", url: "https://eslint.org" },
];

/**
 * The t77 resize scene: a SPARSE frontend grid so the resize handles have
 * free room to grow west/north/east/south — MDN sits alone at column 3
 * row 1 with empty cells on every side, GitHub far away at the bottom
 * left and every other app parked along row 4. Ids/names/sections stay
 * identical to the base fixture.
 */
const T77_FRONTEND_TILES: readonly (readonly [string, RichTile])[] = [
  ["app-mdn", { column: 3, row: 1, columnSpan: 1, rowSpan: 1 }],
  ["app-github", { column: 0, row: 3, columnSpan: 2, rowSpan: 1 }],
  ["app-stack", { column: 0, row: 4, columnSpan: 1, rowSpan: 1 }],
  ["app-css", { column: 1, row: 4, columnSpan: 1, rowSpan: 1 }],
  ["app-react", { column: 2, row: 4, columnSpan: 1, rowSpan: 1 }],
  ["app-vue", { column: 3, row: 4, columnSpan: 1, rowSpan: 1 }],
  ["app-ts", { column: 4, row: 4, columnSpan: 1, rowSpan: 1 }],
  ["app-vite", { column: 5, row: 4, columnSpan: 1, rowSpan: 1 }],
  ["app-npm", { column: 6, row: 4, columnSpan: 1, rowSpan: 1 }],
];

/** favicon glyph per app id (generated monogram stays the default). */
const RICH_FAVICONS: Readonly<Record<string, string>> = {
  "app-github": "simple-icons:github",
  "app-stack": "simple-icons:stackoverflow",
  "app-css": "vscode-icons:file-type-css",
  "app-react": "simple-icons:react",
  "app-vue": "vscode-icons:file-type-vue",
  "app-ts": "vscode-icons:file-type-typescript-official",
  "app-vite": "simple-icons:vite",
  "app-npm": "simple-icons:npm",
  "app-docker": "simple-icons:docker",
  "app-yarn": "vscode-icons:file-type-yarn",
  "app-eslint": "simple-icons:eslint",
  "app-chatgpt": "simple-icons:openai",
  "app-claude": "simple-icons:claude",
  "app-figma": "simple-icons:figma",
};

const DESIGN_APPS: readonly SeedApp[] = [
  { id: "app-dribbble", name: "Dribbble", url: "https://dribbble.com" },
  { id: "app-awwwards", name: "Awwwards", url: "https://awwwards.com" },
];

/** Folder-only apps: members of the folder, never placed on a page. */
const FOLDER_APPS: readonly SeedApp[] = [
  { id: "app-react-docs", name: "React Docs", url: "https://react.dev/learn" },
  { id: "app-vue-docs", name: "Vue Docs", url: "https://vuejs.org/guide" },
];

function entity(app: SeedApp, favicon?: string) {
  return {
    kind: "app",
    id: app.id,
    name: app.name,
    url: app.url,
    icon:
      favicon === undefined
        ? { kind: "generated", text: app.name.slice(0, 1).toUpperCase(), source: "auto" }
        : { kind: "iconify", icon: favicon },
    openMode: "new-tab",
    tags: [],
  };
}

function gridPage(
  id: string,
  name: string,
  apps: readonly SeedApp[],
  columns: number,
  tiles?: readonly (readonly [string, RichTile])[],
) {
  return {
    id,
    name,
    layout: { id, grid: { columns, rows: 8 }, items: [] },
    canvas: {
      version: 2,
      mode: "grid",
      columns,
      items:
        tiles !== undefined
          ? tiles.map(([appId, tile]) => ({ id: appId, ...tile }))
          : apps.map((app, index) => ({
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
 * overflow behavior needs more rows than a tall viewport can show. With
 * `richScene`, the frontend section swaps to the favicon + custom-size
 * tile scene (see RICH_FRONTEND_TILES) — the layout-fill evidence look;
 * ids, sections and names stay identical so every spec keeps its targets.
 */
export async function seedInteractionWorkspace(
  request: APIRequestContext,
  options: {
    readonly manySections?: boolean;
    readonly richScene?: boolean;
    readonly t77Scene?: boolean;
  } = {},
): Promise<string> {
  seedSequence += 1;
  // The NAME carries the sequence: every boot picks ITS OWN workspace from
  // the picker unambiguously (list order is server-defined and stale
  // fixtures from earlier tests survive the workspace-limit guard).
  fixtureName = `Interaction Fix ${seedSequence}`;
  const entities = [
    ...FRONTEND_APPS.map((app) =>
      entity(app, options.richScene === true ? RICH_FAVICONS[app.id] : undefined),
    ),
    ...AI_APPS.map((app) =>
      entity(app, options.richScene === true ? RICH_FAVICONS[app.id] : undefined),
    ),
    ...(options.richScene === true
      ? RICH_EXTRA_APPS.map((app) => entity(app, RICH_FAVICONS[app.id]))
      : []),
    ...DESIGN_APPS.map((app) => entity(app)),
    ...FOLDER_APPS.map((app) => entity(app)),
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
      gridPage(
        "sec-frontend",
        "前端开发",
        FRONTEND_APPS,
        8,
        options.t77Scene === true
          ? T77_FRONTEND_TILES
          : options.richScene === true
            ? RICH_FRONTEND_TILES
            : undefined,
      ),
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

/**
 * Seeds and boots; options pass through to the seed. Unless
 * `allowMobileShell`, a boot that lands on the MOBILE shell (viewports at
 * or below 767px — the canonical shell-mode resolver hands the whole
 * presentation to the mobile surface there) SKIPs the calling test: every
 * spec in this suite drives desktop-only surfaces (the pill, the section
 * scrollers, arrange mode) that do not exist in the mobile shell. The
 * suite's own viewport coverage of the mobile shell lives in
 * viewport-matrix.spec.ts, which passes the flag.
 */
export async function bootSeededDesktop(
  page: Page,
  request: APIRequestContext,
  options: {
    readonly manySections?: boolean;
    readonly richScene?: boolean;
    readonly t77Scene?: boolean;
    readonly allowMobileShell?: boolean;
  } = {},
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
  if (options.allowMobileShell !== true) {
    test.skip(
      await page.locator(".vela-mobile-shell").isVisible(),
      "the mobile shell owns viewports ≤767px — the desktop-only surfaces under test do not exist there (see viewport-matrix.spec.ts for the mobile-shell pass)",
    );
  }
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
