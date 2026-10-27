import { decodeWorkspaceSnapshot } from "@veladesk/domain";
import type { WorkspaceSnapshot } from "@veladesk/domain";

import { LIMITS } from "../limits";
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
 * Early Content-Length rejection: a declared length already over the
 * budget never needs to be read. Unparseable, missing or nonsensical
 * header values (the stream count is authoritative) never reject.
 */
export function contentLengthExceeds(headers: Headers, maxBytes: number): boolean {
  const declared = headers.get("content-length");
  if (declared === null) {
    return false;
  }
  const bytes = Number(declared);
  return Number.isFinite(bytes) && bytes > maxBytes;
}

/**
 * Reads a body stream into text, cancelling it as soon as the byte budget
 * is exceeded — the server never buffers an unbounded `request.json()`.
 * Read failures keep propagating (same contract as before the budget).
 */
async function readBoundedText(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<string | undefined> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value === undefined) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Non-fatal UTF-8 with U+FFFD substitution — exactly the semantics of
  // the request.json() this replaced: invalid bytes never fail the body
  // read, the mangled text either still parses or fails JSON parsing as
  // 400 invalid-json.
  return new TextDecoder().decode(bytes);
}

/**
 * Decodes the request body as JSON through the shared byte budget
 * (`VELADESK_MAX_JSON_BYTES`, 512 KiB by default).
 *
 * A body one byte over the budget is answered 413 `payload-too-large`
 * before its bytes are buffered or parsed; exactly-at-limit passes. Only
 * the body read is guarded: a `SyntaxError` becomes a 400 `invalid-json`
 * response, any other read failure keeps propagating so it surfaces
 * through normal server error handling instead of being masked.
 */
export async function parseJsonBody(
  request: Request,
  maxBytes: number = LIMITS.maxJsonBodyBytes,
): Promise<ParsedJsonBody> {
  if (contentLengthExceeds(request.headers, maxBytes)) {
    return { ok: false, response: errorResponse(413, "payload-too-large") };
  }
  let text = "";
  if (request.body !== null) {
    const bounded = await readBoundedText(request.body, maxBytes);
    if (bounded === undefined) {
      return { ok: false, response: errorResponse(413, "payload-too-large") };
    }
    text = bounded;
  }
  try {
    return { ok: true, value: JSON.parse(text) };
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
