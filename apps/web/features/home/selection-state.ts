/**
 * Pure selection-set transitions for the arrange session.
 *
 * Selection is session-only state over the active page's layout items —
 * these helpers keep every transition immutable and testable.
 */

/** Toggle one item: add when absent, remove when present. */
export function toggleSelection(
  selection: ReadonlySet<string>,
  itemId: string,
): ReadonlySet<string> {
  const next = new Set(selection);
  if (next.has(itemId)) {
    next.delete(itemId);
  } else {
    next.add(itemId);
  }
  return next;
}

/** Drop ids that no longer exist in the current layout. */
export function normalizeSelection(
  selection: ReadonlySet<string>,
  validIds: ReadonlySet<string>,
): ReadonlySet<string> {
  let changed = false;
  const next = new Set<string>();
  for (const id of selection) {
    if (validIds.has(id)) {
      next.add(id);
    } else {
      changed = true;
    }
  }
  return changed ? next : selection;
}

/** Select every given layout item id. */
export function selectAllIds(validIds: ReadonlySet<string>): ReadonlySet<string> {
  return new Set(validIds);
}
