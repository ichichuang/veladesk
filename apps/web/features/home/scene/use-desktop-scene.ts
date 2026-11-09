"use client";

import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useVdReducedMotion } from "@components/vd/reduced-motion";
import type {
  DesktopPage,
  DesktopPageId,
  EffectiveWallpaper,
  WorkspaceAppearancePreferences,
  WorkspaceSnapshot,
} from "@veladesk/domain";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";

import type { BackgroundPreview } from "../desktop-wallpaper";
import { useSceneWallpaper } from "./use-scene-wallpaper";
import { useSectionScrollMemory } from "./use-section-scroll-memory";
import { usePairCoordinator } from "./use-pair-coordinator";
import type { SectionPairSettledListener } from "../section-pair-animator";
import {
  IDLE_SECTION_NAV,
  pruneMissingSections,
  reportLayerSettled,
  requestSection,
  startPreparedTransition,
  visibleActiveIdOf,
} from "../section-transition-machine";
import type { SectionNavMachine } from "../section-transition-machine";
import { scopedToLayer } from "../section-layer-query";
import { resolveWarmSectionIds } from "../section-warm-cache";
import type { SectionScrollMemory } from "../section-scroll-memory";
import { sectionTransitionDirection } from "../section-navigation-model";
import type { WorkspaceActiveSection } from "../workspace-active-section";
import type { WorkspaceViewStateV1 } from "../workspace-view-state";

/**
 * The desktop SCENE controller (P1-ENG-1): everything the eye sees move
 * between sections — the section-navigation machine, the warm mounted set,
 * the GSAP page-pair coordinator, the per-section scroll memory and the
 * wallpaper resolution. Extracted VERBATIM from the former monolithic
 * desktop-shell.tsx; the shell calls this hook and composes the returned
 * controller into SceneBackdrop / SceneViewport and the tile layers.
 *
 * GSAP owns this layer: the pair coordinator is the only GSAP timeline in
 * the desktop, and nothing outside the scene may touch the layer
 * transforms. The hook never imports the tile host; the shell feeds it the
 * shared refs (viewport element, active page id, workspace record) and the
 * shell-owned wallpaper preview state.
 */
export interface UseDesktopSceneInput {
  /** The RENDERED workspace (appearance projection) — wallpaper resolution. */
  readonly renderedSnapshot: WorkspaceSnapshot;
  /** The raw pages of the authoritative snapshot, in workspace order. */
  readonly workspacePages: readonly DesktopPage[];
  /** Live Settings background draft (scope-keyed), or null. */
  readonly backgroundPreview: BackgroundPreview | null;
  /** The resolved appearance (preview ?? persisted). */
  readonly resolvedAppearance: WorkspaceAppearancePreferences;
  /**
   * The EFFECTIVE color mode ("dark"/"light", resolved from `system`) —
   * selects the per-mode wallpaper override of the visible section (P1).
   */
  readonly effectiveColorMode: "dark" | "light";
  /** The shared active-section controller (026 §17). */
  readonly activeSection: WorkspaceActiveSection;
  /** Mount-scoped persisted view state (boot read), owned by the shell. */
  readonly bootPersisted: () => { readonly persisted: WorkspaceViewStateV1 | null };
  /** The section viewport element (queried for scroll capture/height). */
  readonly viewportRef: RefObject<HTMLDivElement | null>;
  /** Latest-value mirror of the effective active page id. */
  readonly pageIdRef: RefObject<DesktopPageId | null>;
  /** Latest-value mirror of the workspace record. */
  readonly workspaceRef: RefObject<LocalWorkspaceRecord>;
  /**
   * Latest-value mirror of the tile-host resize lock: a live icon resize
   * owns the desktop outright, so section switching stands down.
   */
  readonly resizeLockRef: RefObject<boolean>;
}

/** The scene controller consumed by the shell and the scene components. */
export interface DesktopScene {
  /** The current navigation machine (idle / prepared / transition). */
  readonly machine: SectionNavMachine;
  /** The mounted (warm) section pages, in workspace page order. */
  readonly mountedSectionLayers: readonly DesktopPage[];
  /** The one section-switch entry point (animated by default). */
  readonly switchSection: (pageId: DesktopPageId, options?: { readonly animate?: boolean }) => void;
  /** DOM scroll capture for the shared view-state flush boundaries. */
  readonly captureActiveScroll: () => void;
  /** Stable layer-element registration for the pair coordinator. */
  readonly registerSectionLayer: (pageId: DesktopPageId, node: HTMLElement | null) => void;
  /** The session scroll memory (seeded from the persisted view state). */
  readonly sectionScrollMemory: () => SectionScrollMemory;
  /** The effective wallpaper of the VISIBLE section. */
  readonly effectiveWallpaper: EffectiveWallpaper;
  /** The resolved object URL for an asset wallpaper (null while cold). */
  readonly wallpaperAssetUrl: string | null;
  /** The shared reduced-motion bridge (the scene is its only consumer). */
  readonly reducedMotion: boolean;
}

export function useDesktopScene(input: UseDesktopSceneInput): DesktopScene {
  const {
    renderedSnapshot,
    workspacePages,
    backgroundPreview,
    resolvedAppearance,
    effectiveColorMode,
    activeSection,
    bootPersisted,
    viewportRef,
    pageIdRef,
    workspaceRef,
    resizeLockRef,
  } = input;
  const effectiveActivePageId = activeSection.effectiveActivePageId;
  const reducedMotion = useVdReducedMotion();

  /**
   * The MOUNTED sections (task 020-A2): the warm set around the active
   * section — previous, active, next — kept mounted, hidden and
   * layout-ready so a switch never builds the destination tree inside the
   * commit that starts the visible transition. Rotated ONLY when the
   * navigation machine settles (never during a visible transition).
   */
  const [mountedSectionIds, setMountedSectionIds] = useState<readonly DesktopPageId[]>(() =>
    resolveWarmSectionIds({
      pageOrder: workspacePages.map((page) => page.id),
      activePageId: activeSection.activePageId,
    })
  );
  /**
   * The section-navigation machine (020-A2 §15): idle / preparing-target /
   * transitioning, separating mounted content from the visible transition.
   * Pure model in section-transition-machine.ts; the shell applies its
   * lifecycle flips and renders one stable layer per mounted section.
   */
  const [sectionNavMachine, setSectionNavMachine] = useState<SectionNavMachine>(
    IDLE_SECTION_NAV
  );

  // The wallpaper chain (resolution + asset URL) — extracted whole into
  // use-scene-wallpaper.ts; bound to the machine-VISIBLE section.
  const { effectiveWallpaper, wallpaperAssetUrl } = useSceneWallpaper({
    sectionNavMachine,
    effectiveActivePageId,
    renderedPages: renderedSnapshot.pages,
    backgroundPreview,
    resolvedAppearance,
    effectiveColorMode,
  });

  /**
   * Per-section scroll memory (session-shaped, boot-seeded from the
   * persisted view state — see use-section-scroll-memory.ts).
   */
  const sectionScrollMemory = useSectionScrollMemory(bootPersisted);
  /**
   * Imperative mirrors of the navigation machine and the mounted warm set:
   * event handlers and animation completion callbacks must always read the
   * freshest state without re-binding (same pattern as the history map).
   */
  const navMachineRef = useRef<SectionNavMachine>(IDLE_SECTION_NAV);
  const mountedIdsRef = useRef<readonly DesktopPageId[]>(mountedSectionIds);
  /**
   * Navigation request identity (021-R1): every accepted request (and every
   * instant/reduced-motion swap) mints the next generation. Animation
   * completions carry a generation; a completion from a superseded request
   * can never settle, rotate or cancel the newer one.
   */
  const navGenerationRef = useRef(0);
  /**
   * A layer REST is pending an idle commit (022-R2). Resting a layer means
   * normalizing it to the hidden-cache origin (y 0, opacity 1) — legal only
   * once the commit that retires the machine has ALSO flipped the exited
   * page's phase to warm-hidden. Every path that idles the machine from a
   * context whose commit has not landed yet (GSAP completion callbacks,
   * passive effects) sets this flag instead of writing styles; the
   * pair-command layout effect below performs the rest pre-paint in the
   * very commit that hides the exited page, so no painted frame can show
   * the just-exited page back at the viewport origin.
   */
  const restLayersOnIdleRef = useRef(false);
  /**
   * The GSAP page-pair coordinator (task 022) — ONE lazily-created timeline
   * owning the visible page pair per transition, disposed on unmount
   * (use-pair-coordinator.ts).
   */
  const { pairCoordinator, registerSectionLayer } = usePairCoordinator();
  /**
   * The scheduled arm frame for a prepared cold target (021-R1): the mount
   * commit must get one LAYOUT pass — with its ResizeObserver notifications
   * and adaptive-content settle — before the visible transition starts.
   * Discrete-event commits flush their effects before the browser paints,
   * so arming synchronously in the lifecycle effect could reveal the target
   * inside the very commit that mounted it — the reported stall-then-jump.
   * A single animation frame guarantees exactly that settle pass (rAF
   * callbacks run before their frame paints; whether the hidden mount frame
   * itself reaches the screen depends on when the lifecycle effect ran
   * relative to that frame's rAF phase — the paint is not the contract, the
   * layout pass is). Cancelled on supersede and unmount.
   */
  const armFrameRef = useRef<number | null>(null);

  /** Applies the machine state, mirror ref included. */
  const applySectionNav = useCallback((machine: SectionNavMachine) => {
    navMachineRef.current = machine;
    setSectionNavMachine(machine);
  }, []);

  /** Applies the mounted warm set, mirror ref included. */
  const applyMountedSections = useCallback((mountedIds: readonly DesktopPageId[]) => {
    mountedIdsRef.current = mountedIds;
    setMountedSectionIds(mountedIds);
  }, []);

  /**
   * Warm-set rotation (020-A2 §13): recompute the ±1 window around the
   * settled active section. Runs ONLY when the machine reaches idle — the
   * new neighbor mounts hidden and the far section unmounts after the
   * visible navigation has settled, never inside it (§14).
   */
  const rotateWarmSet = useCallback(
    (activeId: DesktopPageId | null) => {
      const pageOrder = workspaceRef.current.snapshot.pages.map((page) => page.id);
      applyMountedSections(resolveWarmSectionIds({ pageOrder, activePageId: activeId }));
    },
    [applyMountedSections, workspaceRef]
  );

  /**
   * Latest-value mirror so the pair-settle callback never closes over a
   * stale switchSection identity (assigned in an effect below — switchSection
   * is declared later in this body; a settle can never fire before effects run).
   */
  const switchSectionRef = useRef<(pageId: DesktopPageId) => void>(() => {});

  /**
   * The page pair settled (task 022): the coordinator reports ONE
   * generation-guarded completion per transition. The shell evaluates it
   * against the CURRENT machine (a stale generation or an unknown layer is
   * a no-op there), idles the machine, rotates the warm set, and starts a
   * parked third-target request immediately — no added settle delay.
   *
   * 022-R2: the completion fires inside the GSAP tick, BEFORE React commits
   * the machine→idle update — the exited page's DOM still carries its
   * visible `exit` phase here. The layers are therefore NOT rested
   * synchronously (that wrote the just-exited page back to the viewport
   * origin for the frames between this tick and the commit — the reported
   * "arrives, briefly returns, flashes again" rollback); the rest is
   * deferred to the idle commit's layout effect, which runs pre-paint with
   * the exited page already warm-hidden.
   */
  const handlePairSettled = useCallback<SectionPairSettledListener>(
    (pageId) => {
      const machine = navMachineRef.current;
      // A parked third destination is read BEFORE the settle report: the
      // report itself retires the transition state that carries it.
      const pendingId = machine.kind === "transition" ? machine.pendingId : null;
      // The report is evaluated against the CURRENT machine: a superseded
      // generation or an unknown layer is a no-op there.
      const next = reportLayerSettled(
        machine,
        pageId,
        machine.kind === "idle" ? navGenerationRef.current : machine.generation,
      );
      if (next === machine) {
        return;
      }
      applySectionNav(next);
      if (next.kind === "idle") {
        // Final poses → rest — deferred to the idle commit (see the ref
        // above); the destination layer stays the same mounted node at
        // y=0/opacity 1 through this boundary. The transitioning attribute
        // drops with that commit and the glass blur policy restores.
        restLayersOnIdleRef.current = true;
        rotateWarmSet(pageIdRef.current);
        if (pendingId !== null && pendingId !== pageIdRef.current) {
          // Bounded latest-target continuation: the newest third
          // destination starts right now, from the settled boundary.
          switchSectionRef.current(pendingId);
        }
      }
    },
    [applySectionNav, rotateWarmSet, pageIdRef]
  );

  /**
   * Arms a prepared cold target after its hidden mount has had its
   * preparation LAYOUT pass (§16, re-grounded 021-R1): the lifecycle effect
   * schedules a single animation frame — the hidden destination's observers
   * and adaptive layout settle in that pass (see {@link armFrameRef} for the
   * exact paint-vs-layout semantics), and only then does the visible
   * transition start. Synchronous arming could run inside the discrete
   * event's commit, revealing the target before any preparation pass
   * existed (the reported stall-then-jump on cold switches). The frame is
   * cancelled on supersede and unmount; a callback whose machine moved on
   * (newer generation, no longer prepared) is discarded.
   */
  function armPreparedSection() {
    const machine = navMachineRef.current;
    if (machine.kind !== "prepared") {
      return;
    }
    if (armFrameRef.current !== null) {
      return;
    }
    armFrameRef.current = requestAnimationFrame(() => {
      armFrameRef.current = null;
      const current = navMachineRef.current;
      if (current.kind !== "prepared") {
        return; // superseded while the preparation frame elapsed
      }
      applySectionNav(startPreparedTransition(current));
    });
  }

  /**
   * Structural reconciliation: vanished pages can never report a settle,
   * so they are pruned from the machine instead of stalling it. Same
   * plain-helper shape as armPreparedSection.
   */
  function pruneNavMachine() {
    const next = pruneMissingSections(
      navMachineRef.current,
      workspaceRef.current.snapshot.pages.map((page) => page.id)
    );
    if (next === navMachineRef.current) {
      return;
    }
    applySectionNav(next);
    if (next.kind === "idle") {
      pairCoordinator().halt();
      restLayersOnIdleRef.current = true;
      rotateWarmSet(pageIdRef.current);
    }
  }

  /**
   * Section switching with the whole-page vertical transition (018,
   * re-architected 020-A2).
   *
   * The destination is normally ALREADY MOUNTED (the warm ±1 set), so the
   * machine starts the visible transition without creating a single new
   * component (§29 — mounted set unchanged on a warm request). A cold
   * destination mounts hidden first and is revealed one render lifecycle
   * later (§16). New intent during an in-flight transition retargets every
   * layer from its current visual position — the latest target always
   * wins, there is no queue. Instant reveals (structural changes) are a
   * machine-level no-transition switch: no presence subtree is ever
   * remounted (§21). The outgoing section's scrollTop is remembered; a
   * still-mounted warm page keeps its live scroll untouched, and only an
   * evicted page re-runs the mount-time restore (§30).
   */
  const switchSection = useCallback(
    (pageId: DesktopPageId, options: { readonly animate?: boolean } = {}) => {
      const currentId = pageIdRef.current;
      if (pageId === currentId || currentId === null) {
        return;
      }
      if (resizeLockRef.current) {
        // A live resize owns the desktop: switching would unmount the tile
        // (and its pointer capture) out from under the user.
        return;
      }

      const pages = workspaceRef.current.snapshot.pages;
      const pageOrder = pages.map((page) => page.id);
      // 021-R3: input-handler entry. This is when the handler ran, NOT the
      // hardware input time.
      // One pure direction source for every path (019-E §23), computed
      // from the VISIBLE section so an interruption animates the way the
      // user currently sees.
      const visibleId = visibleActiveIdOf(navMachineRef.current, currentId);
      const direction = sectionTransitionDirection(
        visibleId === null ? -1 : pageOrder.indexOf(visibleId),
        pageOrder.indexOf(pageId)
      );
      if (direction === null) {
        return;
      }

      // Remember the OUTGOING (visible) section's scroll position (session
      // only). Scoped to the VISIBLE page's own layer (021-R1): during an
      // interrupted transition more than one layer can carry
      // data-active-section, so the old attribute lookup could save the
      // wrong page's scrollTop under this page's id.
      if (visibleId !== null) {
        const visibleLayer = viewportRef.current?.querySelector(
          scopedToLayer(visibleId, ".vela-section-scroller") ?? ""
        );
        if (visibleLayer instanceof HTMLDivElement) {
          sectionScrollMemory().save(visibleId, visibleLayer.scrollTop);
          // 023-A: the outgoing section's scrollTop rides the same logical
          // leave-section boundary into the persisted view state — never a
          // per-scroll-event write.
          activeSection.recordScrollTop(visibleId, visibleLayer.scrollTop);
        }
      }

    if (options.animate === false || reducedMotion) {
      // Instant swap: no transition state at all, warm set rotates now.
      // The generation bump retires any in-flight animation completion —
      // reduced motion keeps the same visibility invariants (exactly one
      // painted section at rest) without the animated path.
      const wasIdle = navMachineRef.current.kind === "idle";
      navGenerationRef.current += 1;
      applySectionNav(IDLE_SECTION_NAV);
      applyMountedSections(resolveWarmSectionIds({ pageOrder, activePageId: pageId }));
      // Any mid-flight pair pose is retired with the machine (022). Only
      // the timeline dies here — the layer REST waits for the idle commit
      // (022-R2): this handler can run in a passive effect (the structural
      // reveal path), where the DOM still shows the exited page's visible
      // phase and a synchronous rest would paint it at the origin.
      pairCoordinator().halt();
      restLayersOnIdleRef.current = true;
      if (!wasIdle) {
        // The transitioning attribute drops: the glass blur policy restores.
      }
      // 023-A: continuity records the LOGICAL destination at request time —
      // a refresh mid-slide reopens on the section the user asked for, and
      // navigation never waits for the 0.5s pair to finish.
      activeSection.requestActiveSection(pageId);
      return;
    }

    // Direction only: the pair coordinator measures the live viewport
    // height at command time (task 022 full-height slide).
    const intent = { direction };
    const generation = navGenerationRef.current + 1;
    const outcome = requestSection({
      machine: navMachineRef.current,
      mountedIds: mountedIdsRef.current,
      pageOrder,
      currentActiveId: currentId,
      targetId: pageId,
      intent,
      generation,
    });
    if (outcome === null) {
      return;
    }
    const wasIdle = navMachineRef.current.kind === "idle";
    // The machine may keep the RUNNING generation (a parked third target
    // only updates pendingId) — the ref follows the machine, never the
    // request counter.
    const outcomeGeneration =
      outcome.machine.kind === "prepared" || outcome.machine.kind === "transition"
        ? outcome.machine.generation
        : generation;
    navGenerationRef.current = outcomeGeneration;
    applySectionNav(outcome.machine);
    if (wasIdle) {
      // The transitioning attribute rises: the glass blur policy suspends.
    }
    applyMountedSections(outcome.mountedIds);
    // 023-A: accepted navigation — the destination is the user's latest
    // intent, persisted immediately in memory (disk follows coalesced).
    activeSection.requestActiveSection(pageId);
  },
    [activeSection, applyMountedSections, applySectionNav, reducedMotion, sectionScrollMemory, viewportRef, workspaceRef, pageIdRef, resizeLockRef, pairCoordinator]
  );

  useEffect(() => {
    switchSectionRef.current = switchSection;
  });

  /**
   * Machine lifecycle, flip 1 of 1 (020-A2 §16, reveal after the
   * preparation pass, 021-R1): a prepared cold target arms once its hidden
   * mount has settled — see {@link armPreparedSection}. StrictMode's
   * setup-cleanup-setup reschedules idempotently; superseded generations
   * discard their callback.
   */
  useEffect(() => {
    armPreparedSection();
    return () => {
      if (armFrameRef.current !== null) {
        cancelAnimationFrame(armFrameRef.current);
        armFrameRef.current = null;
      }
    };
  });

  /** Structural reconciliation: prune vanished pages out of the machine. */
  useEffect(() => {
    pruneNavMachine();
  });

  /**
   * The pair-command effect (task 022): while the machine is in a visible
   * transition, feed the coordinator ONE command per generation. Everything
   * else — prepared (a cold target measuring hidden, any superseded exit
   * still animating), idle — intentionally leaves the coordinator alone:
   * an in-flight pair keeps running to its boundary, and explicit idle
   * paths (settle, instant swap, prune) schedule their own rest.
   * Identical re-applies are skipped inside the coordinator.
   *
   * 022-R2: this layout effect is also the REST boundary for the idle
   * paths. It runs pre-paint in the very commit that flips the exited page
   * to warm-hidden, so resting there can never paint the exited page back
   * at the viewport origin; a superseding request in the same window
   * consumes the flag here too — its command application rests every
   * non-participant (the previous exit included, hidden by that commit).
   */
  useLayoutEffect(() => {
    const machine = navMachineRef.current;
    if (machine.kind === "transition" && !reducedMotion) {
      restLayersOnIdleRef.current = false;
      const outgoingId = machine.exitingIds[machine.exitingIds.length - 1];
      if (outgoingId === undefined) {
        return;
      }
      const coordinator = pairCoordinator();
      const incoming = coordinator.layerElement(machine.toId);
      const outgoing = coordinator.layerElement(outgoingId);
      if (incoming === null || outgoing === null) {
        return; // the pair commits with the next render's layers
      }
      coordinator.apply(
        {
          generation: machine.generation,
          incomingId: machine.toId,
          outgoingId,
          direction: machine.intent.direction,
          enterFromOffset: machine.enterFromOffset,
          viewportHeight: viewportRef.current?.clientHeight ?? 480,
        },
        handlePairSettled,
      );
      return;
    }
    if (restLayersOnIdleRef.current) {
      restLayersOnIdleRef.current = false;
      pairCoordinator().settleAll();
    }
  });

  /**
   * A reduced-motion preference flipping ON mid-transition settles the
   * machine immediately: valid product state without waiting out the
   * interpolation, and the stale completion can never fire afterwards.
   */
  useEffect(() => {
    if (!reducedMotion || navMachineRef.current.kind === "idle") {
      return;
    }
    navGenerationRef.current += 1;
    applySectionNav(IDLE_SECTION_NAV);
    pairCoordinator().halt();
    restLayersOnIdleRef.current = true;
    rotateWarmSet(pageIdRef.current);
  }, [reducedMotion, applySectionNav, rotateWarmSet, pageIdRef, pairCoordinator]);

  // (The coordinator's unmount disposal lives in use-pair-coordinator.ts —
  // the cleanup ordering with the arm-frame cancellation below is
  // order-independent teardown.)

  /**
   * DOM scroll capture for the shared view-state flush boundaries (023-A,
   * lifted 026 §17): the shared active-section hook owns the controller,
   * its pagehide/unmount flushes and the disk writes; the DESKTOP-SPECIFIC
   * half — reading the active scroller's live scrollTop into the session
   * memory and the persisted view state — happens here, invoked by the
   * hook right before every synchronous flush.
   */
  function captureActiveScroll() {
    const activeId = pageIdRef.current;
    if (activeId === null) {
      return;
    }
    const scroller = viewportRef.current?.querySelector(
      scopedToLayer(activeId, ".vela-section-scroller") ?? ""
    );
    if (scroller instanceof HTMLDivElement) {
      sectionScrollMemory().save(activeId, scroller.scrollTop);
      activeSection.recordScrollTop(activeId, scroller.scrollTop);
    }
  }

  /** The mounted (warm) section pages, in workspace page order. */
  const mountedSectionLayers = useMemo(
    () => workspacePages.filter((page) => mountedSectionIds.includes(page.id)),
    [workspacePages, mountedSectionIds]
  );

  return {
    machine: sectionNavMachine,
    mountedSectionLayers,
    switchSection,
    captureActiveScroll,
    registerSectionLayer,
    sectionScrollMemory,
    effectiveWallpaper,
    wallpaperAssetUrl,
    reducedMotion,
  };
}
