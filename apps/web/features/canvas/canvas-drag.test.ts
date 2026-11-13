import { describe, expect, it } from "vitest";
import type { GridCanvasItem, CanvasLayoutItem } from "@veladesk/canvas-engine";
import type { PagePlacement } from "@veladesk/domain";

import {
  commitCanvasDrag,
  gridReflowPreviewPlacement,
  isCanvasDragNoop,
  previewCanvasDrag,
  resolveGridDragPlacement,
  settledGridDropPlacement,
} from "./canvas-drag";
import type { CanvasPixelMetrics } from "./canvas-metrics";

/** Freeform: 10 units per pixel horizontally, 12.5 vertically. */
const metrics: CanvasPixelMetrics = { width: 1000, height: 800 };

function freeform(items: readonly CanvasLayoutItem[]): PagePlacement {
  return { version: 2, mode: "freeform", items };
}

function grid(items: readonly GridCanvasItem[], columns = 6): PagePlacement {
  return { version: 2, mode: "grid", columns, items };
}

const freeformPair = freeform([
  { id: "a", rect: { x: 0, y: 0, width: 1000, height: 1000 } },
  { id: "b", rect: { x: 2000, y: 0, width: 1000, height: 1000 } },
]);

const gridPair = grid([
  { id: "a", column: 1, row: 1, columnSpan: 2, rowSpan: 1 },
  { id: "b", column: 4, row: 2, columnSpan: 1, rowSpan: 2 },
  { id: "c", column: 0, row: 0, columnSpan: 1, rowSpan: 1 },
]);

describe("previewCanvasDrag — freeform", () => {
  it("translates continuously — the preview returns the applied pixel delta", () => {
    const preview = previewCanvasDrag({
      placement: freeformPair,
      itemIds: ["a"],
      deltaX: 13,
      deltaY: 11,
      metrics,
      pitchPx: 1,
    });
    // 13px → 130 logical units → clamped unchanged → back to 13px; the
    // y axis rounds to 138 units → 11.04px on the 800px-tall canvas.
    expect(preview.appliedX).toBeCloseTo(13, 2);
    expect(preview.appliedY).toBeCloseTo(11.04, 2);
  });

  it("clamps the whole group once at the canvas edge", () => {
    const preview = previewCanvasDrag({
      placement: freeformPair,
      itemIds: ["a", "b"],
      deltaX: 9000,
      deltaY: 0,
      metrics,
      pitchPx: 1,
    });
    // b's right edge (3000 + 1000) clamps the group to 7000 logical units
    // → 700px on a 1000px-wide canvas.
    expect(preview.appliedX).toBeCloseTo(700, 2);
    expect(preview.appliedY).toBe(0);
  });
});

describe("previewCanvasDrag — grid", () => {
  it("rounds pointer pixels to whole cells through the pitch", () => {
    // Pitch 88px: 100px → 1 cell; 150px → 2 cells; 40px → 0 cells. The item
    // sits mid-grid so no bound clamps the delta.
    const floating = grid([
      { id: "solo", column: 3, row: 4, columnSpan: 1, rowSpan: 1 },
    ]);
    for (const [deltaPx, cells] of [
      [100, 1],
      [150, 2],
      [40, 0],
      [-100, -1],
      [-140, -2],
    ] as const) {
      const preview = previewCanvasDrag({
        placement: floating,
        itemIds: ["solo"],
        deltaX: deltaPx,
        deltaY: 0,
        metrics,
        pitchPx: 88,
      });
      expect(preview.appliedX).toBe(cells * 88);
    }
  });

  it("crosses the half-pitch threshold symmetrically in both directions (017-B table)", () => {
    // Spec table at pitch 120: abs(delta) < pitch/2 keeps the current
    // cell, abs(delta) >= pitch/2 moves — mirrored for negative deltas.
    const floating = grid([
      { id: "solo", column: 3, row: 4, columnSpan: 1, rowSpan: 1 },
    ]);
    for (const [deltaPx, cells] of [
      [0, 0],
      [59, 0],
      [60, 1],
      [119, 1],
      [180, 2],
      [-59, 0],
      [-60, -1],
      [-119, -1],
      [-180, -2],
    ] as const) {
      const preview = previewCanvasDrag({
        placement: floating,
        itemIds: ["solo"],
        deltaX: deltaPx,
        deltaY: 0,
        metrics,
        pitchPx: 120,
      });
      expect(preview.appliedX, `delta ${deltaPx}`).toBe(cells * 120);
    }
  });

  it("applies one rigid cell delta to the whole selection", () => {
    const moved = commitCanvasDrag({
      placement: gridPair,
      itemIds: ["a", "b"],
      deltaX: 88,
      deltaY: 176,
      metrics,
      pitchPx: 88,
    });
    expect(moved).not.toBeNull();
    const items = moved?.items ?? [];
    expect(items[0]).toMatchObject({ id: "a", column: 2, row: 3 });
    expect(items[1]).toMatchObject({ id: "b", column: 5, row: 4 });
    expect(items[2]).toMatchObject({ id: "c", column: 0, row: 0 });
  });

  it("clamps horizontally inside the column count", () => {
    const moved = commitCanvasDrag({
      placement: gridPair,
      itemIds: ["a"],
      deltaX: 88 * 10,
      deltaY: 0,
      metrics,
      pitchPx: 88,
    });
    // a spans columns 1..3; rightmost legal start is 4 → delta clamps to 3.
    expect(moved?.items[0]).toMatchObject({ column: 4 });
  });

  it("clamps at row 0 and grows downward without bound", () => {
    const up = commitCanvasDrag({
      placement: gridPair,
      itemIds: ["a"],
      deltaX: 0,
      deltaY: -88 * 100,
      metrics,
      pitchPx: 88,
    });
    expect(up?.items[0]).toMatchObject({ row: 0 });

    const down = commitCanvasDrag({
      placement: gridPair,
      itemIds: ["a"],
      deltaX: 0,
      deltaY: 88 * 500,
      metrics,
      pitchPx: 88,
    });
    expect(down?.items[0]).toMatchObject({ row: 501 });
  });

  it("returns null for a sub-threshold (no-op) drag", () => {
    const args = {
      placement: gridPair,
      itemIds: ["a"],
      deltaX: 30,
      deltaY: 0,
      metrics,
      pitchPx: 88,
    } as const;
    expect(isCanvasDragNoop(args)).toBe(true);
    expect(commitCanvasDrag(args)).toBeNull();
  });
});

describe("commitCanvasDrag — freeform", () => {
  it("moves items by the clamped logical delta and returns null on no-op", () => {
    const moved = commitCanvasDrag({
      placement: freeformPair,
      itemIds: ["a", "b"],
      deltaX: 100,
      deltaY: -40,
      metrics,
      pitchPx: 1,
    });
    const items = moved?.items ?? [];
    const a = items[0];
    const b = items[1];
    if (a !== undefined && "rect" in a && b !== undefined && "rect" in b) {
      expect(a.rect.x).toBe(1000);
      expect(b.rect.x).toBe(3000);
      expect(a.rect.y).toBe(0);
    }

    const noop = commitCanvasDrag({
      placement: freeformPair,
      itemIds: ["a"],
      deltaX: 0,
      deltaY: 0,
      metrics,
      pitchPx: 1,
    });
    expect(noop).toBeNull();
  });
});

describe("settledGridDropPlacement — the Helm r2 grid drop settle", () => {
  function gridItems(placement: PagePlacement): readonly GridCanvasItem[] {
    expect(placement.mode).toBe("grid");
    return placement.mode === "grid" ? placement.items : [];
  }

  it("keeps the dropped tile's cells and slides the bystander into the vacated cell", () => {
    const start = grid([
      { id: "a", column: 0, row: 0, columnSpan: 1, rowSpan: 1 },
      { id: "b", column: 1, row: 0, columnSpan: 1, rowSpan: 1 },
    ]);
    // "a" is dragged one cell right, straight onto "b".
    const moved = commitCanvasDrag({
      placement: start,
      itemIds: ["a"],
      deltaX: 100,
      deltaY: 0,
      metrics,
      pitchPx: 100,
    });
    expect(moved).not.toBeNull();
    const settled = settledGridDropPlacement(moved!, start);
    const byId = new Map(gridItems(settled).map((item) => [item.id, item]));
    // The drop is authoritative: "a" stays at its feedback cell…
    expect(byId.get("a")).toMatchObject({ column: 1, row: 0 });
    // …and "b" yields Apple-style into the cell "a" vacated — the t129
    // reflow — never stacks beneath the drop.
    expect(byId.get("b")).toMatchObject({ column: 0, row: 0 });
  });

  it("passes freeform placements through untouched (that path raises z-order instead)", () => {
    const moved = freeform([
      { id: "a", rect: { x: 500, y: 0, width: 1000, height: 1000 } },
    ]);
    expect(settledGridDropPlacement(moved, freeformPair)).toBe(moved);
  });

  it("returns the input reference when the drag landed on no one", () => {
    const start = grid([
      { id: "a", column: 0, row: 0, columnSpan: 1, rowSpan: 1 },
      { id: "b", column: 3, row: 0, columnSpan: 1, rowSpan: 1 },
    ]);
    const moved = commitCanvasDrag({
      placement: start,
      itemIds: ["a"],
      deltaX: 200,
      deltaY: 0,
      metrics,
      pitchPx: 100,
    });
    expect(moved).not.toBeNull();
    expect(settledGridDropPlacement(moved!, start)).toBe(moved);
  });
});

describe("grid drag reflow — the t129 Apple-style live yield", () => {
  function byId(placement: PagePlacement): Map<string, GridCanvasItem> {
    expect(placement.mode).toBe("grid");
    return new Map(
      placement.mode === "grid" ? placement.items.map((item) => [item.id, item]) : [],
    );
  }

  it("cascades the whole row one cell toward the vacated cells", () => {
    // A dense row a,b,c,d: dragging "a" three cells right onto "d" shifts
    // b, c and d ONE cell left each — the hole travels with the pointer,
    // nobody gets pushed down a row.
    const start = grid([
      { id: "a", column: 0, row: 0, columnSpan: 1, rowSpan: 1 },
      { id: "b", column: 1, row: 0, columnSpan: 1, rowSpan: 1 },
      { id: "c", column: 2, row: 0, columnSpan: 1, rowSpan: 1 },
      { id: "d", column: 3, row: 0, columnSpan: 1, rowSpan: 1 },
    ]);
    const moved = commitCanvasDrag({
      placement: start,
      itemIds: ["a"],
      deltaX: 300,
      deltaY: 0,
      metrics,
      pitchPx: 100,
    });
    const settled = byId(moved!);
    expect(settled.get("a")).toMatchObject({ column: 3, row: 0 });
    expect(settled.get("b")).toMatchObject({ column: 0, row: 0 });
    expect(settled.get("c")).toMatchObject({ column: 1, row: 0 });
    expect(settled.get("d")).toMatchObject({ column: 2, row: 0 });
  });

  it("reflows upward for a downward drag onto a lower row", () => {
    const start = grid([
      { id: "a", column: 1, row: 0, columnSpan: 1, rowSpan: 1 },
      { id: "x", column: 1, row: 2, columnSpan: 1, rowSpan: 1 },
    ]);
    const moved = commitCanvasDrag({
      placement: start,
      itemIds: ["a"],
      deltaX: 0,
      deltaY: 200,
      metrics,
      pitchPx: 100,
    });
    const settled = byId(moved!);
    expect(settled.get("a")).toMatchObject({ column: 1, row: 2 });
    expect(settled.get("x")).toMatchObject({ column: 1, row: 1 });
  });

  it("never moves bystanders the dragged set did not cross", () => {
    // "e" sits past the drop with a deliberate gap before it — intentional
    // saved holes survive a drag that never touches them (t129 rule).
    const start = grid([
      { id: "a", column: 0, row: 0, columnSpan: 1, rowSpan: 1 },
      { id: "b", column: 1, row: 0, columnSpan: 1, rowSpan: 1 },
      { id: "e", column: 4, row: 0, columnSpan: 1, rowSpan: 1 },
    ]);
    const moved = commitCanvasDrag({
      placement: start,
      itemIds: ["a"],
      deltaX: 100,
      deltaY: 0,
      metrics,
      pitchPx: 100,
    });
    const settled = byId(moved!);
    expect(settled.get("b")).toMatchObject({ column: 0, row: 0 });
    expect(settled.get("e")).toMatchObject({ column: 4, row: 0 });
  });

  it("previews the bystanders' committed cells with the dragged slots at their origin", () => {
    const start = grid([
      { id: "a", column: 0, row: 0, columnSpan: 1, rowSpan: 1 },
      { id: "b", column: 1, row: 0, columnSpan: 1, rowSpan: 1 },
      { id: "c", column: 2, row: 0, columnSpan: 1, rowSpan: 1 },
    ]);
    const args = {
      placement: start,
      itemIds: ["a"],
      deltaX: 200,
      deltaY: 0,
      metrics,
      pitchPx: 100,
    } as const;
    const preview = gridReflowPreviewPlacement(args);
    const previewById = byId(preview);
    // The dragged slot stays at its origin (the pointer-following source
    // and the drop placeholder carry the target)…
    expect(previewById.get("a")).toMatchObject({ column: 0, row: 0 });
    // …while the bystanders already sit at their committed cells.
    expect(previewById.get("b")).toMatchObject({ column: 0, row: 0 });
    expect(previewById.get("c")).toMatchObject({ column: 1, row: 0 });
    const committed = byId(commitCanvasDrag(args)!);
    expect(committed.get("a")).toMatchObject({ column: 2, row: 0 });
    expect(committed.get("b")).toMatchObject({ column: 0, row: 0 });
    expect(committed.get("c")).toMatchObject({ column: 1, row: 0 });
  });

  it("returns the input reference for a delta that reflows nothing", () => {
    const floating = grid([
      { id: "solo", column: 3, row: 4, columnSpan: 1, rowSpan: 1 },
    ]);
    expect(
      gridReflowPreviewPlacement({
        placement: floating,
        itemIds: ["solo"],
        deltaX: 40, // below the half-pitch threshold — no resolved delta
        deltaY: 0,
        metrics,
        pitchPx: 100,
      }),
    ).toBe(floating);
  });
});

describe("grid drag resolution — the t163 stability contract", () => {
  function overlaps(p: PagePlacement): string[] {
    const bad: string[] = [];
    const items = p.items as GridCanvasItem[];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!;
        const b = items[j]!;
        if (
          a.column < b.column + b.columnSpan &&
          b.column < a.column + a.columnSpan &&
          a.row < b.row + b.rowSpan &&
          b.row < a.row + a.rowSpan
        ) {
          bad.push(`${a.id}*${b.id}`);
        }
      }
    }
    return bad;
  }

  it("keeps the resolved slot through boundary jitter (hysteresis)", () => {
    // Pitch 100: the 0→1 boundary sits at 50px. Once the drag resolves to 1,
    // pointer jitter back across 50 must NOT flip the slot home — only a
    // crossing below 50 − hysteresis (35px) switches back.
    const floating = grid([{ id: "solo", column: 3, row: 4, columnSpan: 1, rowSpan: 1 }]);
    const resolve = (deltaX: number, session: Parameters<typeof resolveGridDragPlacement>[1]) =>
      resolveGridDragPlacement(
        { placement: floating, itemIds: ["solo"], deltaX, deltaY: 0, metrics, pitchPx: 100 },
        session,
      );
    const first = resolve(100, null);
    expect(first.columnDelta).toBe(1);
    for (const jitterPx of [50.4, 35.1, 49.9, 36, 50.49]) {
      const frame = resolve(jitterPx, first.session);
      expect(frame.columnDelta, `jitter ${jitterPx}px`).toBe(1);
    }
    // Past the hysteresis margin the slot does switch home.
    expect(resolve(34.9, first.session).columnDelta).toBe(0);
  });

  it("refuses an impossible target instead of scrambling (rubber-band)", () => {
    // Two packed rows around "b": row a(2x2)+c(1x1)+d(2x1) and below it
    // e(2x1)+f(2x1). Dragging "b" past "d" has no local yield for the
    // 2-wide tile — the old cascade threw "a" across the page. The
    // resolution must keep the drag on the LAST feasible cell and stay
    // legal.
    const dense = grid([
      { id: "a", column: 0, row: 0, columnSpan: 2, rowSpan: 2 },
      { id: "b", column: 2, row: 0, columnSpan: 1, rowSpan: 1 },
      { id: "c", column: 3, row: 0, columnSpan: 1, rowSpan: 1 },
      { id: "d", column: 4, row: 0, columnSpan: 2, rowSpan: 1 },
      { id: "e", column: 2, row: 1, columnSpan: 2, rowSpan: 1 },
      { id: "f", column: 4, row: 1, columnSpan: 2, rowSpan: 1 },
    ]);
    const resolution = resolveGridDragPlacement(
      { placement: dense, itemIds: ["b"], deltaX: 200, deltaY: 0, metrics, pitchPx: 100 },
      null,
    );
    // Feasible at +1 ("c" slides into the vacated cell), not +2.
    expect(resolution.columnDelta).toBe(1);
    expect(overlaps(resolution.placement)).toEqual([]);
    const byId = new Map(resolution.placement.items.map((item) => [item.id, item]));
    expect(byId.get("a")).toMatchObject({ column: 0, row: 0 });
    expect(byId.get("c")).toMatchObject({ column: 2, row: 0 });
  });

  it("is legal (no overlap, in bounds) across a dense mixed-size sweep", () => {
    const dense = grid([
      { id: "a", column: 0, row: 0, columnSpan: 2, rowSpan: 2 },
      { id: "b", column: 2, row: 0, columnSpan: 1, rowSpan: 1 },
      { id: "c", column: 3, row: 0, columnSpan: 1, rowSpan: 1 },
      { id: "d", column: 4, row: 0, columnSpan: 2, rowSpan: 1 },
      { id: "e", column: 2, row: 1, columnSpan: 2, rowSpan: 1 },
      { id: "f", column: 4, row: 1, columnSpan: 2, rowSpan: 1 },
      { id: "g", column: 0, row: 2, columnSpan: 1, rowSpan: 1 },
      { id: "h", column: 1, row: 2, columnSpan: 1, rowSpan: 1 },
      { id: "i", column: 2, row: 2, columnSpan: 2, rowSpan: 2 },
    ]);
    for (let dc = -2; dc <= 3; dc += 1) {
      for (let dr = -1; dr <= 3; dr += 1) {
        const resolution = resolveGridDragPlacement(
          {
            placement: dense,
            itemIds: ["b"],
            deltaX: dc * 100,
            deltaY: dr * 100,
            metrics,
            pitchPx: 100,
          },
          null,
        );
        expect(overlaps(resolution.placement), `delta(${dc},${dr})`).toEqual([]);
        for (const item of resolution.placement.items as GridCanvasItem[]) {
          expect(item.column, `delta(${dc},${dr}) ${item.id}`).toBeGreaterThanOrEqual(0);
          expect(item.column + item.columnSpan, `delta(${dc},${dr}) ${item.id}`).toBeLessThanOrEqual(6);
          expect(item.row, `delta(${dc},${dr}) ${item.id}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("commits exactly the placement the session previewed", () => {
    const start = grid([
      { id: "a", column: 0, row: 0, columnSpan: 1, rowSpan: 1 },
      { id: "b", column: 1, row: 0, columnSpan: 1, rowSpan: 1 },
      { id: "c", column: 2, row: 0, columnSpan: 1, rowSpan: 1 },
    ]);
    const args = {
      placement: start,
      itemIds: ["a"],
      deltaX: 200,
      deltaY: 0,
      metrics,
      pitchPx: 100,
    } as const;
    // The live session resolves with its sticky state…
    const resolution = resolveGridDragPlacement(args, null);
    // …and the release commit, handed the same session, lands it verbatim.
    const committed = commitCanvasDrag(args, resolution.session);
    expect(committed).not.toBeNull();
    expect(committed).toEqual(resolution.placement);
  });
});
