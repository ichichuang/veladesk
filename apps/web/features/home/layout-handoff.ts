import { arePageLayoutsEqual } from "@veladesk/desktop-engine";
import type { PageLayout } from "@veladesk/desktop-engine";
import type { DesktopPageId } from "@veladesk/domain";

/**
 * Session-only optimistic display layout established the instant a valid
 * drop lands (before any IndexedDB promise resolves), so the CSS grid shows
 * the destination while the durable stage is still in flight.
 *
 * Pure presentation/interaction state: never written into a
 * WorkspaceSnapshot, IndexedDB, the server or localStorage. The numeric
 * `token` is a generation guard — a stale async commit completion must never
 * clear (or act on) a newer handoff.
 */
export interface PendingLayoutHandoff {
  readonly token: number;
  readonly pageId: DesktopPageId;
  readonly layout: PageLayout;
}

/**
 * The layout the desktop should render right now: the pending handoff wins
 * only while it targets the active page — every other case renders the
 * authoritative layout from the client runtime.
 */
export function resolveDisplayLayout(
  handoff: PendingLayoutHandoff | null,
  activePageId: DesktopPageId,
  authoritativeLayout: PageLayout
): PageLayout {
  if (handoff === null || handoff.pageId !== activePageId) {
    return authoritativeLayout;
  }
  return handoff.layout;
}

/**
 * Whether the authoritative layout has caught up with the handoff, so the
 * override can be dropped without a visible change (pending grid →
 * authoritative grid must be pixel-identical). No handoff, or a handoff
 * whose page no longer exists, is trivially caught up.
 */
export function isHandoffCaughtUp(
  handoff: PendingLayoutHandoff | null,
  authoritativeLayout: PageLayout | undefined
): boolean {
  if (handoff === null || authoritativeLayout === undefined) {
    return true;
  }
  return arePageLayoutsEqual(handoff.layout, authoritativeLayout);
}

/**
 * The single reconcile rule applied after every workspace snapshot change.
 * Returns the handoff to keep, or `null` to drop the override:
 *
 * - no handoff → nothing to keep;
 * - the page vanished → the override can never render again;
 * - the authoritative layout is semantically equal to the pending one →
 *   the runtime snapshot caught up, dropping is invisible;
 * - the handoff's stage attempt settled (staged/noop/failed) but the
 *   authoritative layout moved somewhere else → yield to the authoritative
 *   state instead of shadowing it forever;
 * - otherwise the stage is still in flight — keep the override.
 */
export function reconcileHandoff(
  handoff: PendingLayoutHandoff | null,
  page: { readonly layout: PageLayout } | undefined,
  hasSettled: boolean
): PendingLayoutHandoff | null {
  if (handoff === null) {
    return null;
  }
  if (page === undefined) {
    return null;
  }
  if (arePageLayoutsEqual(handoff.layout, page.layout)) {
    return null;
  }
  if (hasSettled) {
    return null;
  }
  return handoff;
}
