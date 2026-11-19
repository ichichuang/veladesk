"use client";

import { useState } from "react";

/**
 * Retained-list rows (audit A10): keep REMOVED entries mounted for exactly
 * as long as their exit animation needs — the same render-phase pattern
 * MotionMenuEntries uses for the workspace menu (adjusting state when a
 * prop changes; no setState inside effects). Pure data: the owner renders
 * `rows` and drives its own exit tween, calling `release()` when it lands.
 *
 * Ordering: a retained row keeps its OLD index while it exits, so the
 * remaining entries never jump past a half-faded neighbour. Live rows are
 * always rendered from the CURRENT items (fresh values, never stale).
 */
export interface RetainedRow<T> {
  readonly item: T;
  readonly key: string;
  readonly exiting: boolean;
  /** The row's exit finished — drop it from the retained set. */
  readonly release: () => void;
}

export function useRetainedRows<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): readonly RetainedRow<T>[] {
  const [previous, setPrevious] = useState(items);
  const [retained, setRetained] = useState<
    readonly { item: T; key: string; index: number }[]
  >([]);

  if (previous !== items) {
    setPrevious(items);
    const live = new Set(items.map(keyOf));
    const kept = retained.filter(({ key }) => !live.has(key));
    const removed = previous
      .map((item, index) => ({ item, key: keyOf(item), index }))
      .filter((row) => !live.has(row.key) && !kept.some((k) => k.key === row.key));
    setRetained([...kept, ...removed]);
  }

  const displayed = items.map((item, index) => ({ item, key: keyOf(item), index }));
  for (const row of retained) {
    displayed.splice(Math.min(row.index, displayed.length), 0, row);
  }
  return displayed.map((row) => ({
    item: row.item,
    key: row.key,
    exiting: retained.some((candidate) => candidate.key === row.key),
    release: () => {
      setRetained((current) => current.filter((candidate) => candidate.key !== row.key));
    },
  }));
}
