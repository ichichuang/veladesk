import type { WorkspaceSnapshot } from "@veladesk/domain";

import { isRecord } from "./internal";

/**
 * Structural deep equality of two workspace snapshots.
 *
 * Arrays are order-sensitive (page order, dock order, tag order and layout
 * items are business semantics); object property insertion order is NOT —
 * a widget config `{ a: 1, b: 2 }` equals `{ b: 2, a: 1 }`. Values are
 * compared as JSON-like data (an explicit `undefined` property counts as
 * absent, mirroring what a JSON round-trip preserves).
 *
 * Package-internal on purpose: no deep-equal dependency, no
 * `JSON.stringify` key-order trap.
 */
export function areWorkspaceSnapshotsEqual(
  a: WorkspaceSnapshot,
  b: WorkspaceSnapshot
): boolean {
  return jsonLikeEqual(a, b);
}

function jsonLikeEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => jsonLikeEqual(item, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const aKeys = semanticKeys(a);
    const bKeys = semanticKeys(b);
    if (aKeys.length !== bKeys.length) {
      return false;
    }
    const bKeySet = new Set(bKeys);
    return aKeys.every((key) => bKeySet.has(key) && jsonLikeEqual(a[key], b[key]));
  }
  return false;
}

/** Property names with a defined value (JSON never carries `undefined`). */
function semanticKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record).filter((key) => record[key] !== undefined);
}
