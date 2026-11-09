"use client";

import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  areCanvasLayoutsEqual,
  canvasCellSize,
  canConvertGridToFreeform,
  replaceCanvasItem,
  replaceGridItem,
  translateCanvasItems,
  translateGridItems,
} from "@veladesk/canvas-engine";
import type { CanvasRect, PagePlacementMode } from "@veladesk/canvas-engine";
import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";
import { findDesktopPage, replacePageCanvas, resolvePagePlacement } from "@veladesk/domain";
import type {
  DesktopPage,
  DesktopPageId,
  EntityId,
  PagePlacement,
  WorkspaceSnapshot,
} from "@veladesk/domain";
import type { LayoutItemId } from "@veladesk/desktop-engine";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";

import {
  commitPageCanvas,
  reconcilePageCanvasHistory,
  redoPageCanvas,
  resetPageCanvasHistory,
  undoPageCanvas,
} from "../../canvas/arrange-history";
import type { ArrangeCanvasHistories } from "../../canvas/arrange-history";
import { reconcileCanvasHandoff, resolveDisplayPlacement } from "../../canvas/canvas-handoff";
import type { PendingCanvasHandoff } from "../../canvas/canvas-handoff";
import { freeformRaisedPlacement } from "../../canvas/canvas-drag";
import type { ResizeCommitGeometry } from "../../canvas/canvas-resize";
import { resolvePlacementSwitch } from "./placement-switch-commit";
import { stageWorkspaceAndTrySync } from "../workspace-commit";
import type { TranslateFn } from "../../i18n/use-i18n";

/**
 * How one serialized layout-commit attempt ended. Internal to the tile
 * host — the drop handoff must know whether the durable local stage
 * landed, was a no-op, or failed, but this is never part of a package API.
 */
type LayoutCommitOutcome =
  | { readonly status: "staged" }
  | { readonly status: "noop" }
  | { readonly status: "failed" };

export interface UseCanvasCommitsInput {
  readonly runtime: WorkspaceClientRuntime;
  /** The render's authoritative snapshot (handoff reconcile dep). */
  readonly snapshot: WorkspaceSnapshot;
  /** Latest-value mirror of the workspace record. */
  readonly workspaceRef: RefObject<LocalWorkspaceRecord>;
  /** Latest-value mirror of the effective active page id. */
  readonly pageIdRef: RefObject<DesktopPageId | null>;
  /** The active section's page (undefined only in the no-pages fallback). */
  readonly activePage: DesktopPage | undefined;
  /** Latest-value mirror of the arrange selection (tile-session owned). */
  readonly selectionRef: RefObject<ReadonlySet<LayoutItemId>>;
  /** The i18n translate function (placement-mode refusal strings). */
  readonly t: TranslateFn;
}

/**
 * The tile host's canvas COMMAND layer (P1-ENG-1): the serialized
 * local-first commit queue, the optimistic display-canvas handoff, the
 * per-page arrange history and the geometry transforms built on them
 * (drag drop, resize, nudge, placement-mode switch). Extracted verbatim
 * from the former desktop-shell.tsx; every function stages through the
 * one domain/runtime path and nothing here touches the DOM.
 */
export function useCanvasCommits(input: UseCanvasCommitsInput) {
  const { runtime, snapshot, workspaceRef, pageIdRef, activePage, selectionRef, t } = input;

  const [arrangeHistories, setArrangeHistories] = useState<ArrangeCanvasHistories>({});
  const arrangeHistoriesRef = useRef(arrangeHistories);
  const layoutQueueRef = useRef<Promise<void>>(Promise.resolve());
  /** Generation counter for canvas handoffs — stale completions never win. */
  const handoffTokenRef = useRef(0);
  /**
   * Session-only optimistic display canvas for a just-committed geometry
   * edit (drag drop, resize, mode switch). It is established synchronously
   * at release time — before any IndexedDB promise is awaited — so the
   * section shows the geometry the user produced the moment the pointer
   * lets go, and the authoritative snapshot catches up invisibly a few
   * frames later. Presentation state only: it never touches the
   * WorkspaceSnapshot, IndexedDB, the server or localStorage, and dies with
   * the session (a reload boots purely from the authoritative snapshot).
   */
  const [pendingCanvasHandoff, setPendingCanvasHandoff] = useState<PendingCanvasHandoff | null>(null);
  /** Imperative mirror of `pendingCanvasHandoff` for event handlers. */
  const pendingHandoffRef = useRef<PendingCanvasHandoff | null>(null);
  /** Handoffs whose stage attempt has settled (staged/noop/failed). */
  const settledHandoffTokensRef = useRef<ReadonlySet<number>>(new Set());
  /**
   * The app whose resize session is live right now. A live session locks
   * every competing gesture (drag, marquee, nudge, undo/redo, mode and
   * section switches) for as long as it lasts.
   */
  const [resizeSessionAppId, setResizeSessionAppId] = useState<EntityId | null>(null);
  /**
   * Imperative mirror of the resize lock. Gesture handlers are created once
   * and read this ref, so a session started mid-render still blocks them.
   */
  const resizeLockRef = useRef(false);

  /** True only while a display canvas outruns the durable snapshot. */
  const handoffLock = pendingCanvasHandoff !== null;
  /**
   * True while a rect resize owns the desktop. The lock is deliberately
   * short — it ends the moment the gesture finishes, never waiting for a
   * server sync.
   */
  const resizeLock = resizeSessionAppId !== null;
  /** The app whose resize is live. */
  const resizeActiveId = resizeSessionAppId;

  useEffect(() => {
    arrangeHistoriesRef.current = arrangeHistories;
  }, [arrangeHistories]);
  useEffect(() => {
    resizeLockRef.current = resizeLock;
  }, [resizeLock]);

  /** Establishes/clears the optimistic display canvas, mirror ref included. */
  function stagePendingHandoff(next: PendingCanvasHandoff | null) {
    pendingHandoffRef.current = next;
    setPendingCanvasHandoff(next);
  }

  /**
   * Handoff reconcile after every workspace snapshot change: once the
   * authoritative placement for the handoff's page is semantically equal to
   * the pending one, the override is dropped (pixel-identical hand-off). A
   * handoff whose stage attempt settled but whose page moved somewhere else
   * yields to the authoritative state, and a page that vanished drops the
   * override outright. Settled tokens are pruned as their handoffs resolve.
   */
  useEffect(() => {
    const current = pendingCanvasHandoff;
    if (current === null) {
      return;
    }
    const page = findDesktopPage(snapshot, current.pageId);
    const next = reconcileCanvasHandoff(
      current,
      page === undefined ? undefined : resolvePagePlacement(page),
      settledHandoffTokensRef.current.has(current.token)
    );
    if (next !== current) {
      const remaining = new Set(settledHandoffTokensRef.current);
      remaining.delete(current.token);
      settledHandoffTokensRef.current = remaining;
      stagePendingHandoff(next);
    }
  }, [snapshot, pendingCanvasHandoff]);

  /**
   * Serialized local-first canvas commits: stage the new snapshot, and only
   * accept the history step after a successful stage — a stage failure rolls
   * the step back by never accepting it into state. `onSettled` reports the
   * outcome exactly once (staged / noop / failed) so a handoff can
   * reconcile; `resetHistory` marks structural edits that are deliberately
   * NOT undoable (placement-mode switch).
   */

  /**
   * The tail every placement commit shares: stage the edited snapshot,
   * accept the history step only after a successful stage, report the
   * outcome exactly once (plain edits and placement switches alike).
   */
  const stagePlacementSnapshot = useCallback(
    async (
      pageId: DesktopPageId,
      snapshot: WorkspaceSnapshot,
      nextPlacement: PagePlacement,
      options: { readonly resetHistory?: boolean },
      settle: (outcome: LayoutCommitOutcome) => void
    ) => {
      const staged = await stageWorkspaceAndTrySync(runtime, snapshot);
      if (!staged.ok) {
        console.error(`VelaDesk: canvas change was not staged (${staged.reason})`);
        settle({ status: "failed" });
        return;
      }
      const nextMap: ArrangeCanvasHistories =
        options.resetHistory === true
          ? resetPageCanvasHistory(arrangeHistoriesRef.current, pageId, nextPlacement)
          : commitPageCanvas(arrangeHistoriesRef.current, pageId, nextPlacement);
      arrangeHistoriesRef.current = nextMap;
      setArrangeHistories(nextMap);
      settle({ status: "staged" });
    },
    [runtime]
  );
  const enqueueCanvasCommit = useCallback(
    (
      pageId: DesktopPageId,
      nextPlacement: PagePlacement,
      options: { readonly resetHistory?: boolean } = {},
      onSettled?: (outcome: LayoutCommitOutcome) => void
    ) => {
      let settled = false;
      const settle = (outcome: LayoutCommitOutcome) => {
        if (!settled) {
          settled = true;
          onSettled?.(outcome);
        }
      };
      const run = async () => {
        try {
          const current = workspaceRef.current;
          const page = findDesktopPage(current.snapshot, pageId);
          if (page === undefined) {
            settle({ status: "noop" });
            return;
          }
          if (areCanvasLayoutsEqual(resolvePagePlacement(page), nextPlacement)) {
            // Resolved back to the same geometry: no stage, no history
            // entry, no sync.
            settle({ status: "noop" });
            return;
          }
          const replaced = replacePageCanvas(current.snapshot, pageId, nextPlacement);
          if (!replaced.ok) {
            settle({ status: "noop" });
            return;
          }
          await stagePlacementSnapshot(pageId, replaced.workspace, nextPlacement, options, settle);
        } catch (error) {
          console.error("VelaDesk: canvas change could not be committed", error);
          settle({ status: "failed" });
        }
      };
      layoutQueueRef.current = layoutQueueRef.current.then(run, run);
    },
    [workspaceRef, stagePlacementSnapshot]
  );

  /**
   * Commits one canvas geometry edit with the optimistic handoff: the
   * display canvas shows the result before any IndexedDB promise is awaited,
   * so the release render paints into the new geometry and the authoritative
   * snapshot never becomes visible in between.
   */
  const commitCanvasEdit = useCallback(
    (
      pageId: DesktopPageId,
      nextPlacement: PagePlacement,
      options: { readonly resetHistory?: boolean } = {}
    ) => {
      const token = handoffTokenRef.current + 1;
      handoffTokenRef.current = token;
      stagePendingHandoff({ token, pageId, placement: nextPlacement });
      enqueueCanvasCommit(pageId, nextPlacement, options, (outcome) => {
        if (outcome.status === "failed") {
          // The only true revert: the stage refused, so the optimistic
          // display canvas falls back to the authoritative (pre-edit) one.
          if (pendingHandoffRef.current?.token === token) {
            settledHandoffTokensRef.current = new Set([
              ...settledHandoffTokensRef.current,
              token,
            ]);
            stagePendingHandoff(null);
          }
          return;
        }
        // staged/noop: not cleared here — the external-store snapshot may not
        // have caught up in the current render yet. The reconcile effect
        // drops the handoff once the authoritative canvas is equal, making
        // the pending → authoritative switch invisible.
        settledHandoffTokensRef.current = new Set([...settledHandoffTokensRef.current, token]);
      });
    },
    [enqueueCanvasCommit]
  );

  const commitDraggedCanvas = useCallback(
    (movedPlacement: PagePlacement, placementAtStart: PagePlacement) => {
      const current = workspaceRef.current;
      const pageId = pageIdRef.current;
      if (pageId === null) {
        return;
      }
      const page = findDesktopPage(current.snapshot, pageId);
      // The drag session already rejected stale canvases; this re-check pins
      // the commit to the exact workspace state the drag started from. It is
      // structural because a legacy page derives its placement per render.
      if (
        page === undefined ||
        !areCanvasLayoutsEqual(resolvePagePlacement(page), placementAtStart)
      ) {
        return;
      }
      if (areCanvasLayoutsEqual(movedPlacement, placementAtStart)) {
        return;
      }
      // Freeform z-order (P1): the moved tiles rise to the top of the
      // stacking order; snap mode never reorders.
      commitCanvasEdit(pageId, freeformRaisedPlacement(movedPlacement, placementAtStart));
    },
    [commitCanvasEdit, workspaceRef, pageIdRef]
  );

  /**
   * Commits one finished resize gesture: exactly one workspace edit, one
   * stage and one sync attempt, no matter how many pointermoves preceded it
   * (the preview never stages anything).
   */
  const commitResizedGeometry = useCallback(
    (entityId: EntityId, geometry: ResizeCommitGeometry) => {
      const pageId = pageIdRef.current;
      if (pageId === null) {
        return;
      }
      const current = workspaceRef.current;
      const page = findDesktopPage(current.snapshot, pageId);
      if (page === undefined) {
        return;
      }
      const placement = resolvePagePlacement(page);
      if (placement.mode === "grid") {
        if (geometry.kind !== "grid") {
          return;
        }
        const item = placement.items.find((candidate) => candidate.id === entityId);
        if (
          item === undefined ||
          (item.column === geometry.geometry.column &&
            item.row === geometry.geometry.row &&
            item.columnSpan === geometry.geometry.columnSpan &&
            item.rowSpan === geometry.geometry.rowSpan)
        ) {
          return;
        }
        commitCanvasEdit(pageId, replaceGridItem(placement, { id: entityId, ...geometry.geometry }));
        return;
      }
      if (geometry.kind !== "freeform") {
        return;
      }
      const item = placement.items.find((candidate) => candidate.id === entityId);
      if (item === undefined || !("rect" in item) || areRectsEqual(item.rect, geometry.rect)) {
        return;
      }
      commitCanvasEdit(pageId, replaceCanvasItem(placement, { id: entityId, rect: geometry.rect }) as PagePlacement);
    },
    [commitCanvasEdit, workspaceRef, pageIdRef]
  );

  /**
   * A resize gesture started/ended — holds or releases the desktop lock.
   * Geometry commits flow through the same canvas handoff as drags.
   */
  const handleResizeSessionChange = useCallback((entityId: EntityId, active: boolean) => {
    setResizeSessionAppId(active ? entityId : null);
  }, []);

  /** Undo/Redo: the resulting canvas is a brand-new local edit. */
  const applyHistoryStep = useCallback(
    (pageId: DesktopPageId, direction: "undo" | "redo") => {
      // History rewrites geometry against the durable snapshot — never while
      // a display handoff still outruns it.
      if (pendingHandoffRef.current !== null) {
        return;
      }
      const run = async () => {
        const base = arrangeHistoriesRef.current[pageId];
        if (base === undefined) {
          return;
        }
        const candidate =
          direction === "undo"
            ? undoPageCanvas(arrangeHistoriesRef.current, pageId)[pageId]
            : redoPageCanvas(arrangeHistoriesRef.current, pageId)[pageId];
        if (candidate === undefined || candidate === base) {
          return;
        }
        const current = workspaceRef.current;
        const page = findDesktopPage(current.snapshot, pageId);
        if (page === undefined || !areCanvasLayoutsEqual(resolvePagePlacement(page), base.present)) {
          // The canvas moved on since reconciliation — reset this page's
          // history instead of writing a stale snapshot.
          if (page !== undefined) {
            setArrangeHistories((current2) =>
              reconcilePageCanvasHistory(current2, pageId, resolvePagePlacement(page)),
            );
          }
          return;
        }
        const replaced = replacePageCanvas(current.snapshot, pageId, candidate.present);
        if (!replaced.ok) {
          return;
        }
        const staged = await stageWorkspaceAndTrySync(runtime, replaced.workspace);
        if (!staged.ok) {
          console.error(`VelaDesk: ${direction} was not staged (${staged.reason})`);
          return;
        }
        const nextMap: ArrangeCanvasHistories = {
          ...arrangeHistoriesRef.current,
          [pageId]: candidate,
        };
        arrangeHistoriesRef.current = nextMap;
        setArrangeHistories(nextMap);
      };
      layoutQueueRef.current = layoutQueueRef.current.then(run, run);
    },
    [runtime, workspaceRef]
  );

  /**
   * Keyboard nudge: one rigid step for the whole selection. A grid section
   * steps by a whole cell; a freeform section by an eighth of one (about
   * 16 CSS px), so the keys stay useful in both models.
   */
  const nudgeSelection = useCallback(
    (columnStep: number, rowStep: number) => {
      const pageId = pageIdRef.current;
      if (
        pageId === null ||
        selectionRef.current.size === 0 ||
        // Nudges compute against the durable snapshot — wait out any handoff,
        // and never fight a live resize.
        pendingHandoffRef.current !== null ||
        resizeLockRef.current
      ) {
        return;
      }
      const current = workspaceRef.current;
      const page = findDesktopPage(current.snapshot, pageId);
      if (page === undefined) {
        return;
      }
      const placement = resolvePagePlacement(page);
      const ids = [...selectionRef.current];
      const moved =
        placement.mode === "grid"
          ? translateGridItems(placement, ids, columnStep, rowStep)
          : (() => {
              const cell = canvasCellSize(page.layout.grid);
              const step = {
                width: Math.max(1, Math.round(cell.width / 8)),
                height: Math.max(1, Math.round(cell.height / 8)),
              };
              return translateCanvasItems(
                placement,
                ids,
                columnStep * step.width,
                rowStep * step.height
              ) as PagePlacement;
            })();
      if (moved === placement) {
        // Failed nudge: no change, no history entry, no sync.
        return;
      }
      commitCanvasEdit(pageId, moved);
    },
    [commitCanvasEdit, selectionRef, workspaceRef, pageIdRef]
  );

  /**
   * Whether a Grid→Freeform switch would lose geometry (content beyond the
   * freeform viewport) — the switch is refused with a localized reason.
   */
  const freeformBlockedReason = useMemo(() => {
    if (activePage === undefined) {
      return null;
    }
    const placement = resolvePagePlacement(activePage);
    if (placement.mode !== "grid") {
      return null;
    }
    // A retained freeform set (P1) restores verbatim on switch — nothing
    // converts, so nothing can be lossy.
    const retained = activePage.retainedCanvas;
    const hasRetainedFreeform =
      retained !== undefined &&
      (retained.version === 2 ? retained.mode === "freeform" : retained.mode === "freeform");
    if (hasRetainedFreeform) {
      return null;
    }
    return canConvertGridToFreeform(placement.items, activePage.layout.grid)
      ? null
      : t("menu.placementFreeformBlocked");
  }, [activePage, t]);

  /**
   * Switches a section between Grid and Freeform placement KEEPING both
   * layout datasets (P1) — retained restore, lossy first-conversion
   * refusal, history restart. The geometry itself is resolved by the pure
   * `resolvePlacementSwitch` (see its module docs).
   */
  const setPlacementMode = useCallback(
    (next: PagePlacementMode) => {
      const pageId = pageIdRef.current;
      if (pageId === null || pendingHandoffRef.current !== null || resizeLockRef.current) {
        return;
      }
      // Eager switch for the optimistic handoff (the queue re-resolves
      // against its own turn state below). A null here means the toolbar's
      // disabled state already carries the reason — nothing to do.
      const eager = resolvePlacementSwitch(workspaceRef.current.snapshot, pageId, next);
      if (eager === null) {
        return;
      }
      const token = handoffTokenRef.current + 1;
      handoffTokenRef.current = token;
      stagePendingHandoff({ token, pageId, placement: eager.placement });
      const run = async () => {
        let settled = false;
        const settle = (outcome: LayoutCommitOutcome) => {
          if (settled) {
            return;
          }
          settled = true;
          if (outcome.status === "failed") {
            // The stage refused: the optimistic display canvas falls back
            // to the authoritative (pre-switch) one.
            if (pendingHandoffRef.current?.token === token) {
              settledHandoffTokensRef.current = new Set([
                ...settledHandoffTokensRef.current,
                token,
              ]);
              stagePendingHandoff(null);
            }
            return;
          }
          settledHandoffTokensRef.current = new Set([
            ...settledHandoffTokensRef.current,
            token,
          ]);
        };
        try {
          const turn = resolvePlacementSwitch(workspaceRef.current.snapshot, pageId, next);
          if (turn === null) {
            settle({ status: "noop" });
            return;
          }
          await stagePlacementSnapshot(pageId, turn.snapshot, turn.placement, { resetHistory: true }, settle);
        } catch (error) {
          console.error("VelaDesk: placement switch could not be committed", error);
          settle({ status: "failed" });
        }
      };
      layoutQueueRef.current = layoutQueueRef.current.then(run, run);
    },
    [workspaceRef, pageIdRef, stagePlacementSnapshot]
  );

  /**
   * The placement the ACTIVE section renders this frame: the pending handoff
   * while it targets the active page, otherwise the authoritative placement
   * (a stored one, or the v2 placement derived from v1/legacy geometry).
   * Only the active section consumes it — persistence still flows
   * exclusively through the domain/runtime path.
   */
  const displayPlacement =
    activePage !== undefined
      ? resolveDisplayPlacement(pendingCanvasHandoff, activePage.id, resolvePagePlacement(activePage))
      : null;

  return {
    // Geometry + history commands (consumed by the shell's menus, toolbar
    // and keyboard shortcuts, and by the tile session's drag wiring).
    commitCanvasEdit,
    commitDraggedCanvas,
    commitResizedGeometry,
    handleResizeSessionChange,
    applyHistoryStep,
    nudgeSelection,
    setPlacementMode,
    freeformBlockedReason,
    displayPlacement,
    // State + mirrors the shell and the session read.
    handoffLock,
    resizeLock,
    resizeActiveId,
    pendingHandoffRef,
    resizeLockRef,
    arrangeHistoriesRef,
    layoutQueueRef,
    setArrangeHistories,
  };
}

/** The canvas command surface returned by {@link useCanvasCommits}. */
export type CanvasCommits = ReturnType<typeof useCanvasCommits>;

function areRectsEqual(a: CanvasRect, b: CanvasRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
