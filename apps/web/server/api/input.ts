import { decodeWorkspaceSnapshot } from "@veladesk/domain";
import type { WorkspaceSnapshot } from "@veladesk/domain";

import { errorResponse } from "./response";

/**
 * HTTP boundary structural decoding.
 *
 * The `WorkspaceSnapshot` structure itself is decoded by the shared domain
 * decoder (`decodeWorkspaceSnapshot` from `@veladesk/domain`, re-exported
 * below); only the request-body envelope shapes stay here. Semantic rules
 * (blank names, bounds, overlaps, references) stay in `validateWorkspace` +
 * `@veladesk/desktop-engine`. Unknown extra properties are ignored.
 */

export { decodeWorkspaceSnapshot } from "@veladesk/domain";

export type ParsedJsonBody =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: Response };

/**
 * Decodes the request body as JSON.
 *
 * Only the body read is guarded: a `SyntaxError` becomes a 400
 * `invalid-json` response, any other read failure keeps propagating so it
 * surfaces through normal server error handling instead of being masked.
 */
export async function parseJsonBody(request: Request): Promise<ParsedJsonBody> {
  try {
    return { ok: true, value: await request.json() };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false, response: errorResponse(400, "invalid-json") };
    }
    throw error;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Decodes a POST body: `{ snapshot: WorkspaceSnapshot }`. */
export function decodeCreateWorkspaceBody(value: unknown): WorkspaceSnapshot | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return decodeWorkspaceSnapshot(value.snapshot);
}

export interface SaveWorkspaceBody {
  readonly snapshot: WorkspaceSnapshot;
  /** Kept raw here; validated with {@link decodeExpectedRevision}. */
  readonly expectedRevision: unknown;
}

/** Decodes a PUT body shape: `{ snapshot, expectedRevision? }`. */
export function decodeSaveWorkspaceBody(value: unknown): SaveWorkspaceBody | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const snapshot = decodeWorkspaceSnapshot(value.snapshot);
  if (snapshot === undefined) {
    return undefined;
  }
  return { snapshot, expectedRevision: value.expectedRevision };
}

/** A revision number on the HTTP boundary: a positive safe integer. */
export function decodeExpectedRevision(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

const REVISION_SEGMENT_PATTERN = /^[1-9]\d*$/;

/**
 * Decodes a revision path segment: only canonical positive decimal
 * integers (`1`, `2`, `100`) are valid — not `01`, not `0`, not `1.5`.
 */
export function decodeRevisionSegment(segment: string): number | undefined {
  if (!REVISION_SEGMENT_PATTERN.test(segment)) {
    return undefined;
  }
  const revision = Number(segment);
  return Number.isSafeInteger(revision) ? revision : undefined;
}
