import type { LauncherEntry } from "./launcher-types";

/**
 * Launcher result grouping (task 021-B).
 *
 * Presentation-only: the search ranking is untouched. `searchLauncherEntries`
 * still produces one ranked list; `groupLauncherResults` then slices that
 * list by kind into fixed-priority groups. Within a group the ranking order
 * is preserved exactly; across groups the fixed group priority wins, which
 * mirrors the empty-query discoverability order (commands, then desktop
 * entities, then sections). The quiet per-row type metadata keeps the type
 * readable so the grouping never lies about what a row is.
 *
 * Empty groups are omitted — a group heading is rendered only when the
 * group has visible results.
 */

export type LauncherGroupKind = LauncherEntry["kind"];

export interface LauncherGroup {
  readonly kind: LauncherGroupKind;
  readonly entries: readonly LauncherEntry[];
}

/** Fixed group priority: commands, apps, folders (legacy), sections. */
const GROUP_PRIORITY: readonly LauncherGroupKind[] = [
  "command",
  "app",
  "folder",
  "page",
];

/**
 * Groups ranked results by kind in fixed priority order, preserving the
 * ranking order inside each group and omitting empty groups.
 */
export function groupLauncherResults(
  results: readonly LauncherEntry[],
): readonly LauncherGroup[] {
  const buckets = new Map<LauncherGroupKind, LauncherEntry[]>();
  for (const entry of results) {
    const bucket = buckets.get(entry.kind);
    if (bucket === undefined) {
      buckets.set(entry.kind, [entry]);
    } else {
      bucket.push(entry);
    }
  }
  const groups: LauncherGroup[] = [];
  for (const kind of GROUP_PRIORITY) {
    const entries = buckets.get(kind);
    if (entries !== undefined) {
      groups.push({ kind, entries });
    }
  }
  return groups;
}

/**
 * The flat row order the listbox renders: groups concatenated in priority
 * order. This is the index space of the keyboard navigation — what is
 * visually adjacent is what ArrowUp/ArrowDown walks.
 */
export function flattenLauncherGroups(
  groups: readonly LauncherGroup[],
): readonly LauncherEntry[] {
  return groups.flatMap((group) => group.entries);
}
