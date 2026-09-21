import type { WorkspacePreferences } from "./types";

/**
 * Layout-geometry preferences of a workspace.
 *
 * `gridGapPx` is the gap between Grid cells. It is a real geometry input —
 * it changes item pixel dimensions, drag pitch, resize pitch, content
 * height and the visible grid — which is why it lives here and not inside
 * the appearance preferences.
 */

/** Default grid gap. */
export const DEFAULT_GRID_GAP_PX = 16;

/** Inclusive bounds of the persisted grid gap. */
export const MIN_GRID_GAP_PX = 0;
export const MAX_GRID_GAP_PX = 32;

/** Settings/toolbar step of the grid gap. */
export const GRID_GAP_STEP_PX = 4;

/**
 * The workspace's effective grid gap: the persisted one when present and
 * valid, otherwise the default for legacy snapshots. Out-of-range values
 * resolve to the default (they are reported by `validateWorkspace`).
 * Pure — no mutation.
 */
export function resolveGridGapPx(preferences: WorkspacePreferences): number {
  const value = preferences.gridGapPx;
  if (typeof value === "number" && isValidGridGapPx(value)) {
    return value;
  }
  return DEFAULT_GRID_GAP_PX;
}

/** Integer 0..32 — the whole semantic range of the persisted gap. */
export function isValidGridGapPx(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_GRID_GAP_PX && value <= MAX_GRID_GAP_PX;
}
