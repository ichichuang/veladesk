import { MAX_ICON_SCALE, MIN_ICON_SCALE, resolveAppVisualStyle } from "@veladesk/domain";
import type { AppShortcut, EntityId } from "@veladesk/domain";

/**
 * Arrange-mode icon resize (task 016-C): uniform VISUAL scale of one app
 * icon, plus the optimistic handoff that keeps the last preview frame
 * continuous with the persisted result.
 *
 * This is deliberately NOT a layout resize. `iconScale` is a visual
 * multiplier only — position, span and the grid definition are never part
 * of this model, so a 200% icon still occupies its 1×1 logical slot. The
 * resize never enters the arrange movement history either: that history
 * records PageLayout movement and nothing else.
 *
 * Everything here is pure. The React layer owns the pointer session, the
 * DOM-level preview and the single commit.
 */

/** The four handle positions. All four scale uniformly around the anchor. */
export type ResizeCorner = "nw" | "ne" | "sw" | "se";

export const RESIZE_CORNERS: readonly ResizeCorner[] = ["nw", "ne", "sw", "se"];

/**
 * The smallest pointer distance that can serve as a scale reference. A
 * session starting closer than this to the anchor is refused outright —
 * dividing by a near-zero distance would explode the scale.
 */
export const MIN_RESIZE_POINTER_DISTANCE = 4;

/** Scale changes below this are not worth a workspace write. */
export const RESIZE_NOOP_EPSILON = 0.005;

/** One in-flight resize gesture, in page coordinates. */
export interface ResizeSession {
  readonly corner: ResizeCorner;
  readonly startScale: number;
  /** The anchor the icon scales around (its visual center). */
  readonly centerX: number;
  readonly centerY: number;
  /** Pointer distance from the anchor when the session started. */
  readonly startPointerDistance: number;
}

/** Clamps a scale into the semantic range, never yielding NaN/Infinity. */
export function clampIconScale(value: number): number {
  if (!Number.isFinite(value)) {
    // NaN degrades to "no change"; an infinity is already out of range.
    return Number.isNaN(value) ? MIN_ICON_SCALE : value > 0 ? MAX_ICON_SCALE : MIN_ICON_SCALE;
  }
  return Math.min(MAX_ICON_SCALE, Math.max(MIN_ICON_SCALE, value));
}

function distance(x: number, y: number, centerX: number, centerY: number): number {
  return Math.hypot(x - centerX, y - centerY);
}

/**
 * Opens a resize session, or returns undefined when the pointer is too
 * close to the anchor (or non-finite) to define a scale.
 */
export function beginResizeSession(input: {
  readonly corner: ResizeCorner;
  readonly startScale: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly pointerX: number;
  readonly pointerY: number;
}): ResizeSession | undefined {
  const startPointerDistance = distance(
    input.pointerX,
    input.pointerY,
    input.centerX,
    input.centerY
  );
  if (
    !Number.isFinite(startPointerDistance) ||
    startPointerDistance < MIN_RESIZE_POINTER_DISTANCE
  ) {
    return undefined;
  }
  return {
    corner: input.corner,
    startScale: clampIconScale(input.startScale),
    centerX: input.centerX,
    centerY: input.centerY,
    startPointerDistance,
  };
}

/**
 * The scale for the current pointer position.
 *
 * Uniform by construction: only the DISTANCE from the anchor matters, never
 * the pointer's angle, so all four corners share this one path — a corner
 * can grow and shrink, and the icon can never be dragged into a rectangle.
 */
export function resizeScaleAt(
  session: ResizeSession,
  pointerX: number,
  pointerY: number
): number {
  const currentDistance = distance(pointerX, pointerY, session.centerX, session.centerY);
  if (!Number.isFinite(currentDistance)) {
    return clampIconScale(session.startScale);
  }
  return clampIconScale((session.startScale * currentDistance) / session.startPointerDistance);
}

/** Whether a finished (or escaped) gesture moved the scale meaningfully. */
export function isResizeNoop(startScale: number, endScale: number): boolean {
  return Math.abs(endScale - startScale) < RESIZE_NOOP_EPSILON;
}

/**
 * Only apps resize. Folders and widgets have no visual icon scale, and a
 * multi-selection is deliberately excluded too: group resize is not a
 * product feature, while group drag stays available.
 */
export function isResizableEntity(entity: { readonly kind: string } | undefined): boolean {
  return entity !== undefined && entity.kind === "app";
}

/**
 * The app with only its visual icon scale replaced. The decoration style,
 * colors, icon and — above all — the logical layout of the workspace stay
 * exactly as they were.
 */
export function withIconScale(app: AppShortcut, scale: number): AppShortcut {
  const visual = resolveAppVisualStyle(app);
  return { ...app, visual: { ...visual, iconScale: clampIconScale(scale) } };
}

// --- Commit handoff -------------------------------------------------------
//
// The mirror of the drag drop handoff (layout-handoff.ts): the committed
// scale is displayed IMMEDIATELY, before the durable stage resolves, so the
// frame the pointer released on is the frame the user keeps seeing. The
// override is only dropped once the authoritative snapshot carries the same
// scale — there is no intermediate frame at the old size.

export interface PendingResizeHandoff {
  /** Generation guard: a stale completion must never clear a newer handoff. */
  readonly token: number;
  readonly appId: EntityId;
  readonly scale: number;
}

/** The scale to render for an app: the pending one, else the persisted one. */
export function resolveDisplayScale(
  handoff: PendingResizeHandoff | null,
  appId: EntityId,
  authoritativeScale: number
): number {
  if (handoff === null || handoff.appId !== appId) {
    return authoritativeScale;
  }
  return handoff.scale;
}

/** Whether the persisted scale is (numerically) the handoff's scale. */
export function isResizeHandoffCaughtUp(
  handoff: PendingResizeHandoff | null,
  authoritativeScale: number | undefined
): boolean {
  if (handoff === null || authoritativeScale === undefined) {
    return true;
  }
  return isResizeNoop(handoff.scale, authoritativeScale);
}

/**
 * The single reconcile rule after every workspace snapshot change. Returns
 * the handoff to keep, or null to drop the override:
 *
 * - no handoff → nothing to keep;
 * - the app vanished → the override can never render again;
 * - the persisted scale matches → dropping is invisible;
 * - the stage attempt settled (staged/noop/failed) without matching → yield
 *   to the authoritative value. This is the ONE real revert, and it only
 *   happens when the write genuinely failed;
 * - otherwise the stage is still in flight — keep the override.
 */
export function reconcileResizeHandoff(
  handoff: PendingResizeHandoff | null,
  authoritativeScale: number | undefined,
  hasSettled: boolean
): PendingResizeHandoff | null {
  if (handoff === null) {
    return null;
  }
  if (authoritativeScale === undefined) {
    return null;
  }
  if (isResizeNoop(handoff.scale, authoritativeScale)) {
    return null;
  }
  if (hasSettled) {
    return null;
  }
  return handoff;
}
