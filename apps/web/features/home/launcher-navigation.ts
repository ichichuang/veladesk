/**
 * Pure keyboard navigation for the launcher result list.
 *
 * Keeps the wrap/clamp rules out of the React component: ArrowUp/Down
 * wrap, Home/End jump, an empty list collapses to "no active result"
 * (-1), and an invalid current index counts as none-selected.
 */

export type LauncherNavigationDirection = "next" | "previous" | "first" | "last";

export interface MoveLauncherIndexInput {
  readonly currentIndex: number;
  readonly resultCount: number;
  readonly direction: LauncherNavigationDirection;
}

/**
 * Resolves the next active result index.
 *
 * - `first` → 0, `last` → resultCount - 1
 * - `next`/`previous` wrap around; an out-of-range currentIndex counts as
 *   none-selected (next → 0, previous → last)
 * - any direction on an empty result list → -1
 */
export function moveLauncherIndex(input: MoveLauncherIndexInput): number {
  const { currentIndex, resultCount, direction } = input;
  if (resultCount <= 0) {
    return -1;
  }
  const lastIndex = resultCount - 1;
  switch (direction) {
    case "first":
      return 0;
    case "last":
      return lastIndex;
    case "next":
      if (currentIndex < 0 || currentIndex > lastIndex) {
        return 0;
      }
      return (currentIndex + 1) % resultCount;
    case "previous":
      if (currentIndex < 0 || currentIndex > lastIndex) {
        return lastIndex;
      }
      return (currentIndex - 1 + resultCount) % resultCount;
  }
}
