import { describe, expect, it } from "vitest";
import type { AppShortcut, WorkspaceSnapshot } from "@veladesk/domain";
import { MAX_ICON_SCALE, MIN_ICON_SCALE } from "@veladesk/domain";

import {
  RESIZE_CORNERS,
  RESIZE_NOOP_EPSILON,
  beginResizeSession,
  clampIconScale,
  isResizableEntity,
  isResizeHandoffCaughtUp,
  isResizeNoop,
  reconcileResizeHandoff,
  resizeScaleAt,
  resolveDisplayScale,
  withIconScale,
} from "./app-resize";
import type { PendingResizeHandoff, ResizeCorner } from "./app-resize";

/**
 * The anchor used throughout: the icon tile's visual center. A pointer 100px
 * to the right of it at scale 1 is the reference distance for every case.
 */
const ANCHOR = { centerX: 500, centerY: 400 };
const REFERENCE_POINTER = { pointerX: 600, pointerY: 400 };

function sessionAt(corner: ResizeCorner, startScale = 1) {
  return beginResizeSession({
    corner,
    startScale,
    ...ANCHOR,
    ...REFERENCE_POINTER,
  });
}

function makeApp(overrides: Partial<AppShortcut> = {}): AppShortcut {
  return {
    kind: "app",
    id: "app-1",
    name: "GitHub",
    url: "https://github.com",
    icon: { kind: "generated", text: "GI" },
    openMode: "new-tab",
    tags: [],
    ...overrides,
  };
}

function makeWorkspace(app: AppShortcut): WorkspaceSnapshot {
  return {
    id: "ws-1",
    name: "My VelaDesk",
    revision: 3,
    categories: [],
    preferences: {
      defaultPageId: "page",
      theme: "dark",
      wallpapers: [],
      appearance: { colorMode: "dark", wallpaperPreset: "aurora", accentColor: "#7aa2f7" },
    },
    entities: [app],
    pages: [
      {
        id: "page",
        name: "Home",
        layout: {
          grid: { columns: 6, rows: 4 },
          items: [
            {
              id: app.id,
              kind: "app",
              position: { column: 2, row: 1 },
              span: { columns: 1, rows: 1 },
            },
          ],
        },
      },
    ],
    dock: { items: [] },
  } as unknown as WorkspaceSnapshot;
}

describe("clampIconScale", () => {
  it("keeps in-range scales untouched", () => {
    expect(clampIconScale(1)).toBe(1);
    expect(clampIconScale(1.37)).toBe(1.37);
    expect(clampIconScale(MIN_ICON_SCALE)).toBe(MIN_ICON_SCALE);
    expect(clampIconScale(MAX_ICON_SCALE)).toBe(MAX_ICON_SCALE);
  });

  it("clamps beyond both ends of the semantic range", () => {
    expect(clampIconScale(0.1)).toBe(MIN_ICON_SCALE);
    expect(clampIconScale(-3)).toBe(MIN_ICON_SCALE);
    expect(clampIconScale(0)).toBe(MIN_ICON_SCALE);
    expect(clampIconScale(9)).toBe(MAX_ICON_SCALE);
  });

  it("never yields NaN or Infinity", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(Number.isFinite(clampIconScale(value))).toBe(true);
    }
  });
});

describe("beginResizeSession", () => {
  it("records the anchor, the start scale, the corner and the start distance", () => {
    const session = sessionAt("se", 1.25);

    expect(session).toEqual({
      corner: "se",
      startScale: 1.25,
      centerX: ANCHOR.centerX,
      centerY: ANCHOR.centerY,
      startPointerDistance: 100,
    });
  });

  it("refuses a session whose start distance cannot scale anything", () => {
    const onTheAnchor = {
      corner: "nw" as const,
      startScale: 1,
      ...ANCHOR,
      pointerX: ANCHOR.centerX,
      pointerY: ANCHOR.centerY,
    };
    expect(beginResizeSession(onTheAnchor)).toBeUndefined();
    expect(beginResizeSession({ ...onTheAnchor, pointerX: ANCHOR.centerX + 1 })).toBeUndefined();
  });

  it("refuses non-finite pointer input", () => {
    expect(
      beginResizeSession({
        corner: "ne",
        startScale: 1,
        ...ANCHOR,
        pointerX: Number.NaN,
        pointerY: ANCHOR.centerY,
      })
    ).toBeUndefined();
  });
});

describe("resizeScaleAt", () => {
  it("keeps the start scale while the pointer stays at the reference distance", () => {
    const session = sessionAt("se")!;
    expect(resizeScaleAt(session, 600, 400)).toBe(1);
  });

  it("grows uniformly when the pointer moves away from the anchor", () => {
    const session = sessionAt("se")!;
    expect(resizeScaleAt(session, 700, 400)).toBe(2);
    expect(resizeScaleAt(session, 650, 400)).toBe(1.5);
  });

  it("shrinks uniformly when the pointer moves toward the anchor", () => {
    const session = sessionAt("se")!;
    expect(resizeScaleAt(session, 550, 400)).toBe(0.5);
    expect(resizeScaleAt(session, 575, 400)).toBe(0.75);
  });

  it("measures distance in both axes, not just horizontally", () => {
    const session = sessionAt("se")!;
    // (500, 500) is 100px away vertically → the same distance as the reference.
    expect(resizeScaleAt(session, 500, 500)).toBe(1);
    // A 3-4-5 offset is 100px away diagonally → still the reference distance.
    expect(resizeScaleAt(session, 580, 460)).toBe(1);
    // Scaling that same 3-4-5 offset by 1.2 is 120px away → scale 1.2.
    expect(resizeScaleAt(session, 572, 496)).toBeCloseTo(1.2, 10);
  });

  it("scales relative to the start scale, not from 1", () => {
    const session = sessionAt("se", 1.2)!;
    expect(resizeScaleAt(session, 700, 400)).toBe(2);
    expect(resizeScaleAt(session, 550, 400)).toBe(0.6);
  });

  it("uses ONE math path for all four corners", () => {
    // Every corner scales uniformly around the same anchor: whichever handle
    // the user grabs, the same pointer geometry yields the same scale.
    const results = RESIZE_CORNERS.map((corner) => resizeScaleAt(sessionAt(corner)!, 650, 400));
    expect(results).toEqual([1.5, 1.5, 1.5, 1.5]);
  });

  it("clamps at the minimum and the maximum", () => {
    const session = sessionAt("nw")!;
    expect(resizeScaleAt(session, ANCHOR.centerX, ANCHOR.centerY)).toBe(MIN_ICON_SCALE);
    expect(resizeScaleAt(session, 5000, 400)).toBe(MAX_ICON_SCALE);
    expect(resizeScaleAt(session, -9000, -9000)).toBe(MAX_ICON_SCALE);
  });

  it("degrades to the start scale for non-finite pointer math", () => {
    const session = sessionAt("sw", 1.3)!;
    // A garbage pointer reading must never move the icon.
    expect(resizeScaleAt(session, Number.NaN, 400)).toBe(1.3);
    expect(resizeScaleAt(session, Number.POSITIVE_INFINITY, 400)).toBe(1.3);
  });
});

describe("isResizableEntity", () => {
  it("accepts apps only", () => {
    expect(isResizableEntity({ kind: "app" })).toBe(true);
    expect(isResizableEntity({ kind: "folder" })).toBe(false);
    expect(isResizableEntity({ kind: "widget" })).toBe(false);
    expect(isResizableEntity(undefined)).toBe(false);
  });
});

describe("isResizeNoop", () => {
  it("treats sub-epsilon differences as no-ops", () => {
    expect(isResizeNoop(1, 1)).toBe(true);
    expect(isResizeNoop(1, 1 + RESIZE_NOOP_EPSILON / 2)).toBe(true);
    expect(isResizeNoop(1, 1 - RESIZE_NOOP_EPSILON / 2)).toBe(true);
  });

  it("treats a real change as an edit", () => {
    expect(isResizeNoop(1, 1 + RESIZE_NOOP_EPSILON * 2)).toBe(false);
    expect(isResizeNoop(1, 1.2)).toBe(false);
    expect(isResizeNoop(2, 0.5)).toBe(false);
  });
});

describe("withIconScale", () => {
  it("writes only the visual scale", () => {
    const app = makeApp({ visual: { iconScale: 1, decorationStyle: "glass", foregroundColor: "#aabbcc" } });
    const scaled = withIconScale(app, 1.8);

    expect(scaled.visual).toEqual({
      iconScale: 1.8,
      decorationStyle: "glass",
      foregroundColor: "#aabbcc",
    });
    expect(scaled.id).toBe(app.id);
    expect(scaled.icon).toEqual(app.icon);
  });

  it("gives a legacy app its first stored style at the clamped scale", () => {
    expect(withIconScale(makeApp(), 2.5).visual).toEqual({
      iconScale: MAX_ICON_SCALE,
      decorationStyle: "gradient",
    });
  });

  it("leaves the logical layout completely untouched", () => {
    const app = makeApp();
    const workspace = makeWorkspace(app);
    const before = workspace.pages[0]!.layout;
    const after = withIconScale(app, MAX_ICON_SCALE);

    expect(after.id).toBe(before.items[0]!.id);
    // Scale is a visual multiplier only: position, span and grid never move.
    expect(workspace.pages[0]!.layout).toBe(before);
    expect(before.items[0]!.position).toEqual({ column: 2, row: 1 });
    expect(before.items[0]!.span).toEqual({ columns: 1, rows: 1 });
    expect(before.grid).toEqual({ columns: 6, rows: 4 });
  });
});

describe("resize handoff", () => {
  const handoff: PendingResizeHandoff = { token: 4, appId: "app-1", scale: 1.8 };

  it("shows the pending scale for its own app and the persisted one elsewhere", () => {
    expect(resolveDisplayScale(handoff, "app-1", 1)).toBe(1.8);
    expect(resolveDisplayScale(handoff, "app-2", 1)).toBe(1);
    expect(resolveDisplayScale(null, "app-1", 1)).toBe(1);
  });

  it("is caught up once the authoritative snapshot carries the final scale", () => {
    expect(isResizeHandoffCaughtUp(handoff, 1.8)).toBe(true);
    expect(isResizeHandoffCaughtUp(handoff, 1)).toBe(false);
    expect(isResizeHandoffCaughtUp(null, 1)).toBe(true);
    expect(isResizeHandoffCaughtUp(handoff, undefined)).toBe(true);
  });

  it("tolerates float noise when deciding the handoff is caught up", () => {
    expect(isResizeHandoffCaughtUp(handoff, 1.8 + RESIZE_NOOP_EPSILON / 4)).toBe(true);
  });

  it("keeps the handoff while its stage is in flight", () => {
    expect(reconcileResizeHandoff(handoff, 1, false)).toBe(handoff);
  });

  it("drops the handoff once the snapshot caught up — without a flash", () => {
    expect(reconcileResizeHandoff(handoff, 1.8, false)).toBeNull();
  });

  it("drops the handoff when the app vanished", () => {
    expect(reconcileResizeHandoff(handoff, undefined, false)).toBeNull();
  });

  it("drops a settled handoff that the snapshot never matched (stage failure)", () => {
    // The only true revert: the authoritative scale stays at the start value.
    expect(reconcileResizeHandoff(handoff, 1, true)).toBeNull();
  });

  it("leaves no handoff behind when there was none", () => {
    expect(reconcileResizeHandoff(null, 1, false)).toBeNull();
  });
});
