import { describe, expect, it } from "vitest";

import { areWorkspaceSnapshotsEqual } from "./equality";
import { buildRichSnapshot, renamedSnapshot } from "./test-support";

function jsonClone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("areWorkspaceSnapshotsEqual", () => {
  it("treats the same reference as equal", () => {
    const snapshot = buildRichSnapshot("ws-eq");

    expect(areWorkspaceSnapshotsEqual(snapshot, snapshot)).toBe(true);
  });

  it("treats a deep JSON clone as equal", () => {
    const snapshot = buildRichSnapshot("ws-eq");

    expect(areWorkspaceSnapshotsEqual(snapshot, jsonClone(snapshot) as typeof snapshot)).toBe(true);
  });

  it("is not equal when the workspace name differs", () => {
    const a = buildRichSnapshot("ws-eq");
    const b = renamedSnapshot(a, "Renamed Desk");

    expect(areWorkspaceSnapshotsEqual(a, b)).toBe(false);
  });

  it("is not equal when the page order differs", () => {
    const base = buildRichSnapshot("ws-eq");
    const secondPageId = `${base.id}-page-2`;
    const withTwoPages = {
      ...base,
      pages: [
        ...base.pages,
        {
          id: secondPageId,
          name: "Second",
          layout: { id: secondPageId, grid: { columns: 4, rows: 4 }, items: [] },
        },
      ],
    };
    const swapped = { ...withTwoPages, pages: [...withTwoPages.pages].reverse() };

    expect(areWorkspaceSnapshotsEqual(withTwoPages, swapped)).toBe(false);
  });

  it("is not equal when a layout item position differs", () => {
    const a = buildRichSnapshot("ws-eq");
    const b = {
      ...a,
      pages: [
        {
          ...a.pages[0]!,
          layout: {
            ...a.pages[0]!.layout,
            items: a.pages[0]!.layout.items.map((item) =>
              item.id === `${a.id}-widget`
                ? { ...item, position: { column: 5, row: 0 } }
                : item,
            ),
          },
        },
      ],
    };

    expect(areWorkspaceSnapshotsEqual(a, b as typeof a)).toBe(false);
  });

  it("is not equal when the dock order differs", () => {
    const a = { ...buildRichSnapshot("ws-eq"), dock: { items: ["app-1", "app-2"] } };
    const b = { ...a, dock: { items: ["app-2", "app-1"] } };

    expect(areWorkspaceSnapshotsEqual(a, b)).toBe(false);
  });

  it("is not equal when the tags order differs", () => {
    const a = buildRichSnapshot("ws-eq");
    const b = {
      ...a,
      entities: a.entities.map((entity) =>
        entity.kind === "app" && entity.id === `${a.id}-app-1`
          ? { ...entity, tags: ["writing", "notes"] }
          : entity,
      ),
    };

    expect(areWorkspaceSnapshotsEqual(a, b as typeof a)).toBe(false);
  });

  it("is equal when only widget config key insertion order differs", () => {
    const a = buildRichSnapshot("ws-eq");
    const b = {
      ...a,
      entities: a.entities.map((entity) =>
        entity.kind === "widget"
          ? {
              ...entity,
              config: {
                source: null,
                options: { extended: true, days: [1, 2, 3], units: "metric" },
                city: "Shanghai",
              },
            }
          : entity,
      ),
    };

    expect(areWorkspaceSnapshotsEqual(a, b as typeof a)).toBe(true);
  });

  it("is not equal when a nested widget config value differs", () => {
    const a = buildRichSnapshot("ws-eq");
    const b = {
      ...a,
      entities: a.entities.map((entity) =>
        entity.kind === "widget"
          ? {
              ...entity,
              config: {
                city: "Shanghai",
                options: { units: "metric", days: [1, 2], extended: true },
                source: null,
              },
            }
          : entity,
      ),
    };

    expect(areWorkspaceSnapshotsEqual(a, b as typeof a)).toBe(false);
  });
});
