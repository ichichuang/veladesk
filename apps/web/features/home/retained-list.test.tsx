// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useRetainedRows } from "./retained-list";

interface Item {
  readonly id: string;
  readonly label: string;
}

function items(...ids: readonly string[]): readonly Item[] {
  return ids.map((id) => ({ id, label: `item-${id}` }));
}

describe("useRetainedRows (audit A10)", () => {
  afterEach(cleanup);

  it("passes live items through with their keys, nothing exiting", () => {
    const { result } = renderHook(({ value }) => useRetainedRows(value, (item: Item) => item.id), {
      initialProps: { value: items("a", "b") },
    });
    const rows = result.current;
    expect(rows.map((row) => row.key)).toEqual(["a", "b"]);
    expect(rows.every((row) => !row.exiting)).toBe(true);
    expect(rows[0]!.item.label).toBe("item-a");
  });

  it("retains a removed row at its old position until released", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useRetainedRows(value, (item: Item) => item.id),
      { initialProps: { value: items("a", "b", "c") } },
    );
    rerender({ value: items("a", "c") });
    const rows = result.current;
    // "b" stays mounted BETWEEN a and c while its exit plays.
    expect(rows.map((row) => row.key)).toEqual(["a", "b", "c"]);
    expect(rows.map((row) => row.exiting)).toEqual([false, true, false]);

    act(() => {
      rows.find((row) => row.key === "b")!.release();
    });
    expect(result.current.map((row) => row.key)).toEqual(["a", "c"]);
    expect(result.current.every((row) => !row.exiting)).toBe(true);
  });

  it("drops a retained row that comes back before its release", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useRetainedRows(value, (item: Item) => item.id),
      { initialProps: { value: items("a", "b") } },
    );
    rerender({ value: items("a") });
    expect(result.current.map((row) => row.key)).toEqual(["a", "b"]);
    expect(result.current.find((row) => row.key === "b")!.exiting).toBe(true);

    // "b" returns before its exit finished: it is live again, never both.
    rerender({ value: items("a", "b") });
    const rows = result.current;
    expect(rows.map((row) => row.key)).toEqual(["a", "b"]);
    expect(rows.every((row) => !row.exiting)).toBe(true);
  });

  it("keeps remaining exits when several rows vanish at once", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useRetainedRows(value, (item: Item) => item.id),
      { initialProps: { value: items("a", "b", "c", "d") } },
    );
    rerender({ value: items("b") });
    expect(result.current.map((row) => row.key)).toEqual(["a", "b", "c", "d"]);
    act(() => {
      result.current.find((row) => row.key === "a")!.release();
    });
    // Releasing one exit keeps the others retained in order.
    expect(result.current.map((row) => row.key)).toEqual(["b", "c", "d"]);
    expect(result.current.map((row) => row.exiting)).toEqual([false, true, true]);
  });

  it("always renders live rows from the CURRENT items, never stale values", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useRetainedRows(value, (item: Item) => item.id),
      { initialProps: { value: items("a") } },
    );
    rerender({ value: [{ id: "a", label: "renamed" }] });
    expect(result.current[0]!.item.label).toBe("renamed");
  });
});
