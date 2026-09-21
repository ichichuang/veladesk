import { describe, expect, it } from "vitest";

import {
  appendGridItem,
  canConvertGridToFreeform,
  canvasRectToGridGeometry,
  clampGridTranslation,
  firstFreeGridPlacement,
  freeformLayoutFromV1,
  gridItemToCanvasRect,
  gridItemsEqual,
  gridLayoutFromV1,
  gridLayoutToFreeform,
  maxOccupiedRow,
  replaceGridItem,
  resizeGridItem,
  translateGridItems,
  validateGridCanvasItems,
} from "./grid";
import { areCanvasLayoutsEqual, validateCanvasLayout } from "./layout";
import type { CanvasLayoutV1, GridCanvasItem, GridCanvasLayoutV2 } from "./types";

const GRID_6X5 = { columns: 6, rows: 5 };

function gitem(
  id: string,
  column: number,
  row: number,
  columnSpan = 1,
  rowSpan = 1,
): GridCanvasItem {
  return { id, column, row, columnSpan, rowSpan };
}

function grid(items: readonly GridCanvasItem[], columns = 6): GridCanvasLayoutV2 {
  return { version: 2, mode: "grid", columns, items };
}

describe("validateCanvasLayout — v2 grid", () => {
  it("accepts a valid grid layout", () => {
    const layout = grid([gitem("a", 0, 0), gitem("b", 3, 2, 2, 2)]);
    expect(validateCanvasLayout(layout)).toEqual([]);
  });

  it("rejects a non-positive or non-integer column count", () => {
    expect(validateCanvasLayout(grid([], 0))[0]).toEqual({ type: "invalid-columns", columns: 0 });
    expect(validateCanvasLayout(grid([], 2.5))[0]).toEqual({ type: "invalid-columns", columns: 2.5 });
  });

  it("requires safe-integer geometry", () => {
    const issues = validateGridCanvasItems([gitem("a", 0.5, 0)], 6);
    expect(issues).toEqual([
      { type: "invalid-grid-item", itemId: "a", problems: ["not-safe-integer"] },
    ]);
  });

  it("rejects negative positions and spans below one", () => {
    expect(validateGridCanvasItems([gitem("a", -1, 0)], 6)).toEqual([
      { type: "invalid-grid-item", itemId: "a", problems: ["negative-position"] },
    ]);
    expect(validateGridCanvasItems([gitem("a", 0, 0, 0, 1)], 6)).toEqual([
      { type: "invalid-grid-item", itemId: "a", problems: ["span-below-minimum"] },
    ]);
  });

  it("bounds columns but never rows", () => {
    expect(validateGridCanvasItems([gitem("a", 5, 0, 2, 1)], 6)).toEqual([
      { type: "invalid-grid-item", itemId: "a", problems: ["exceeds-columns"] },
    ]);
    // Row is unbounded: any row bottom stays legal.
    expect(validateGridCanvasItems([gitem("a", 0, 9_999_999)], 6)).toEqual([]);
  });

  it("reports duplicate ids and keeps overlap legal", () => {
    const overlapping = grid([gitem("a", 0, 0, 3, 3), gitem("b", 1, 1, 2, 2)]);
    expect(validateCanvasLayout(overlapping)).toEqual([]);

    const duplicated = grid([gitem("a", 0, 0), gitem("a", 2, 2)]);
    expect(validateCanvasLayout(duplicated)).toEqual([
      { type: "duplicate-item-id", itemId: "a" },
    ]);
  });
});

describe("grid item helpers", () => {
  it("compares items field by field", () => {
    expect(gridItemsEqual(gitem("a", 1, 2, 3, 4), gitem("a", 1, 2, 3, 4))).toBe(true);
    expect(gridItemsEqual(gitem("a", 1, 2, 3, 4), gitem("a", 1, 2, 3, 5))).toBe(false);
  });

  it("replaces and appends without touching order", () => {
    const base = grid([gitem("a", 0, 0), gitem("b", 1, 0)]);
    const next = replaceGridItem(base, gitem("b", 2, 3));
    expect(next.items.map((item) => [item.id, item.column, item.row])).toEqual([
      ["a", 0, 0],
      ["b", 2, 3],
    ]);
    // Equal replacement returns the input reference.
    expect(replaceGridItem(next, gitem("b", 2, 3))).toBe(next);
    // Unknown id returns the input reference.
    expect(replaceGridItem(next, gitem("zz", 0, 0))).toBe(next);
    expect(appendGridItem(next, gitem("c", 0, 5)).items.map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("computes the greatest occupied row bottom", () => {
    expect(maxOccupiedRow([])).toBe(0);
    expect(maxOccupiedRow([gitem("a", 0, 0), gitem("b", 0, 7, 1, 3)])).toBe(10);
  });
});

describe("translateGridItems", () => {
  const pair = grid([gitem("a", 1, 1, 2, 2), gitem("b", 3, 2, 1, 1), gitem("c", 0, 0)]);

  it("moves the whole selection by one rigid integer delta", () => {
    const next = translateGridItems(pair, ["a", "b"], 1, 2);
    expect(next.items.map((item) => [item.id, item.column, item.row])).toEqual([
      ["a", 2, 3],
      ["b", 4, 4],
      ["c", 0, 0],
    ]);
  });

  it("clamps horizontally so every selected item stays inside the columns", () => {
    const next = translateGridItems(pair, ["a", "b"], 10, 0);
    // b ends at column 5..6 — clamped so b's right edge is exactly columns.
    expect(next.items[1]).toMatchObject({ id: "b", column: 5 });
    expect(next.items[0]).toMatchObject({ id: "a", column: 3 });
    // The clamp is one delta for the group: both moved by +2.
    expect(next.items[1]!.column - pair.items[1]!.column).toBe(2);
  });

  it("clamps at row 0 downward-unbounded: any downward delta survives", () => {
    const down = translateGridItems(pair, ["a"], 0, 500);
    expect(down.items[0]).toMatchObject({ row: 501 });

    const up = translateGridItems(pair, ["a"], 0, -500);
    expect(up.items[0]).toMatchObject({ row: 0 });
    // But the unselected item never moves.
    expect(up.items[2]).toMatchObject({ row: 0, column: 0 });
  });

  it("returns the input reference for a no-op translation", () => {
    expect(translateGridItems(pair, ["a"], 0, 0)).toBe(pair);
    expect(translateGridItems(pair, ["a"], 0.4, 0.4)).toBe(pair);
  });

  it("clamps non-finite deltas to zero", () => {
    expect(clampGridTranslation(pair, ["a"], Number.NaN, 3)).toEqual({
      columnDelta: 0,
      rowDelta: 0,
    });
  });
});

describe("resizeGridItem — eight handles", () => {
  const base = grid([gitem("a", 2, 2, 2, 2)], 6);

  it("e/w change columns only", () => {
    const e = resizeGridItem(base, "a", "e", 1, 5);
    expect(e.items[0]).toMatchObject({ column: 2, row: 2, columnSpan: 3, rowSpan: 2 });

    const w = resizeGridItem(base, "a", "w", -1, 5);
    expect(w.items[0]).toMatchObject({ column: 1, row: 2, columnSpan: 3, rowSpan: 2 });
  });

  it("n/s change rows only", () => {
    const s = resizeGridItem(base, "a", "s", 5, 2);
    expect(s.items[0]).toMatchObject({ column: 2, row: 2, columnSpan: 2, rowSpan: 4 });

    const n = resizeGridItem(base, "a", "n", 5, -1);
    expect(n.items[0]).toMatchObject({ column: 2, row: 1, columnSpan: 2, rowSpan: 3 });
  });

  it("corners change both axes", () => {
    const se = resizeGridItem(base, "a", "se", 1, 1);
    expect(se.items[0]).toMatchObject({ column: 2, row: 2, columnSpan: 3, rowSpan: 3 });

    const nw = resizeGridItem(base, "a", "nw", -1, -1);
    expect(nw.items[0]).toMatchObject({ column: 1, row: 1, columnSpan: 3, rowSpan: 3 });
  });

  it("keeps a 1×1 minimum and never crosses the opposite edge", () => {
    const shrinkE = resizeGridItem(base, "a", "e", -9, 0);
    expect(shrinkE.items[0]).toMatchObject({ column: 2, columnSpan: 1 });

    const crossW = resizeGridItem(base, "a", "w", 9, 0);
    expect(crossW.items[0]).toMatchObject({ column: 3, columnSpan: 1 });

    const shrinkS = resizeGridItem(base, "a", "s", 0, -9);
    expect(shrinkS.items[0]).toMatchObject({ row: 2, rowSpan: 1 });

    const crossN = resizeGridItem(base, "a", "n", 0, 9);
    expect(crossN.items[0]).toMatchObject({ row: 3, rowSpan: 1 });
  });

  it("respects the column count horizontally and is unbounded vertically", () => {
    const wide = resizeGridItem(base, "a", "e", 9, 0);
    expect(wide.items[0]).toMatchObject({ column: 2, columnSpan: 4 });

    const tall = resizeGridItem(base, "a", "s", 0, 9_999);
    expect(tall.items[0]).toMatchObject({ rowSpan: 2 + 9_999 });
  });

  it("keeps west/north origins at zero minimum and returns the input for no-ops", () => {
    const origin = grid([gitem("a", 0, 0)], 6);
    const w = resizeGridItem(origin, "a", "w", -5, 0);
    expect(w.items[0]).toMatchObject({ column: 0, columnSpan: 1 });

    expect(resizeGridItem(base, "a", "se", 0, 0)).toBe(base);
    expect(resizeGridItem(base, "ghost", "se", 1, 1)).toBe(base);
  });
});

describe("firstFreeGridPlacement", () => {
  it("scans row-major for the first fitting location", () => {
    const layout = grid([
      gitem("a", 0, 0, 3, 1),
      gitem("b", 3, 0, 3, 1),
      gitem("c", 0, 1, 2, 1),
    ]);
    // Row 0 full, row 1 has columns 2..5 free.
    expect(firstFreeGridPlacement(layout, { columnSpan: 1, rowSpan: 1 })).toEqual({
      column: 2,
      row: 1,
    });
    // A 5-wide span does not fit any row-1 gap (4 wide) → row 2.
    expect(firstFreeGridPlacement(layout, { columnSpan: 5, rowSpan: 1 })).toEqual({
      column: 0,
      row: 2,
    });
  });

  it("always finds a spot — rows are unbounded", () => {
    const full = grid(
      Array.from({ length: 24 }, (_, index) => gitem(`c${index}`, index % 6, Math.floor(index / 6))),
      6,
    );
    expect(firstFreeGridPlacement(full, { columnSpan: 1, rowSpan: 1 })).toEqual({
      column: 0,
      row: 4,
    });
  });

  it("honours an origin for dissolve-style cascades", () => {
    const layout = grid([gitem("a", 0, 0), gitem("b", 1, 0)]);
    expect(
      firstFreeGridPlacement(layout, { columnSpan: 1, rowSpan: 1 }, { column: 1, row: 0 }),
    ).toEqual({ column: 2, row: 0 });
  });
});

describe("v1 snap → v2 grid conversion", () => {
  it("converts rect edges to lattice indexes, never through pixels", () => {
    // On a 6×5 lattice the first column edge is 0, second 1667, …
    expect(canvasRectToGridGeometry({ x: 0, y: 0, width: 1667, height: 2000 }, GRID_6X5)).toEqual({
      column: 0,
      row: 0,
      columnSpan: 1,
      rowSpan: 1,
    });
    expect(
      canvasRectToGridGeometry({ x: 1667, y: 2000, width: 3333, height: 4000 }, GRID_6X5),
    ).toEqual({ column: 1, row: 1, columnSpan: 2, rowSpan: 2 });
  });

  it("expands degenerate spans to one cell and stays inside the columns", () => {
    // A tiny rect around the last column start still becomes one cell.
    expect(canvasRectToGridGeometry({ x: 8500, y: 0, width: 10, height: 10 }, GRID_6X5)).toEqual({
      column: 5,
      row: 0,
      columnSpan: 1,
      rowSpan: 1,
    });
  });

  it("keeps ids, order and derives columns from the page grid", () => {
    const v1: CanvasLayoutV1 = {
      version: 1,
      mode: "snap",
      items: [
        { id: "a", rect: { x: 0, y: 0, width: 1667, height: 2000 } },
        { id: "b", rect: { x: 5000, y: 4000, width: 1667, height: 2000 } },
      ],
    };
    const converted = gridLayoutFromV1(v1, GRID_6X5);
    expect(converted).toEqual({
      version: 2,
      mode: "grid",
      columns: 6,
      items: [gitem("a", 0, 0), gitem("b", 3, 2)],
    });
  });
});

describe("v1 freeform → v2 freeform conversion", () => {
  it("keeps every rect unchanged", () => {
    const v1: CanvasLayoutV1 = {
      version: 1,
      mode: "freeform",
      items: [{ id: "a", rect: { x: 137, y: 991, width: 1234, height: 567 } }],
    };
    expect(freeformLayoutFromV1(v1)).toEqual({
      version: 2,
      mode: "freeform",
      items: v1.items,
    });
  });
});

describe("Grid → Freeform lossless boundary", () => {
  it("maps grid items onto lattice rects", () => {
    expect(gridItemToCanvasRect(gitem("a", 1, 1, 2, 2), GRID_6X5)).toEqual({
      x: 1667,
      y: 2000,
      width: 3333,
      height: 4000,
    });
  });

  it("refuses when content extends beyond the freeform viewport rows", () => {
    const fits = grid([gitem("a", 0, 4, 1, 1)]); // rows 0..4 => row bottom 5 === rows
    expect(canConvertGridToFreeform(fits.items, GRID_6X5)).toBe(true);
    expect(gridLayoutToFreeform(fits, GRID_6X5)).not.toBeNull();

    const overflows = grid([gitem("a", 0, 5, 1, 1)]); // beyond the viewport
    expect(canConvertGridToFreeform(overflows.items, GRID_6X5)).toBe(false);
    expect(gridLayoutToFreeform(overflows, GRID_6X5)).toBeNull();
  });
});

describe("layout equality across versions", () => {
  it("distinguishes grid geometry field by field", () => {
    const a = grid([gitem("x", 0, 0)]);
    const b = grid([gitem("x", 0, 1)]);
    const same = grid([gitem("x", 0, 0)]);
    expect(areCanvasLayoutsEqual(a, b)).toBe(false);
    expect(areCanvasLayoutsEqual(a, same)).toBe(true);
    expect(areCanvasLayoutsEqual(a, grid([gitem("x", 0, 0)], 5))).toBe(false);
  });

  it("distinguishes freeform v2 from v1", () => {
    const v1: CanvasLayoutV1 = { version: 1, mode: "freeform", items: [] };
    const v2 = { version: 2, mode: "freeform" as const, items: [] };
    expect(areCanvasLayoutsEqual(v1, v2)).toBe(false);
  });
});
