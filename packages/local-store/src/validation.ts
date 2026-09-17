/**
 * Input invariants of @veladesk/local-store.
 *
 * Domain snapshot rules are NOT reimplemented here — `validateWorkspace`
 * from @veladesk/domain stays the single source of truth. This module only
 * guards local-store-specific contracts: clock values, revision/generation
 * integers, and identifier blanks.
 */

import { validateWorkspace } from "@veladesk/domain";
import type { WorkspaceId, WorkspaceSnapshot, WorkspaceValidationIssue } from "@veladesk/domain";

/** Validate a snapshot against the domain rules (delegated, never copied). */
export function validateLocalSnapshot(
  snapshot: WorkspaceSnapshot
): readonly WorkspaceValidationIssue[] {
  return validateWorkspace(snapshot);
}

/**
 * Read the clock once for a logical write.
 *
 * Every timestamp-producing write calls this at most once; the returned
 * value is reused for all timestamp fields of that write.
 */
export function readClock(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`now() must return a non-negative safe integer, received: ${value}`);
  }
  return value;
}

/** Server revisions must be positive safe integers. */
export function assertServerRevision(revision: number, name = "serverRevision"): void {
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new RangeError(`${name} must be a positive safe integer, received: ${revision}`);
  }
}

/** Generations exchanged with the sync layer must be positive safe integers. */
export function assertLocalGeneration(generation: number, name = "localGeneration"): void {
  if (!Number.isSafeInteger(generation) || generation <= 0) {
    throw new RangeError(`${name} must be a positive safe integer, received: ${generation}`);
  }
}

/** Workspace ids crossing the sync boundary must be non-blank. */
export function assertNonBlankWorkspaceId(workspaceId: WorkspaceId): void {
  if (workspaceId.trim().length === 0) {
    throw new RangeError(`workspaceId must be non-empty after trimming, received: "${workspaceId}"`);
  }
}

/**
 * Advance a local generation, refusing to overflow.
 *
 * A working copy already at Number.MAX_SAFE_INTEGER can accept no further
 * local edit; the caller sees a RangeError instead of silent overflow.
 */
export function nextLocalGeneration(current: number): number {
  if (current >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError(
      `localGeneration reached Number.MAX_SAFE_INTEGER and cannot be incremented, refusing to overflow`
    );
  }
  return current + 1;
}
