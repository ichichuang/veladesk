import { describe, expect, it } from "vitest";
import type { CanvasRect, GridCanvasItem } from "@veladesk/canvas-engine";
import type { PagePlacement } from "@veladesk/domain";

import {
  isCanvasHandoffCaughtUp,
  reconcileCanvasHandoff,
  resolveDisplayPlacement,
} from "./canvas-handoff";
import type { PendingCanvasHandoff } from "./canvas-handoff";

function freeform(x: number): PagePlacement {
  return {
    version: 2,
    mode: "freeform",
    items: [{ id: "a", rect: rect(x) }],
  };
}

function grid(column: number): PagePlacement {
  return {
    version: 2,
    mode: "grid",
    columns: 6,
    items: [gitem("a", column, 0)],
  };
}

function rect(x: number): CanvasRect {
  return { x, y: 0, width: 1000, height: 1000 };
}

function gitem(id: string, column: number, row: number): GridCanvasItem {
  return { id, column, row, columnSpan: 1, rowSpan: 1 };
}

function handoff(pageId: string, placement: PagePlacement, token = 1): PendingCanvasHandoff {
  return { token, pageId, placement };
}

describe("resolveDisplayPlacement", () => {
  it("prefers the handoff while it targets the active page", () => {
    expect(resolveDisplayPlacement(handoff("page-1", freeform(500)), "page-1", freeform(0))).toEqual(
      freeform(500),
    );
    expect(resolveDisplayPlacement(handoff("page-2", freeform(500)), "page-1", freeform(0))).toEqual(
      freeform(0),
    );
    expect(resolveDisplayPlacement(null, "page-1", grid(3))).toEqual(grid(3));
  });
});

describe("isCanvasHandoffCaughtUp", () => {
  it("is true once the authoritative placement is equal", () => {
    expect(isCanvasHandoffCaughtUp(handoff("p", grid(2)), grid(2))).toBe(true);
    expect(isCanvasHandoffCaughtUp(handoff("p", grid(2)), grid(3))).toBe(false);
    expect(isCanvasHandoffCaughtUp(null, grid(3))).toBe(true);
    expect(isCanvasHandoffCaughtUp(handoff("p", grid(2)), undefined)).toBe(true);
  });
});

describe("reconcileCanvasHandoff", () => {
  it("keeps the override while the durable stage is in flight", () => {
    const pending = handoff("p", grid(5));
    expect(reconcileCanvasHandoff(pending, grid(1), false)).toBe(pending);
  });

  it("drops it once caught up, once the page vanished, or once settled elsewhere", () => {
    const pending = handoff("p", grid(5));
    expect(reconcileCanvasHandoff(pending, grid(5), false)).toBeNull();
    expect(reconcileCanvasHandoff(pending, undefined, false)).toBeNull();
    expect(reconcileCanvasHandoff(pending, grid(1), true)).toBeNull();
    expect(reconcileCanvasHandoff(null, grid(1), false)).toBeNull();
  });
});
