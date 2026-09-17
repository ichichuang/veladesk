import { describe, expect, it } from "vitest";

import { createEmptyWorkspace } from "./workspace";
import type { GridDefinition } from "@veladesk/desktop-engine";

const grid: GridDefinition = { columns: 12, rows: 8 };

const baseArgs = {
  workspaceId: "workspace-1",
  workspaceName: "My Desk",
  pageId: "page-1",
  pageName: "Home",
  grid,
};

describe("createEmptyWorkspace", () => {
  it("returns one workspace with one page and empty collections", () => {
    const workspace = createEmptyWorkspace(baseArgs);

    expect(workspace).toEqual({
      id: "workspace-1",
      name: "My Desk",
      pages: [
        {
          id: "page-1",
          name: "Home",
          layout: { id: "page-1", grid, items: [] },
        },
      ],
      entities: [],
      categories: [],
      dock: { items: [] },
      preferences: { defaultPageId: "page-1", layoutLocked: true },
    });
  });

  it("keeps the layout id equal to the page id", () => {
    const workspace = createEmptyWorkspace(baseArgs);

    expect(workspace.pages[0]?.layout.id).toBe("page-1");
  });

  it("defaults preferences to the page with layout locked", () => {
    const workspace = createEmptyWorkspace(baseArgs);

    expect(workspace.preferences).toEqual({
      defaultPageId: "page-1",
      layoutLocked: true,
    });
  });

  it("uses the provided grid for the page layout", () => {
    const workspace = createEmptyWorkspace({ ...baseArgs, grid: { columns: 6, rows: 4 } });

    expect(workspace.pages[0]?.layout.grid).toEqual({ columns: 6, rows: 4 });
  });

  it("throws RangeError for an empty workspace id", () => {
    expect(() => createEmptyWorkspace({ ...baseArgs, workspaceId: "" })).toThrow(RangeError);
  });

  it("throws RangeError for a whitespace-only workspace name", () => {
    expect(() => createEmptyWorkspace({ ...baseArgs, workspaceName: "   " })).toThrow(RangeError);
  });

  it("throws RangeError for an empty page id", () => {
    expect(() => createEmptyWorkspace({ ...baseArgs, pageId: "" })).toThrow(RangeError);
  });

  it("throws RangeError for a whitespace-only page name", () => {
    expect(() => createEmptyWorkspace({ ...baseArgs, pageName: "  " })).toThrow(RangeError);
  });

  it("preserves non-trimmed names verbatim instead of trimming them", () => {
    const workspace = createEmptyWorkspace({
      ...baseArgs,
      workspaceName: "  My Desk ",
      pageName: " Home  ",
    });

    expect(workspace.name).toBe("  My Desk ");
    expect(workspace.pages[0]?.name).toBe(" Home  ");
  });

  it("rejects a grid with non-positive columns like createGridDefinition", () => {
    expect(() => createEmptyWorkspace({ ...baseArgs, grid: { columns: 0, rows: 8 } })).toThrow(
      RangeError,
    );
  });

  it("rejects a grid with fractional rows like createGridDefinition", () => {
    expect(() => createEmptyWorkspace({ ...baseArgs, grid: { columns: 12, rows: 1.5 } })).toThrow(
      RangeError,
    );
  });

  it("returns fresh structures on every call", () => {
    const first = createEmptyWorkspace(baseArgs);
    const second = createEmptyWorkspace(baseArgs);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.pages[0]).not.toBe(second.pages[0]);
    expect(first.dock).not.toBe(second.dock);
    expect(first.preferences).not.toBe(second.preferences);
  });
});
