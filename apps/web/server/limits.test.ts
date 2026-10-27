import { createEmptyWorkspace } from "@veladesk/domain";
import type {
  AppShortcut,
  Folder,
  WidgetInstance,
  WorkspaceSnapshot,
} from "@veladesk/domain";
import { describe, expect, it } from "vitest";

import { LIMITS, checkSnapshotLimits, resolveLimits } from "./limits";
import type { VelaDeskLimits } from "./limits";

function snapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "workspace-1",
    workspaceName: "My Desk",
    pageId: "page-1",
    pageName: "Home",
    grid: { columns: 12, rows: 8 },
  });
  return { ...base, ...overrides };
}

function app(id: string, overrides: Partial<AppShortcut> = {}): AppShortcut {
  return {
    kind: "app",
    id,
    name: "App",
    url: "https://app.example.com",
    icon: { kind: "favicon" },
    openMode: "new-tab",
    tags: [],
    ...overrides,
  };
}

describe("resolveLimits", () => {
  it("resolves the documented defaults with an empty environment", () => {
    const limits = resolveLimits({});

    expect(limits).toEqual({
      maxJsonBodyBytes: 512 * 1024,
      maxSnapshotPages: 50,
      maxSnapshotEntities: 2000,
      maxSnapshotCategories: 100,
      maxSnapshotDockItems: 200,
      maxSnapshotPageItems: 500,
      maxSnapshotFolderChildren: 200,
      maxSnapshotStringLength: 5000,
      maxSnapshotUrlLength: 4096,
      maxRevisionsPerWorkspace: 50,
      maxAssetCount: 200,
      maxAssetTotalBytes: 200 * 1024 * 1024,
      orphanGraceMs: 24 * 60 * 60 * 1000,
      orphanSweepIntervalMs: 60 * 60 * 1000,
      maxDataDirBytes: 500 * 1024 * 1024,
      dataDirCheckTtlMs: 30_000,
    });
  });

  it("applies valid positive-integer overrides", () => {
    const limits = resolveLimits({
      VELADESK_MAX_JSON_BYTES: "1024",
      VELADESK_MAX_REVISIONS_PER_WORKSPACE: "3",
      VELADESK_MAX_ASSET_COUNT: "5",
      VELADESK_MAX_ASSET_TOTAL_BYTES: "4096",
      VELADESK_MAX_DATA_DIR_BYTES: "1048576",
      VELADESK_DATA_DIR_CHECK_TTL_MS: "60",
      VELADESK_ORPHAN_GRACE_MS: "1000",
    });

    expect(limits.maxJsonBodyBytes).toBe(1024);
    expect(limits.maxRevisionsPerWorkspace).toBe(3);
    expect(limits.maxAssetCount).toBe(5);
    expect(limits.maxAssetTotalBytes).toBe(4096);
    expect(limits.maxDataDirBytes).toBe(1048576);
    expect(limits.dataDirCheckTtlMs).toBe(60);
    expect(limits.orphanGraceMs).toBe(1000);
  });

  it.each([
    ["blank", ""],
    ["whitespace", "   "],
    ["non-numeric", "abc"],
    ["zero", "0"],
    ["negative", "-5"],
    ["fractional", "1.5"],
    ["not a number", "NaN"],
  ])("falls back to the default for a %s override", (_label, value) => {
    const limits = resolveLimits({ VELADESK_MAX_JSON_BYTES: value });
    expect(limits.maxJsonBodyBytes).toBe(512 * 1024);
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(resolveLimits({ VELADESK_MAX_ASSET_COUNT: " 7 " }).maxAssetCount).toBe(7);
  });
});

describe("LIMITS", () => {
  it("is resolved from the (unset) process environment to the defaults", () => {
    expect(LIMITS.maxJsonBodyBytes).toBe(512 * 1024);
    expect(LIMITS.maxRevisionsPerWorkspace).toBe(50);
  });
});

/** One checkSnapshotLimits case: a label, an over-budget snapshot builder, the limit name. */
type LimitCase = readonly [
  label: string,
  build: (limits: VelaDeskLimits) => WorkspaceSnapshot,
  limit: string,
];

describe("checkSnapshotLimits", () => {
  it("accepts a normal snapshot and a rich real-world snapshot", () => {
    expect(checkSnapshotLimits(snapshot())).toBeUndefined();
    const rich = snapshot({
      entities: [
        app("app-1", {
          url: `data:image/png;base64,${"a".repeat(3000)}`,
          description: "d".repeat(1000),
          tags: ["work", "pinned"],
          icon: { kind: "iconify", icon: "mdi:notebook-outline" },
        }),
        {
          kind: "folder",
          id: "folder-1",
          name: "Games",
          children: Array.from({ length: 20 }, (_, index) => `app-${index}`),
        } satisfies Folder,
        {
          kind: "widget",
          id: "widget-1",
          widgetType: "builtin.clock",
          title: "Clock",
          config: { timezone: "Europe/Berlin", nested: { schedule: { days: [1, 2] } } },
        } satisfies WidgetInstance,
      ],
      dock: { items: Array.from({ length: 20 }, (_, index) => `app-${index}`) },
    });
    expect(checkSnapshotLimits(rich)).toBeUndefined();
  });

  it("accepts strings and urls exactly at their limits", () => {
    const atLimit = snapshot({
      entities: [
        app("app-1", { url: `h${"t".repeat(4095)}`, name: "n".repeat(5000) }),
      ],
    });
    expect(checkSnapshotLimits(atLimit)).toBeUndefined();
  });

  it.each<LimitCase>([
    [
      "pages",
      (limits) =>
        snapshot({
          pages: Array.from({ length: limits.maxSnapshotPages + 1 }, (_, index) => {
            const base = snapshot().pages[0]!;
            return {
              ...base,
              id: `page-${index}`,
              name: `Page ${index}`,
              layout: { ...base.layout, id: `page-${index}`, items: [] },
            };
          }),
        }),
      "max-snapshot-pages",
    ],
    [
      "entities",
      (limits) =>
        snapshot({
          entities: Array.from({ length: limits.maxSnapshotEntities + 1 }, (_, index) =>
            app(`app-${index}`),
          ),
        }),
      "max-snapshot-entities",
    ],
    [
      "page layout items",
      (limits) =>
        snapshot({
          pages: [
            {
              ...snapshot().pages[0]!,
              layout: {
                ...snapshot().pages[0]!.layout,
                items: Array.from({ length: limits.maxSnapshotPageItems + 1 }, (_, index) => ({
                  id: `app-${index}`,
                  position: { column: 0, row: 0 },
                  span: { columns: 1, rows: 1 },
                })),
              },
            },
          ],
        }),
      "max-snapshot-page-items",
    ],
    [
      "canvas items",
      (limits) =>
        snapshot({
          pages: [
            {
              ...snapshot().pages[0]!,
              canvas: {
                version: 2,
                mode: "grid",
                columns: 12,
                items: Array.from({ length: limits.maxSnapshotPageItems + 1 }, (_, index) => ({
                  id: `app-${index}`,
                  column: 0,
                  row: 0,
                  columnSpan: 1,
                  rowSpan: 1,
                })),
              },
            },
          ],
        }),
      "max-snapshot-page-items",
    ],
    [
      "folder children",
      (limits) =>
        snapshot({
          entities: [
            {
              kind: "folder",
              id: "folder-1",
              name: "Games",
              children: Array.from(
                { length: limits.maxSnapshotFolderChildren + 1 },
                (_, index) => `app-${index}`,
              ),
            } satisfies Folder,
          ],
        }),
      "max-snapshot-folder-children",
    ],
    [
      "categories",
      (limits) =>
        snapshot({
          categories: Array.from({ length: limits.maxSnapshotCategories + 1 }, (_, index) => ({
            id: `category-${index}`,
            name: `Category ${index}`,
          })),
        }),
      "max-snapshot-categories",
    ],
    [
      "dock items",
      (limits) =>
        snapshot({
          dock: {
            items: Array.from({ length: limits.maxSnapshotDockItems + 1 }, (_, index) => `app-${index}`),
          },
        }),
      "max-snapshot-dock-items",
    ],
  ])("reports a 413 count violation for %s over the budget", (_label, build, limit) => {
    const limits = resolveLimits({});
    expect(checkSnapshotLimits(build(limits), limits)).toEqual({ status: 413, limit });
  });

  it.each<LimitCase>([
    ["an over-long app url", (limits) => snapshot({ entities: [app("app-1", { url: `https://x.example/${"a".repeat(limits.maxSnapshotUrlLength)}` })] }), "max-snapshot-url-length"],
    ["an over-long data: url", (limits) => snapshot({ entities: [app("app-1", { url: `data:image/png;base64,${"a".repeat(limits.maxSnapshotUrlLength)}` })] }), "max-snapshot-url-length"],
    ["an over-long app name", (limits) => snapshot({ entities: [app("app-1", { name: "n".repeat(limits.maxSnapshotStringLength + 1) })] }), "max-snapshot-string-length"],
    ["an over-long description", (limits) => snapshot({ entities: [app("app-1", { description: "d".repeat(limits.maxSnapshotStringLength + 1) })] }), "max-snapshot-string-length"],
    ["an over-long tag", (limits) => snapshot({ entities: [app("app-1", { tags: ["t".repeat(limits.maxSnapshotStringLength + 1)] })] }), "max-snapshot-string-length"],
    ["an over-long iconify icon name", (limits) => snapshot({ entities: [app("app-1", { icon: { kind: "iconify", icon: "i".repeat(limits.maxSnapshotStringLength + 1) } })] }), "max-snapshot-string-length"],
    ["an over-long generated icon text", (limits) => snapshot({ entities: [app("app-1", { icon: { kind: "generated", text: "x".repeat(limits.maxSnapshotStringLength + 1) } })] }), "max-snapshot-string-length"],
    ["an over-long widget title", (limits) => snapshot({ entities: [{ kind: "widget", id: "widget-1", widgetType: "builtin.clock", title: "t".repeat(limits.maxSnapshotStringLength + 1), config: {} } satisfies WidgetInstance] }), "max-snapshot-string-length"],
    ["an over-long string nested in widget config", (limits) => snapshot({ entities: [{ kind: "widget", id: "widget-1", widgetType: "builtin.clock", config: { nested: { deep: ["ok", "b".repeat(limits.maxSnapshotStringLength + 1)] } } } satisfies WidgetInstance] }), "max-snapshot-string-length"],
    ["an over-long folder name", (limits) => snapshot({ entities: [{ kind: "folder", id: "folder-1", name: "f".repeat(limits.maxSnapshotStringLength + 1), children: [] } satisfies Folder] }), "max-snapshot-string-length"],
    ["an over-long category name", (limits) => snapshot({ categories: [{ id: "category-1", name: "c".repeat(limits.maxSnapshotStringLength + 1) }] }), "max-snapshot-string-length"],
    ["an over-long page name", (limits) => snapshot({ pages: [{ ...snapshot().pages[0]!, name: "p".repeat(limits.maxSnapshotStringLength + 1) }] }), "max-snapshot-string-length"],
    ["an over-long page wallpaper asset id", (limits) => snapshot({ pages: [{ ...snapshot().pages[0]!, wallpaper: { kind: "asset", assetId: "a".repeat(limits.maxSnapshotStringLength + 1), fit: "cover", position: "center" } }] }), "max-snapshot-string-length"],
    ["an over-long workspace wallpaper asset id", (limits) => snapshot({ preferences: { ...snapshot().preferences, appearance: { ...snapshot().preferences.appearance!, wallpaper: { kind: "asset", assetId: "b".repeat(limits.maxSnapshotStringLength + 1), fit: "cover", position: "center" } } } }), "max-snapshot-string-length"],
    ["an over-long entity id", (limits) => snapshot({ entities: [app(`app-${"i".repeat(limits.maxSnapshotStringLength)}`)] }), "max-snapshot-string-length"],
  ])("reports a 400 string violation for %s", (_label, build, limit) => {
    const limits = resolveLimits({});
    expect(checkSnapshotLimits(build(limits), limits)).toEqual({ status: 400, limit });
  });
});
