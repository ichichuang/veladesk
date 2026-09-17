import { describe, expect, it } from "vitest";

import { clampContextMenuPosition } from "./context-menu-position";

const BASE = {
  viewportWidth: 1440,
  viewportHeight: 900,
  menuWidth: 200,
  menuHeight: 240,
  margin: 8,
};

describe("clampContextMenuPosition", () => {
  it("keeps a normal position untouched", () => {
    expect(clampContextMenuPosition({ ...BASE, x: 400, y: 300 })).toEqual({
      x: 400,
      y: 300,
    });
  });

  it("pulls the menu back inside the right edge", () => {
    expect(clampContextMenuPosition({ ...BASE, x: 1380, y: 300 })).toEqual({
      x: 1440 - 200 - 8,
      y: 300,
    });
  });

  it("pulls the menu back inside the bottom edge", () => {
    expect(clampContextMenuPosition({ ...BASE, x: 400, y: 880 })).toEqual({
      x: 400,
      y: 900 - 240 - 8,
    });
  });

  it("clamps both edges at once", () => {
    expect(clampContextMenuPosition({ ...BASE, x: 1430, y: 895 })).toEqual({
      x: 1440 - 200 - 8,
      y: 900 - 240 - 8,
    });
  });

  it("pins to the margin when the menu is larger than the viewport", () => {
    expect(
      clampContextMenuPosition({
        ...BASE,
        viewportWidth: 400,
        viewportHeight: 300,
        menuWidth: 640,
        menuHeight: 700,
        x: 120,
        y: 140,
      })
    ).toEqual({ x: 8, y: 8 });
  });

  it("clamps negative coordinates to the margin", () => {
    expect(clampContextMenuPosition({ ...BASE, x: -50, y: -80 })).toEqual({
      x: 8,
      y: 8,
    });
  });
});
