import { createGridDefinition } from "@veladesk/desktop-engine";
import type { GridDefinition } from "@veladesk/desktop-engine";

import { DEFAULT_WORKSPACE_APPEARANCE } from "./appearance";
import type { DesktopPageId, WorkspaceId, WorkspaceSnapshot } from "./types";

/** Arguments of {@link createEmptyWorkspace}. Callers provide all ids. */
export interface CreateEmptyWorkspaceArgs {
  readonly workspaceId: WorkspaceId;
  readonly workspaceName: string;

  readonly pageId: DesktopPageId;
  readonly pageName: string;

  readonly grid: GridDefinition;
}

function assertNonEmptyTrimmed(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new RangeError(`${name} must be a non-empty string after trimming, received: "${value}"`);
  }
}

/**
 * Deterministic factory for an empty workspace: one page, empty canvas
 * geometry, empty entities/categories/dock, locked layout, explicit default
 * appearance, no generated ids.
 *
 * Names are validated (non-empty after trimming) but stored verbatim.
 * The grid is validated with the same semantics as the engine's
 * `createGridDefinition` and stays the page's snap lattice.
 *
 * New workspaces are canvas-native: the page carries an empty `snap` canvas
 * whose items are added as free rects, so no section ever starts as a
 * capacity-limited grid.
 */
export function createEmptyWorkspace(args: CreateEmptyWorkspaceArgs): WorkspaceSnapshot {
  assertNonEmptyTrimmed(args.workspaceId, "workspaceId");
  assertNonEmptyTrimmed(args.workspaceName, "workspaceName");
  assertNonEmptyTrimmed(args.pageId, "pageId");
  assertNonEmptyTrimmed(args.pageName, "pageName");

  const grid = createGridDefinition(args.grid.columns, args.grid.rows);

  return {
    id: args.workspaceId,
    name: args.workspaceName,
    pages: [
      {
        id: args.pageId,
        name: args.pageName,
        layout: {
          id: args.pageId,
          grid,
          items: [],
        },
        canvas: {
          version: 1,
          mode: "snap",
          items: [],
        },
      },
    ],
    entities: [],
    categories: [],
    dock: { items: [] },
    preferences: {
      defaultPageId: args.pageId,
      layoutLocked: true,
      // Fresh workspaces persist the defaults explicitly (a spread per call,
      // so callers can never mutate the shared constant).
      appearance: { ...DEFAULT_WORKSPACE_APPEARANCE },
    },
  };
}
