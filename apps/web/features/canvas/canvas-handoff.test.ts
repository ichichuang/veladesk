import { describe, expect, it } from "vitest";
import type { CanvasLayout } from "@veladesk/canvas-engine";

import {
  isCanvasHandoffCaughtUp,
  reconcileCanvasHandoff,
  resolveDisplayCanvas,
} from "./canvas-handoff";
import type { PendingCanvasHandoff } from "./canvas-handoff";

function canvas(x: number, mode: "snap" | "freeform" = "freeform"): CanvasLayout {
  return { version: 1, mode, items: [{ id: "a", rect: { x, y: 0, width: 1000, height: 1000 } }] };
}

function handoff(pageId: string, pendingCanvas: CanvasLayout, token = 1): PendingCanvasHandoff {
  return { token, pageId, canvas: pendingCanvas };
}

describe("resolveDisplayCanvas", () => {
  it("prefers the handoff while it targets the active page", () => {
    expect(resolveDisplayCanvas(handoff("page-1", canvas(2000)), "page-1", canvas(1000))).toEqual(
      canvas(2000),
    );
  });

  it("ignores a handoff for another page", () => {
    expect(resolveDisplayCanvas(handoff("page-2", canvas(2000)), "page-1", canvas(1000))).toEqual(
      canvas(1000),
    );
  });

  it("renders the authoritative canvas without a handoff", () => {
    const authoritative = canvas(1000);
    expect(resolveDisplayCanvas(null, "page-1", authoritative)).toBe(authoritative);
  });
});

describe("isCanvasHandoffCaughtUp", () => {
  it("treats a missing handoff or page as caught up", () => {
    expect(isCanvasHandoffCaughtUp(null, canvas(1000))).toBe(true);
    expect(isCanvasHandoffCaughtUp(handoff("page-1", canvas(2000)), undefined)).toBe(true);
  });

  it("compares structure, not identity", () => {
    expect(isCanvasHandoffCaughtUp(handoff("page-1", canvas(2000)), canvas(2000))).toBe(true);
    expect(isCanvasHandoffCaughtUp(handoff("page-1", canvas(2000)), canvas(1000))).toBe(false);
  });
});

describe("reconcileCanvasHandoff", () => {
  it("drops the override once the authoritative canvas caught up", () => {
    expect(reconcileCanvasHandoff(handoff("page-1", canvas(2000)), canvas(2000), false)).toBeNull();
  });

  it("keeps the override while the stage is still in flight", () => {
    const pending = handoff("page-1", canvas(2000));
    expect(reconcileCanvasHandoff(pending, canvas(1000), false)).toBe(pending);
  });

  it("yields to the authoritative canvas after a settled attempt", () => {
    // A settled stage whose canvas never matched is the failed-write revert:
    // the display falls back instead of shadowing the truth forever.
    expect(reconcileCanvasHandoff(handoff("page-1", canvas(2000)), canvas(1000), true)).toBeNull();
  });

  it("drops the override when the page vanished", () => {
    expect(reconcileCanvasHandoff(handoff("page-1", canvas(2000)), undefined, false)).toBeNull();
    expect(reconcileCanvasHandoff(null, canvas(1000), false)).toBeNull();
  });

  it("never mutates the handoff it keeps", () => {
    const pending = handoff("page-1", canvas(2000), 7);
    const kept = reconcileCanvasHandoff(pending, canvas(1000), false);
    expect(kept).toEqual({ token: 7, pageId: "page-1", canvas: canvas(2000) });
  });
});
