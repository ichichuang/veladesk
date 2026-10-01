import type { AppShortcut, EntityId, WorkspaceEntity, WorkspaceSnapshot } from "@veladesk/domain";

import {
  buildDraftApp,
  draftEquals,
  draftFromApp,
  isDraftSavable,
  type AppVisualDraft,
} from "./app-visual-draft";

/**
 * Appearance editing session (task 019-C) — the PURE state model behind
 * the live desktop inspector.
 *
 * While the inspector is open, the DESKTOP renders
 *
 *     persisted app  +  session draft  =  effective rendered app
 *
 * through the ONE canonical projection (`buildDraftApp`): the exact
 * AppShortcut on screen while editing is the exact AppShortcut Save
 * persists — there is no separate preview projection, ever. No workspace
 * mutation happens before Save; Cancel simply drops the session.
 *
 * The desktop's real adaptive renderer stays the presentation authority:
 * the session never carries sizes, only the same draft fields the
 * inspector edits.
 */

export interface AppAppearanceSession {
  /** The app being edited. */
  readonly appId: EntityId;
  /** The live draft — owned by the shell, edited through the inspector. */
  readonly draft: AppVisualDraft;
}

/** Opens a session for a persisted app: the draft starts pristine. */
export function openAppearanceSession(app: AppShortcut): AppAppearanceSession {
  return { appId: app.id, draft: draftFromApp(app) };
}

/**
 * The effective app to RENDER: the draft projection while the session
 * targets this app, otherwise the persisted app itself (same reference —
 * no copy, no mutation).
 */
export function effectiveApp(
  persisted: AppShortcut,
  session: AppAppearanceSession | null
): AppShortcut {
  if (session === null || session.appId !== persisted.id) {
    return persisted;
  }
  return buildDraftApp(persisted, session.draft);
}

/**
 * Renders one workspace entity through the session (task 019-C §20):
 * a matching app becomes its draft projection; every other entity —
 * different id, folders, widgets — is returned unchanged (same
 * reference). The caller owns the missing-app case (session for a gone
 * app simply stops matching anything).
 */
export function resolveRenderedEntity(
  entity: WorkspaceEntity,
  session: AppAppearanceSession | null
): WorkspaceEntity {
  if (entity.kind !== "app" || session === null) {
    return entity;
  }
  if (session.appId !== entity.id) {
    return entity;
  }
  return buildDraftApp(entity, session.draft);
}

/**
 * The snapshot the desktop renders this frame: the persisted snapshot
 * with exactly one app replaced by its session projection. Returns the
 * SAME reference when nothing projects (no session, or the app is gone),
 * so memoized consumers keep their identity.
 */
export function projectRenderedWorkspace(
  snapshot: WorkspaceSnapshot,
  session: AppAppearanceSession | null
): WorkspaceSnapshot {
  if (session === null || !snapshot.entities.some((entity) => entity.id === session.appId)) {
    return snapshot;
  }
  return {
    ...snapshot,
    entities: snapshot.entities.map((entity) => resolveRenderedEntity(entity, session)),
  };
}

/** Whether the session draft equals the persisted look (nothing to save). */
export function isSessionPristine(
  persisted: AppShortcut,
  session: AppAppearanceSession | null
): boolean {
  if (session === null || session.appId !== persisted.id) {
    return true;
  }
  return draftEquals(session.draft, draftFromApp(persisted));
}

/** Whether Save may run: dirty AND structurally valid. */
export function isSessionSavable(
  persisted: AppShortcut,
  session: AppAppearanceSession | null
): boolean {
  if (session === null || session.appId !== persisted.id) {
    return false;
  }
  return !isSessionPristine(persisted, session) && isDraftSavable(session.draft);
}

/**
 * Structural, JSON-like equality of two apps (insertion-order-insensitive,
 * explicit-undefined ≡ absent) — the save-handoff gate: once the
 * PERSISTED app equals the projection, clearing the session cannot change
 * what the desktop paints (zero bounce).
 */
export function areProjectedAppsEqual(a: AppShortcut, b: AppShortcut): boolean {
  return jsonLikeEqual(a, b);
}

/**
 * Whether the zero-bounce save handoff has settled: the authoritative
 * snapshot now carries the projected app, so the session may be dropped
 * with no visual change. False while the persisted app still differs
 * (and for a session whose app disappeared — the handoff can only end
 * by cancel there).
 */
export function appearanceHandoffSettled(
  snapshot: WorkspaceSnapshot,
  session: AppAppearanceSession | null
): boolean {
  if (session === null) {
    return true;
  }
  const persisted = snapshot.entities.find(
    (entity): entity is AppShortcut => entity.kind === "app" && entity.id === session.appId
  );
  if (persisted === undefined) {
    return false;
  }
  return areProjectedAppsEqual(persisted, buildDraftApp(persisted, session.draft));
}

// --- JSON-like deep equality (same semantics as the sync package's
// snapshot equality, scoped to entity-shaped data) -------------------------

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function semanticKeys(record: Record<string, unknown>): readonly string[] {
  return Object.keys(record).filter((key) => record[key] !== undefined);
}
