import type { DesktopPageId } from "@veladesk/domain";

/**
 * Workspace VIEW STATE (task 023-A): the local UI continuity state of one
 * workspace — the section the user last used and each section's vertical
 * scroll position. This is NOT workspace content: it never enters the
 * WorkspaceSnapshot, never bumps a workspace revision, never reaches the
 * outbox or the server, and switching sections stays zero-revision.
 *
 * Persistence follows the locale module's browser-local pattern: a
 * versioned localStorage key, strict parsing of anything read back, and a
 * `Storage` that is always injected so failures (privacy mode, quota,
 * unavailable) degrade to "no continuity this session", never to a broken
 * desktop. The payload is deliberately tiny and workspace-scoped: entity
 * ids and numbers only — never names, URLs, icons or user content.
 */

/** The schema version this build reads and writes. */
export const WORKSPACE_VIEW_STATE_VERSION = 1;

/**
 * Storage key namespace. Versioned UP FRONT (`v1` in the prefix): a future
 * schema change writes a different namespace instead of migrating in place,
 * exactly like the ui-locale v2 key. Keys are workspace-ID scoped — never
 * name or array-position scoped — so renaming/reordering sections and
 * sharing a browser across workspaces cannot leak state between them.
 */
export function workspaceViewStateStorageKey(workspaceId: string): string {
  return `veladesk:view-state:v1:${workspaceId}`;
}

/** The versioned payload (schema v1). */
export interface WorkspaceViewStateV1 {
  readonly version: 1;
  /** The section the user last used; null until a navigation was made. */
  readonly activeSectionId: string | null;
  /** Per-section remembered scrollTop (px, >= 0, finite). */
  readonly scrollTopBySectionId: Readonly<Record<string, number>>;
  /** When this state was last written (ms epoch). */
  readonly updatedAt: number;
}

/** The empty in-memory state used when nothing valid was persisted. */
export function emptyWorkspaceViewState(): WorkspaceViewStateV1 {
  return {
    version: WORKSPACE_VIEW_STATE_VERSION,
    activeSectionId: null,
    scrollTopBySectionId: {},
    updatedAt: 0,
  };
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Sanitizes scroll entries: keeps only finite, non-negative numbers. A
 * corrupt individual entry never poisons the record — it is dropped.
 */
function sanitizeScrollTops(
  value: unknown,
): Readonly<Record<string, number>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const tops: Record<string, number> = {};
  for (const [sectionId, scrollTop] of Object.entries(value)) {
    if (isFiniteNonNegativeNumber(scrollTop)) {
      tops[sectionId] = scrollTop;
    }
  }
  return tops;
}

/**
 * Parses a raw stored payload. Anything malformed — bad JSON, wrong
 * version, wrong shapes — is rejected wholesale; recoverable field damage
 * (a mistyped activeSectionId, an invalid scroll entry, a bad updatedAt)
 * is sanitized instead. Never throws: boot must not fail on persistence.
 */
export function parseWorkspaceViewState(
  raw: string | null | undefined,
): WorkspaceViewStateV1 | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as { version?: unknown }).version !== WORKSPACE_VIEW_STATE_VERSION
  ) {
    return null;
  }
  const record = parsed as {
    activeSectionId?: unknown;
    scrollTopBySectionId?: unknown;
    updatedAt?: unknown;
  };
  return {
    version: WORKSPACE_VIEW_STATE_VERSION,
    activeSectionId:
      typeof record.activeSectionId === "string" ? record.activeSectionId : null,
    scrollTopBySectionId: sanitizeScrollTops(record.scrollTopBySectionId),
    updatedAt: isFiniteNonNegativeNumber(record.updatedAt) ? record.updatedAt : 0,
  };
}

/** Serializes state back through the same sanitizer — disk only ever holds valid shapes. */
export function serializeWorkspaceViewState(state: WorkspaceViewStateV1): string {
  return JSON.stringify({
    version: WORKSPACE_VIEW_STATE_VERSION,
    activeSectionId: state.activeSectionId,
    scrollTopBySectionId: sanitizeScrollTops(state.scrollTopBySectionId),
    updatedAt: state.updatedAt,
  });
}

/**
 * Reads one workspace's persisted view state. Storage failures of any kind
 * mean "no continuity this session" (null) — never an exception.
 */
export function loadWorkspaceViewState(
  storage: Storage | null | undefined,
  workspaceId: string,
): WorkspaceViewStateV1 | null {
  try {
    return parseWorkspaceViewState(
      storage?.getItem(workspaceViewStateStorageKey(workspaceId)),
    );
  } catch {
    return null;
  }
}

/** Persists one workspace's view state; returns false when the write failed. */
export function saveWorkspaceViewState(
  storage: Storage | null | undefined,
  workspaceId: string,
  state: WorkspaceViewStateV1,
): boolean {
  try {
    storage?.setItem(
      workspaceViewStateStorageKey(workspaceId),
      serializeWorkspaceViewState(state),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort key removal (workspace deletion cleanup). There is no
 * workspace-deletion flow in the product today, so this exists for the
 * future boundary; a stale key is harmless because keys are
 * workspace-scoped and payloads tiny.
 */
export function deleteWorkspaceViewState(
  storage: Storage | null | undefined,
  workspaceId: string,
): void {
  try {
    storage?.removeItem(workspaceViewStateStorageKey(workspaceId));
  } catch {
    // Unavailable storage costs cleanup, never stability.
  }
}

/**
 * The ONE resolver for the initially active section (task 023-A §5).
 * Precedence:
 *
 *  1. an explicit navigation/deep-link target, when the product supplies
 *     one (it does not today — the seam exists so it never gets invented
 *     twice);
 *  2. the persisted last-used section, when it still exists;
 *  3. the configured workspace default section, when it exists;
 *  4. the first section;
 *  5. null only when the workspace genuinely has no sections.
 *
 * Persistence therefore never overrides an explicit user command, and a
 * deleted persisted section falls through to the normal defaults without
 * rendering nothing, recreating anything, or keeping a stale highlight.
 * Pure: no storage, no DOM, no clocks.
 */
export function resolveInitialActiveSection(input: {
  /** Section ids in workspace order (existence + order). */
  readonly pageIds: readonly DesktopPageId[];
  /** The configured default section id (may be stale/absent). */
  readonly defaultSectionId: DesktopPageId | null;
  /** The workspace's persisted view state, when valid state existed. */
  readonly persistedViewState: WorkspaceViewStateV1 | null;
  /** An explicit navigation target, when one is being applied. */
  readonly explicitTargetSectionId: DesktopPageId | null;
}): DesktopPageId | null {
  const { pageIds, persistedViewState, explicitTargetSectionId } = input;
  const exists = (id: string | null): id is string =>
    id !== null && pageIds.includes(id);
  if (exists(explicitTargetSectionId)) {
    return explicitTargetSectionId;
  }
  const persisted = persistedViewState?.activeSectionId ?? null;
  if (exists(persisted)) {
    return persisted;
  }
  const fallback = input.defaultSectionId;
  if (exists(fallback)) {
    return fallback;
  }
  return pageIds[0] ?? null;
}
