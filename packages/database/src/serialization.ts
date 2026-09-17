import type { WorkspaceSnapshot } from "@veladesk/domain";

/**
 * Version of the persisted WorkspaceSnapshot JSON structure.
 *
 * This is independent from the package version (0.1.0): bump it when the
 * Domain JSON shape changes so persistence migrations can tell stored
 * snapshots apart.
 */
export const WORKSPACE_SNAPSHOT_VERSION = 1;

/** Serializes a validated snapshot with standard JSON. */
export function serializeWorkspaceSnapshot(snapshot: WorkspaceSnapshot): string {
  return JSON.stringify(snapshot);
}

/**
 * Decodes a stored snapshot.
 *
 * V1 only defends on JSON syntax and the snapshot version: rows are only
 * written from snapshots that already passed `validateWorkspace`, so the
 * database layer does not re-implement the Workspace runtime schema. Bad
 * input throws with explicit messages instead of being swallowed.
 */
export function deserializeWorkspaceSnapshot(
  json: string,
  snapshotVersion: number,
): WorkspaceSnapshot {
  if (snapshotVersion !== WORKSPACE_SNAPSHOT_VERSION) {
    throw new Error(
      `unsupported snapshot version: ${snapshotVersion} (expected ${WORKSPACE_SNAPSHOT_VERSION})`,
    );
  }

  try {
    return JSON.parse(json) as WorkspaceSnapshot;
  } catch (error) {
    throw new Error("stored workspace snapshot cannot be decoded", { cause: error });
  }
}
