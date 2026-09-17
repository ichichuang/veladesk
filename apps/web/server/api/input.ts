import type { WorkspaceSnapshot } from "@veladesk/domain";

import { errorResponse } from "./response";

/**
 * HTTP boundary structural decoding.
 *
 * These guards verify that an untrusted JSON value HAS the
 * `WorkspaceSnapshot` structure before it is handed to the domain.
 * Semantic rules (blank names, bounds, overlaps, references) stay in
 * `validateWorkspace` + `@veladesk/desktop-engine` — nothing is duplicated
 * here. Unknown extra properties are ignored.
 */

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

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

/** A non-null, non-array object whose values are recursively JSON. */
function isJsonObject(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

const APP_OPEN_MODES: readonly string[] = ["new-tab", "same-tab", "new-window", "popup"];

function isAppIcon(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  switch (value.kind) {
    case "favicon":
      return true;
    case "iconify":
      return typeof value.icon === "string";
    case "asset":
      return typeof value.assetId === "string";
    case "generated":
      return typeof value.text === "string";
    default:
      return false;
  }
}

function isWorkspaceEntity(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== "string") {
    return false;
  }
  switch (value.kind) {
    case "app":
      return (
        typeof value.name === "string" &&
        typeof value.url === "string" &&
        isOptionalString(value.description) &&
        isAppIcon(value.icon) &&
        APP_OPEN_MODES.includes(value.openMode as string) &&
        isOptionalString(value.categoryId) &&
        isStringArray(value.tags)
      );
    case "folder":
      return typeof value.name === "string" && isStringArray(value.children);
    case "widget":
      return (
        typeof value.widgetType === "string" &&
        isOptionalString(value.title) &&
        isJsonObject(value.config)
      );
    default:
      return false;
  }
}

function isLayoutItem(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== "string") {
    return false;
  }
  const { position, span } = value;
  return (
    isRecord(position) &&
    typeof position.column === "number" &&
    typeof position.row === "number" &&
    isRecord(span) &&
    typeof span.columns === "number" &&
    typeof span.rows === "number"
  );
}

function isPageLayout(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== "string") {
    return false;
  }
  return (
    isRecord(value.grid) &&
    typeof value.grid.columns === "number" &&
    typeof value.grid.rows === "number" &&
    Array.isArray(value.items) &&
    value.items.every(isLayoutItem)
  );
}

function isDesktopPage(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isPageLayout(value.layout)
  );
}

function isCategory(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string";
}

function isDock(value: unknown): boolean {
  return isRecord(value) && isStringArray(value.items);
}

function isPreferences(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.defaultPageId === "string" &&
    typeof value.layoutLocked === "boolean"
  );
}

/**
 * Structural type guard for a whole `WorkspaceSnapshot`.
 * Returns `undefined` when the value does not have the required shape.
 */
export function decodeWorkspaceSnapshot(value: unknown): WorkspaceSnapshot | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !Array.isArray(value.pages) ||
    !value.pages.every(isDesktopPage) ||
    !Array.isArray(value.entities) ||
    !value.entities.every(isWorkspaceEntity) ||
    !Array.isArray(value.categories) ||
    !value.categories.every(isCategory) ||
    !isDock(value.dock) ||
    !isPreferences(value.preferences)
  ) {
    return undefined;
  }
  return value as unknown as WorkspaceSnapshot;
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
