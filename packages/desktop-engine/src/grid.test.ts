import { describe, expect, it } from "vitest";

import { createGridDefinition, isValidGridPosition, isValidGridSpan } from "./grid";

describe("createGridDefinition", () => {
  it("creates a 6 x 4 grid", () => {
    expect(createGridDefinition(6, 4)).toEqual({ columns: 6, rows: 4 });
  });

  it("creates a 1 x 1 grid", () => {
    expect(createGridDefinition(1, 1)).toEqual({ columns: 1, rows: 1 });
  });

  it("throws RangeError for zero columns", () => {
    expect(() => createGridDefinition(0, 4)).toThrow(RangeError);
  });

  it("throws RangeError for negative rows", () => {
    expect(() => createGridDefinition(6, -1)).toThrow(RangeError);
  });

  it("throws RangeError for fractional columns", () => {
    expect(() => createGridDefinition(1.5, 4)).toThrow(RangeError);
  });

  it("throws RangeError for Infinity columns", () => {
    expect(() => createGridDefinition(Number.POSITIVE_INFINITY, 4)).toThrow(RangeError);
  });

  it("throws RangeError for NaN rows", () => {
    expect(() => createGridDefinition(6, Number.NaN)).toThrow(RangeError);
  });
});

describe("isValidGridPosition", () => {
  it("accepts the top-left origin", () => {
    expect(isValidGridPosition({ column: 0, row: 0 })).toBe(true);
  });

  it("accepts positive integer coordinates", () => {
    expect(isValidGridPosition({ column: 3, row: 7 })).toBe(true);
  });

  it("rejects a negative column", () => {
    expect(isValidGridPosition({ column: -1, row: 0 })).toBe(false);
  });

  it("rejects a negative row", () => {
    expect(isValidGridPosition({ column: 0, row: -2 })).toBe(false);
  });

  it("rejects fractional coordinates", () => {
    expect(isValidGridPosition({ column: 1.5, row: 0 })).toBe(false);
    expect(isValidGridPosition({ column: 0, row: 2.5 })).toBe(false);
  });

  it("rejects NaN coordinates", () => {
    expect(isValidGridPosition({ column: Number.NaN, row: 0 })).toBe(false);
    expect(isValidGridPosition({ column: 0, row: Number.NaN })).toBe(false);
  });
});

describe("isValidGridSpan", () => {
  it("accepts positive integer spans", () => {
    expect(isValidGridSpan({ columns: 1, rows: 1 })).toBe(true);
    expect(isValidGridSpan({ columns: 3, rows: 2 })).toBe(true);
  });

  it("rejects zero columns", () => {
    expect(isValidGridSpan({ columns: 0, rows: 1 })).toBe(false);
  });

  it("rejects negative rows", () => {
    expect(isValidGridSpan({ columns: 1, rows: -1 })).toBe(false);
  });

  it("rejects fractional spans", () => {
    expect(isValidGridSpan({ columns: 1.5, rows: 1 })).toBe(false);
    expect(isValidGridSpan({ columns: 1, rows: 0.5 })).toBe(false);
  });

  it("rejects Infinity spans", () => {
    expect(isValidGridSpan({ columns: Number.POSITIVE_INFINITY, rows: 1 })).toBe(false);
  });
});
