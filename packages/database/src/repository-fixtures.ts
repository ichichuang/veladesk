import { createWorkspaceRepository } from "./repository";
import { openDatabase } from "./connection";
import type { VelaDeskDatabase } from "./connection";
import { applyMigrations } from "./migrations";
import { MIGRATIONS_FOLDER } from "./test-support";
import { createEmptyWorkspace } from "@veladesk/domain";
import type { WorkspaceSnapshot } from "@veladesk/domain";

/**
 * Repository test fixtures: an in-memory (or temp-file) migrated database
 * with an injectable clock, plus a rich valid workspace snapshot exercising
 * every entity kind, icon variant, custom protocol URL, nested widget
 * config and the orderings that must survive persistence.
 */

export interface RepositoryTestContext {
  readonly database: VelaDeskDatabase;
  readonly repository: ReturnType<typeof createWorkspaceRepository>;
  /** Test clock: read on every repository write; advance `value` between ops. */
  readonly clock: { value: number; readonly calls: number };
  cleanup(): void;
}

export function createRepositoryContext(options?: {
  readonly filename?: string;
  readonly now?: number;
}): RepositoryTestContext {
  const filename = options?.filename ?? ":memory:";
  const clock = { value: options?.now ?? 1_700_000_000_000, calls: 0 };
  const database = openDatabase({ filename });
  applyMigrations(database, MIGRATIONS_FOLDER);
  const repository = createWorkspaceRepository(database, {
    now: () => {
      clock.calls += 1;
      return clock.value;
    },
  });
  return {
    database,
    repository,
    clock,
    cleanup: () => {
      database.close();
    },
  };
}

export function buildRichWorkspaceSnapshot(): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "workspace-1",
    workspaceName: "My Desk",
    pageId: "page-1",
    pageName: "Home",
    grid: { columns: 12, rows: 8 },
  });

  return {
    ...base,
    name: "My Desk",
    pages: [
      {
        id: "page-1",
        name: "Home",
        layout: {
          id: "page-1",
          grid: { columns: 12, rows: 8 },
          items: [
            { id: "folder-1", position: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } },
            { id: "widget-1", position: { column: 2, row: 0 }, span: { columns: 2, rows: 1 } },
          ],
        },
      },
      {
        id: "page-2",
        name: "Work",
        layout: {
          id: "page-2",
          grid: { columns: 12, rows: 8 },
          items: [
            { id: "app-1", position: { column: 0, row: 0 }, span: { columns: 1, rows: 2 } },
          ],
        },
      },
    ],
    entities: [
      {
        kind: "app",
        id: "app-1",
        name: "Obsidian",
        url: "obsidian://open?vault=Notes",
        icon: { kind: "iconify", icon: "mdi:notebook-outline" },
        openMode: "new-window",
        categoryId: "category-2",
        tags: ["notes", "pinned"],
      },
      {
        kind: "app",
        id: "app-2",
        name: "Steam",
        url: "steam://run/123",
        icon: { kind: "asset", assetId: "asset-7" },
        openMode: "new-tab",
        tags: [],
      },
      {
        kind: "app",
        id: "app-3",
        name: "Wiki",
        url: "https://wiki.example.com",
        description: "Internal knowledge base",
        icon: { kind: "favicon" },
        openMode: "same-tab",
        categoryId: "category-1",
        tags: ["docs"],
      },
      {
        kind: "app",
        id: "app-4",
        name: "Mail",
        url: "http://mail.lan",
        icon: { kind: "generated", text: "@" },
        openMode: "popup",
        categoryId: "category-1",
        tags: ["comms", "legacy"],
      },
      { kind: "folder", id: "folder-1", name: "Games", children: ["app-2", "app-3"] },
      {
        kind: "widget",
        id: "widget-1",
        widgetType: "builtin.clock",
        title: "Berlin Clock",
        config: {
          timezone: "Europe/Berlin",
          showSeconds: false,
          fallbackLabel: null,
          schedule: { days: [1, 2, 3, 4, 5], advanced: { enabled: true, ranges: [] } },
        },
      },
    ],
    categories: [
      { id: "category-1", name: "Reading" },
      { id: "category-2", name: "Tools" },
    ],
    dock: { items: ["app-2", "folder-1", "app-4"] },
    preferences: { defaultPageId: "page-1", layoutLocked: false },
  };
}
