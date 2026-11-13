"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DesktopPageId } from "@veladesk/domain";

import {
  emptyWorkspaceViewState,
  loadWorkspaceViewState,
  resolveInitialActiveSection,
  type WorkspaceViewStateV1,
} from "./workspace-view-state";
import {
  createWorkspaceViewStateController,
  type WorkspaceViewStateController,
} from "./workspace-view-state-controller";

/**
 * The SHARED active-section owner (task 026 §17): the minimal controller
 * lifted out of DesktopShell so the desktop and mobile presentations point
 * at ONE active section and ONE persisted view-state stream — never
 * `mobileActiveSectionId` versus `desktopActiveSectionId`.
 *
 * Ownership:
 *  - `activePageId` — the explicit session state (raw request history).
 *  - `effectiveActivePageId` — derived fallback (default section, then
 *    first) when the explicit id vanished from the workspace.
 *  - `requestActiveSection` — the one navigation entry point: flips state
 *    AND records the logical destination into the 023-A view-state
 *    controller (coalesced disk write, immediate memory).
 *  - `recordScrollTop` — section scroll persistence through the same
 *    controller.
 *
 * Lifecycle: one view-state controller per mounted owner per workspace —
 * created in an effect (StrictMode-safe), flushed synchronously on
 * `pagehide` and unmount, with `captureActiveScroll` (the caller's
 * DOM-specific scroll capture, e.g. the desktop's scroller query) invoked
 * at every flush boundary BEFORE the write. Because the hook lives ABOVE
 * the shell switch (in ResponsiveWorkspaceShell), a desktop↔mobile swap
 * never re-reads localStorage mid-session: the in-memory state simply
 * carries across (§73 — continuity without a default-section flash).
 *
 * `external` lets DesktopShell keep its exact 023-A behavior when rendered
 * standalone (tests render it directly): when an externally-owned value is
 * supplied, this hook returns it verbatim and creates nothing. The
 * internal machinery still runs its (disabled) hooks so hook order stays
 * constant.
 */
export interface WorkspaceActiveSection {
  /** The explicit active section id; null only before boot resolution. */
  readonly activePageId: DesktopPageId | null;
  /** The effective active section after structural fallback. */
  readonly effectiveActivePageId: DesktopPageId | null;
  /** Records the logical navigation destination (state + view state). */
  readonly requestActiveSection: (pageId: DesktopPageId) => void;
  /** Records one section's scrollTop into the persisted view state. */
  readonly recordScrollTop: (pageId: DesktopPageId, scrollTop: number) => void;
  /**
   * t176: late-binds the DOM-specific scroll capture (the shell's scene
   * querying the live scroller) to this controller's flush boundaries
   * (pagehide / visibilitychange-hidden / unmount). The owner lives ABOVE
   * the shells (ResponsiveWorkspaceShell) where no DOM exists to pass as a
   * hook input, so the shell that owns the scrollers registers its capture
   * from an effect instead — without this, a reload mid-section persisted
   * only the sections the user had LEFT, never the one being read.
   */
  readonly registerScrollCapture: (capture: (() => void) | null) => void;
}

export interface UseWorkspaceActiveSectionInput {
  /**
   * An externally-owned instance (from ResponsiveWorkspaceShell). When
   * present this hook is a pass-through and owns nothing.
   */
  readonly external?: WorkspaceActiveSection | undefined;
  readonly workspaceId: string;
  /** Section ids in workspace order (existence + order for fallbacks). */
  readonly pageIds: readonly DesktopPageId[];
  /** The configured default section id (may be stale/absent). */
  readonly defaultSectionId: DesktopPageId | null;
  /**
   * DOM-specific scroll capture run at every flush boundary (pagehide,
   * unmount) BEFORE the synchronous write — the desktop queries its
   * section scrollers here. Kept current through a latest-value mirror.
   */
  readonly captureActiveScroll?: (() => void) | null;
}

interface BootResolution {
  readonly persisted: WorkspaceViewStateV1 | null;
  readonly initialActivePageId: DesktopPageId | null;
}

/**
 * The boot composition (task 023-A §5), as a pure read: the persisted view
 * state + the resolved initial section through the canonical precedence
 * (explicit target → persisted → default → first). Called from the state
 * initializer (render-phase localStorage read — hydration-safe because the
 * ready workspace UI only mounts client-side) and again inside the
 * controller lifecycle effect (same inputs, same result — the value is
 * stable within a mount; the second read is a trivial cost).
 */
function readBootResolution(input: {
  readonly workspaceId: string;
  readonly pageIds: readonly DesktopPageId[];
  readonly defaultSectionId: DesktopPageId | null;
}): BootResolution {
  const persisted = loadWorkspaceViewState(window.localStorage, input.workspaceId);
  return {
    persisted,
    initialActivePageId: resolveInitialActiveSection({
      pageIds: input.pageIds,
      defaultSectionId: input.defaultSectionId,
      persistedViewState: persisted,
      explicitTargetSectionId: null,
    }),
  };
}

export function useWorkspaceActiveSection(
  input: UseWorkspaceActiveSectionInput,
): WorkspaceActiveSection {
  const { external, workspaceId, pageIds, defaultSectionId, captureActiveScroll } = input;
  const owned = external === undefined;

  const [activePageId, setActivePageId] = useState<DesktopPageId | null>(() =>
    owned
      ? readBootResolution({ workspaceId, pageIds, defaultSectionId }).initialActivePageId
      : null,
  );

  /**
   * The effective active section: the explicit state while it exists,
   * otherwise default, otherwise first — derived so structural changes
   * (a deleted section) reconcile within one render.
   */
  const effectiveActivePageId = useMemo(() => {
    if (!owned) {
      return external.effectiveActivePageId;
    }
    if (activePageId !== null && pageIds.includes(activePageId)) {
      return activePageId;
    }
    if (defaultSectionId !== null && pageIds.includes(defaultSectionId)) {
      return defaultSectionId;
    }
    return pageIds[0] ?? null;
  }, [owned, external, activePageId, pageIds, defaultSectionId]);

  // --- View-state controller lifecycle (one per workspace, owner only) ----
  const controllerRef = useRef<WorkspaceViewStateController | null>(null);
  // The input prop is the INITIAL capture only (the standalone shell's
  // stable wrapper). It must never re-sync per render: the production owner
  // (ResponsiveWorkspaceShell) passes NO prop, so a per-render sync would
  // wipe the shell-registered capture back to undefined before every flush
  // — exactly the t176 hole (reload persisted only left sections).
  const captureRef = useRef<(() => void) | null | undefined>(captureActiveScroll);
  /**
   * t176: the effect-registered DOM capture (see
   * {@link WorkspaceActiveSection.registerScrollCapture}). Stable, and
   * deliberately NOT a no-op when externally-owned — registration is the
   * ONLY way the production desktop shell (rendered below an external
   * owner) feeds its scrollers into this controller's flushes.
   */
  const registerScrollCapture = useCallback((capture: (() => void) | null) => {
    captureRef.current = capture;
  }, []);
  useEffect(() => {
    if (!owned) {
      return;
    }
    const boot = readBootResolution({ workspaceId, pageIds, defaultSectionId });
    const controller = createWorkspaceViewStateController({
      workspaceId,
      storage: window.localStorage,
      initial: {
        ...(boot.persisted ?? emptyWorkspaceViewState()),
        activeSectionId: boot.initialActivePageId,
      },
    });
    controllerRef.current = controller;
    const captureAndFlush = () => {
      captureRef.current?.();
      controller.flushNow();
    };
    const onPageHide = captureAndFlush;
    // t176: a tab moved to the background (or the mobile browser hiding the
    // page) flushes immediately too — a later forced kill never reaches
    // pagehide, and the capture is idempotent at the next boundary anyway.
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        captureAndFlush();
      }
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      captureRef.current?.();
      controller.flushNow();
      controller.dispose();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per-workspace lifecycle only; the boot helper is mount-scoped
  }, [workspaceId, owned]);

  const requestActiveSection = useCallback(
    (pageId: DesktopPageId) => {
      if (!owned) {
        return;
      }
      setActivePageId(pageId);
      controllerRef.current?.setActiveSection(pageId);
    },
    [owned],
  );

  const recordScrollTop = useCallback(
    (pageId: DesktopPageId, scrollTop: number) => {
      if (!owned) {
        return;
      }
      controllerRef.current?.setScrollTop(pageId, scrollTop);
    },
    [owned],
  );

  return useMemo(
    () =>
      owned
        ? { activePageId, effectiveActivePageId, requestActiveSection, recordScrollTop, registerScrollCapture }
        : external,
    [owned, external, activePageId, effectiveActivePageId, requestActiveSection, recordScrollTop, registerScrollCapture],
  );
}
