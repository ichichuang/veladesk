import { describe, expect, it } from "vitest";

import { decodeWorkspaceSnapshot } from "./decoding";
import { validateWorkspace } from "./validation";
import { createEmptyWorkspace } from "./workspace";

function minimalSnapshot(): Record<string, unknown> {
  return createEmptyWorkspace({
    workspaceId: "workspace-1",
    workspaceName: "My Desk",
    pageId: "page-1",
    pageName: "Home",
    grid: { columns: 12, rows: 8 },
  }) as unknown as Record<string, unknown>;
}

/** A structurally complete app entity covering every AppIcon-independent field. */
function richApp(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "app",
    id: "app-1",
    name: "Obsidian",
    url: "obsidian://open?vault=Notes",
    description: "Notes vault",
    icon: { kind: "generated", text: "OB" },
    openMode: "new-tab",
    categoryId: "cat-1",
    tags: ["notes", "writing"],
    ...extra,
  };
}

function snapshotWithEntities(entities: unknown[]): Record<string, unknown> {
  return { ...minimalSnapshot(), entities };
}

describe("decodeWorkspaceSnapshot — valid structures", () => {
  it("decodes a minimal valid snapshot", () => {
    const decoded = decodeWorkspaceSnapshot(minimalSnapshot());

    expect(decoded).toBeDefined();
    expect(decoded?.id).toBe("workspace-1");
    expect(decoded?.name).toBe("My Desk");
    expect(decoded?.pages).toHaveLength(1);
    expect(decoded?.dock.items).toEqual([]);
  });

  it("decodes a rich app shortcut with all optional fields", () => {
    const decoded = decodeWorkspaceSnapshot(snapshotWithEntities([richApp()]));

    expect(decoded).toBeDefined();
    const entity = decoded?.entities[0];
    expect(entity?.kind).toBe("app");
    if (entity?.kind === "app") {
      expect(entity.url).toBe("obsidian://open?vault=Notes");
      expect(entity.description).toBe("Notes vault");
      expect(entity.categoryId).toBe("cat-1");
      expect(entity.tags).toEqual(["notes", "writing"]);
    }
  });

  it("decodes a folder entity", () => {
    const decoded = decodeWorkspaceSnapshot(
      snapshotWithEntities([{ kind: "folder", id: "folder-1", name: "Work", children: ["app-1"] }]),
    );

    expect(decoded).toBeDefined();
    const entity = decoded?.entities[0];
    expect(entity?.kind).toBe("folder");
    if (entity?.kind === "folder") {
      expect(entity.children).toEqual(["app-1"]);
    }
  });

  it("decodes a widget entity with a nested JSON config object", () => {
    const decoded = decodeWorkspaceSnapshot(
      snapshotWithEntities([
        {
          kind: "widget",
          id: "widget-1",
          widgetType: "plugin.example.weather",
          title: "Weather",
          config: {
            city: "Shanghai",
            units: { temperature: "celsius", wind: { enabled: true, speed: 3 } },
            days: ["mon", "tue"],
            refreshSeconds: null,
          },
        },
      ]),
    );

    expect(decoded).toBeDefined();
    const entity = decoded?.entities[0];
    expect(entity?.kind).toBe("widget");
    if (entity?.kind === "widget") {
      expect(entity.widgetType).toBe("plugin.example.weather");
      expect(entity.config).toEqual({
        city: "Shanghai",
        units: { temperature: "celsius", wind: { enabled: true, speed: 3 } },
        days: ["mon", "tue"],
        refreshSeconds: null,
      });
    }
  });

  it("decodes all four AppIcon kinds", () => {
    const icons: unknown[] = [
      { kind: "favicon" },
      { kind: "iconify", icon: "mdi:rocket-launch" },
      { kind: "asset", assetId: "asset-1" },
      { kind: "generated", text: "GH" },
    ];

    const decoded = decodeWorkspaceSnapshot(
      snapshotWithEntities(icons.map((icon, index) => richApp({ id: `app-${index}`, icon }))),
    );

    expect(decoded).toBeDefined();
    expect(decoded?.entities).toHaveLength(4);
  });

  it("accepts a custom protocol URL (structure does not parse URLs)", () => {
    const decoded = decodeWorkspaceSnapshot(
      snapshotWithEntities([richApp({ url: "steam://open/games" })]),
    );

    expect(decoded).toBeDefined();
  });

  it("ignores unknown extra properties", () => {
    const value = {
      ...minimalSnapshot(),
      futureField: "ignored",
      entities: [richApp({ experimentalFlag: true })],
    };

    const decoded = decodeWorkspaceSnapshot(value);

    expect(decoded).toBeDefined();
    expect(decoded?.entities).toHaveLength(1);
  });
});

describe("decodeWorkspaceSnapshot — invalid structures", () => {
  it("rejects non-object values", () => {
    expect(decodeWorkspaceSnapshot(null)).toBeUndefined();
    expect(decodeWorkspaceSnapshot("workspace")).toBeUndefined();
    expect(decodeWorkspaceSnapshot(42)).toBeUndefined();
    expect(decodeWorkspaceSnapshot([])).toBeUndefined();
  });

  it("rejects a bad page (missing name)", () => {
    const value = {
      ...minimalSnapshot(),
      pages: [{ id: "page-1", layout: minimalSnapshotPageLayout() }],
    };

    expect(decodeWorkspaceSnapshot(value)).toBeUndefined();
  });

  it("rejects a bad layout (grid rows missing)", () => {
    const value = {
      ...minimalSnapshot(),
      pages: [
        {
          id: "page-1",
          name: "Home",
          layout: { id: "page-1", grid: { columns: 12 }, items: [] },
        },
      ],
    };

    expect(decodeWorkspaceSnapshot(value)).toBeUndefined();
  });

  it("rejects a bad layout item (span missing)", () => {
    const value = {
      ...minimalSnapshot(),
      pages: [
        {
          id: "page-1",
          name: "Home",
          layout: {
            id: "page-1",
            grid: { columns: 12, rows: 8 },
            items: [{ id: "app-1", position: { column: 0, row: 0 } }],
          },
        },
      ],
    };

    expect(decodeWorkspaceSnapshot(value)).toBeUndefined();
  });

  it("rejects an unknown entity kind", () => {
    const value = snapshotWithEntities([{ kind: "bookmark", id: "b-1", name: "Nope" }]);

    expect(decodeWorkspaceSnapshot(value)).toBeUndefined();
  });

  it("rejects a bad icon (unknown kind and missing iconify icon)", () => {
    const badKinds = snapshotWithEntities([richApp({ icon: { kind: "emoji" } })]);
    const missingIcon = snapshotWithEntities([richApp({ icon: { kind: "iconify" } })]);

    expect(decodeWorkspaceSnapshot(badKinds)).toBeUndefined();
    expect(decodeWorkspaceSnapshot(missingIcon)).toBeUndefined();
  });

  it("rejects bad tags (non-string entries and non-array)", () => {
    const nonString = snapshotWithEntities([richApp({ tags: ["ok", 7] })]);
    const notArray = snapshotWithEntities([richApp({ tags: "notes" })]);

    expect(decodeWorkspaceSnapshot(nonString)).toBeUndefined();
    expect(decodeWorkspaceSnapshot(notArray)).toBeUndefined();
  });

  it("rejects a widget whose config is an array", () => {
    const value = snapshotWithEntities([
      { kind: "widget", id: "widget-1", widgetType: "builtin.clock", config: [] },
    ]);

    expect(decodeWorkspaceSnapshot(value)).toBeUndefined();
  });

  it("rejects a bad dock (items not a string array)", () => {
    const value = { ...minimalSnapshot(), dock: { items: ["app-1", 3] } };

    expect(decodeWorkspaceSnapshot(value)).toBeUndefined();
  });

  it("rejects bad preferences (layoutLocked not boolean)", () => {
    const value = {
      ...minimalSnapshot(),
      preferences: { defaultPageId: "page-1", layoutLocked: "yes" },
    };

    expect(decodeWorkspaceSnapshot(value)).toBeUndefined();
  });
});

describe("decodeWorkspaceSnapshot — structural/semantic boundary", () => {
  it("decodes a blank workspace name; validateWorkspace rejects it", () => {
    const value = { ...minimalSnapshot(), name: "   " };

    const decoded = decodeWorkspaceSnapshot(value);

    expect(decoded).toBeDefined();
    expect(validateWorkspace(decoded!).length).toBeGreaterThan(0);
  });

  it("decodes grid columns 0; validateWorkspace rejects it", () => {
    const value = {
      ...minimalSnapshot(),
      pages: [
        {
          id: "page-1",
          name: "Home",
          layout: {
            id: "page-1",
            grid: { columns: 0, rows: 8 },
            items: [],
          },
        },
      ],
    };

    const decoded = decodeWorkspaceSnapshot(value);

    expect(decoded).toBeDefined();
    expect(validateWorkspace(decoded!).length).toBeGreaterThan(0);
  });
});

function minimalSnapshotPageLayout(): unknown {
  return {
    id: "page-1",
    grid: { columns: 12, rows: 8 },
    items: [],
  };
}
