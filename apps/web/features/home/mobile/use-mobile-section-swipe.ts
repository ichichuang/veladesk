"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { gsap } from "@components/vd/gsap";
import { VD_MOTION_EASE, vdMotionDuration } from "@components/vd/motion-tokens";

import {
  adjacentSectionIndex,
  resolveSwipeAxis,
  resolveSwipeRelease,
  swipeOffset,
} from "./mobile-swipe-model";

/**
 * Horizontal section paging for the mobile shell (pointer-events based).
 *
 * Scope, deliberately narrow:
 *  - TOUCH ONLY (`pointerType === "touch"`). The desktop shell never mounts
 *    this hook at all, and a mouse drag over a phone-width window keeps its
 *    native behaviour — no gesture hijack on a desktop browser.
 *  - The strip's horizontal translation is a TRANSFORM written once per
 *    frame on the strip element. Layout properties are never animated, and
 *    the vertical scroller is untouched, so tiles keep their taps and the
 *    page keeps its native vertical scroll.
 *  - `touch-action: pan-y` + claiming only after the horizontal lock means
 *    a vertical flick still scrolls natively: the browser owns the gesture
 *    until the model says "horizontal".
 *
 * Motion: the finger drives the offset 1:1, the release either commits to
 * the neighbour with the shared ease or springs back to rest. The commit is
 * seam-free: the strip STAYS at the landing pose until React has re-slotted
 * the panes, and the reset to 0 happens in a layout effect of that same
 * commit — so no frame ever shows the previous page again.
 *
 * Reduced motion: no follow-the-finger and no settle tween — the gesture is
 * still recognised and the section swaps instantly on release.
 *
 * A section change that did NOT come from a swipe (a tab tap, search, sync)
 * keeps the short tab-content entrance (x 12px + fade) on the new page.
 */

export interface SectionSwipeHandlers {
  /** Ref for the strip element (the one the transform is written to). */
  readonly stripRef: (element: HTMLElement | null) => void;
  /** Spread on the strip. */
  readonly onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
}

export interface UseSectionSwipeOptions {
  /** Section ids in display order. */
  readonly pageIds: readonly string[];
  /** The section currently shown. */
  readonly activePageId: string | null;
  /** Commit a section — the shell records it and the panes re-slot. */
  readonly onCommit: (pageId: string) => void;
  readonly looping: boolean;
  readonly reducedMotion: boolean;
}

interface GestureState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  phase: "idle" | "horizontal" | "vertical";
  offsetPx: number;
  /** Finger velocity in px/ms (same sign as the offset). */
  velocityPx: number;
  lastX: number;
  lastTime: number;
}

/** A release this long after the last move is a hold, not a flick. */
const STALE_VELOCITY_MS = 90;

export function useSectionSwipe(options: UseSectionSwipeOptions): SectionSwipeHandlers {
  const { activePageId } = options;

  /** Latest options for the window listeners, which never re-bind. */
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  }, [options]);

  const gesture = useRef<GestureState | null>(null);
  const tween = useRef<gsap.core.Tween | null>(null);
  const entrance = useRef<gsap.core.Tween | null>(null);
  const strip = useRef<HTMLElement | null>(null);
  /** Set when the NEXT page change is a swipe commit (no entrance, scroll to top). */
  const swipeCommitted = useRef(false);
  /** The page shown on the previous commit; null before the first one. */
  const previousPage = useRef<string | null | undefined>(undefined);
  /**
   * Armed by `finish` when a horizontal gesture ended, cleared by the very
   * next click (or a short timer): a swipe never also taps a tile.
   */
  const suppressClick = useRef(false);
  const disarmTimer = useRef<number | null>(null);

  const stripRef = useCallback((element: HTMLElement | null) => {
    strip.current = element;
  }, []);

  const killTween = useCallback(() => {
    tween.current?.kill();
    tween.current = null;
  }, []);

  /**
   * Every page change settles the strip IN THE SAME COMMIT, before paint:
   * the committed page is the centre slot again and the transform returns
   * to 0. After a swipe the strip was already showing that page at the
   * landing pose, so nothing moves on screen — the seam-free loop.
   */
  useLayoutEffect(() => {
    const element = strip.current;
    const first = previousPage.current === undefined;
    const changed = !first && previousPage.current !== activePageId;
    previousPage.current = activePageId;
    if (element === null) {
      return;
    }
    killTween();
    setDragging(element, false);
    gsap.set(element, { x: 0, clearProps: "transform" });
    if (!changed) {
      return;
    }
    const fromSwipe = swipeCommitted.current;
    swipeCommitted.current = false;
    const parent = element.parentElement;
    if (fromSwipe) {
      // The neighbour was shown from its top during the drag.
      if (parent !== null) {
        parent.scrollTop = 0;
      }
      return;
    }
    // Tap / search / sync: the canonical short tab-content entrance.
    const pane = element.querySelector<HTMLElement>('[data-swipe-slot="0"]');
    entrance.current?.kill();
    entrance.current = null;
    if (pane === null || latest.current.reducedMotion) {
      return;
    }
    entrance.current = gsap.fromTo(
      pane,
      { x: 12, opacity: 0 },
      {
        x: 0,
        opacity: 1,
        duration: vdMotionDuration("tabContent"),
        ease: VD_MOTION_EASE,
        clearProps: "transform,opacity",
        onComplete: () => {
          entrance.current = null;
        },
      },
    );
  }, [activePageId, killTween]);

  useEffect(
    () => () => {
      killTween();
      entrance.current?.kill();
      if (disarmTimer.current !== null) {
        window.clearTimeout(disarmTimer.current);
      }
    },
    [killTween],
  );

  const finish = useCallback(
    (allowCommit: boolean, releaseTime: number) => {
      const state = gesture.current;
      gesture.current = null;
      const element = strip.current;
      if (state === null || state.phase !== "horizontal" || element === null) {
        return;
      }
      // The browser may still synthesise a click on whatever tile is under
      // the finger: swallow exactly that one (capture listener below), and
      // expire the flag so it can never eat a genuine later tap.
      suppressClick.current = true;
      if (disarmTimer.current !== null) {
        window.clearTimeout(disarmTimer.current);
      }
      disarmTimer.current = window.setTimeout(() => {
        suppressClick.current = false;
        disarmTimer.current = null;
      }, 400);

      const viewport = element.clientWidth;
      const current = latest.current;
      const velocity = releaseTime - state.lastTime > STALE_VELOCITY_MS ? 0 : state.velocityPx;
      const decision =
        allowCommit && viewport > 0
          ? resolveSwipeRelease({
              offset: state.offsetPx / viewport,
              velocity,
              pageCount: current.pageIds.length,
            })
          : ({ step: 0, springBack: true } as const);

      const from = current.activePageId === null ? -1 : current.pageIds.indexOf(current.activePageId);
      const targetIndex =
        decision.step === 0 || from < 0
          ? from
          : adjacentSectionIndex(from, decision.step, current.pageIds.length, current.looping);
      const targetId = targetIndex < 0 ? null : (current.pageIds[targetIndex] ?? null);
      const commits = targetId !== null && decision.step !== 0 && targetId !== current.activePageId;

      const commit = () => {
        if (commits) {
          // The strip stays at the landing pose (neighbour at centre) until
          // React re-slots; the layout effect of THAT commit zeroes the
          // transform and hides the neighbours before paint.
          swipeCommitted.current = true;
          current.onCommit(targetId);
        } else {
          gsap.set(element, { x: 0, clearProps: "transform" });
          setDragging(element, false);
        }
      };

      if (current.reducedMotion) {
        commit();
        return;
      }
      // Where the strip comes to rest: one full viewport in the direction the
      // pages were already moving (the neighbour lands at centre), or 0.
      const landing = commits ? (decision.step === 1 ? -viewport : viewport) : 0;
      if (commits) {
        placeSharedNeighbour(element, landing);
      }
      killTween();
      const remaining = Math.abs(landing - state.offsetPx) / Math.max(viewport, 1);
      const duration = Math.min(
        vdMotionDuration("sectionPage"),
        Math.max(vdMotionDuration("controlState"), 0.18 + remaining * 0.28),
      );
      tween.current = gsap.to(element, {
        x: landing,
        duration,
        ease: VD_MOTION_EASE,
        overwrite: "auto",
        onComplete: () => {
          tween.current = null;
          commit();
        },
      });
    },
    [killTween],
  );

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const current = latest.current;
    // Desktop mouse and pen stay native; only touch pages sections.
    if (event.pointerType !== "touch" || current.pageIds.length <= 1) {
      return;
    }
    if (gesture.current !== null) {
      return; // a second finger never retargets an in-flight gesture
    }
    if (tween.current !== null) {
      // Catching the strip mid-settle: finish that settle instantly first.
      tween.current.progress(1);
    }
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      phase: "idle",
      offsetPx: 0,
      velocityPx: 0,
      lastX: event.clientX,
      lastTime: event.timeStamp,
    };
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const state = gesture.current;
      const element = strip.current;
      if (state === null || element === null || event.pointerId !== state.pointerId || state.phase === "vertical") {
        return;
      }
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;

      if (state.phase === "idle") {
        const axis = resolveSwipeAxis(dx, dy);
        if (axis === null) {
          return;
        }
        if (axis === "vertical") {
          // Hand the gesture back: native vertical scroll wins.
          state.phase = "vertical";
          return;
        }
        state.phase = "horizontal";
        if (!latest.current.reducedMotion) {
          placeNeighbours(element);
          setDragging(element, true);
        }
      }

      const viewport = element.clientWidth;
      if (viewport <= 0) {
        return;
      }
      // The transform IS the finger delta: dragging left (dx < 0) moves the
      // content left, so the NEXT page slides in from the right.
      const offsetPx = swipeOffset(dx / viewport, latest.current.looping) * viewport;
      const dt = Math.max(1, event.timeStamp - state.lastTime);
      const instant = (event.clientX - state.lastX) / dt;
      // Light smoothing: one jittery sample must not decide the flick.
      state.velocityPx = state.velocityPx * 0.35 + instant * 0.65;
      state.lastX = event.clientX;
      state.lastTime = event.timeStamp;
      state.offsetPx = offsetPx;

      if (!latest.current.reducedMotion) {
        placeSharedNeighbour(element, offsetPx);
        gsap.set(element, { x: offsetPx });
      }
    };

    const onUp = (event: PointerEvent) => {
      if (gesture.current === null || event.pointerId !== gesture.current.pointerId) {
        return;
      }
      finish(true, event.timeStamp);
    };

    const onCancel = (event: PointerEvent) => {
      if (gesture.current === null || event.pointerId !== gesture.current.pointerId) {
        return;
      }
      finish(false, event.timeStamp);
    };

    const onSwipeSuppressedClick = (event: MouseEvent) => {
      if (!suppressClick.current) {
        return;
      }
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("click", onSwipeSuppressedClick, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("click", onSwipeSuppressedClick, true);
    };
  }, [finish]);

  return { stripRef, onPointerDown };
}

/**
 * Neighbour visibility during a gesture. Owned by the hook on the DOM (never
 * rendered by React), so it flips in the same frame as the first transform
 * write and costs no re-render.
 */
function setDragging(element: HTMLElement, dragging: boolean): void {
  if (dragging) {
    element.setAttribute("data-swipe-active", "true");
  } else {
    element.removeAttribute("data-swipe-active");
  }
}

/** Aligns the neighbours with the visible band of the vertical scroller. */
function placeNeighbours(element: HTMLElement): void {
  const parent = element.parentElement;
  element.style.setProperty("--vela-swipe-top", `${parent?.scrollTop ?? 0}px`);
  element.style.setProperty("--vela-swipe-height", `${parent?.clientHeight ?? 0}px`);
}

/** Two looping sections share one neighbour: put it where the finger reveals. */
function placeSharedNeighbour(element: HTMLElement, offsetPx: number): void {
  const shared = element.querySelector<HTMLElement>("[data-swipe-both-sides]");
  if (shared !== null && offsetPx !== 0) {
    shared.setAttribute("data-swipe-side", offsetPx > 0 ? "previous" : "next");
  }
}
