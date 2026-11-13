"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { cn } from "@components/ui/cn";
import { gsap } from "./gsap";
import { VD_MOTION_EASE, vdMotionDuration } from "./motion-tokens";
import { useVdReducedMotion } from "./reduced-motion";

/**
 * VdTabCrossfade (t171 motion spec): the content-region swap inside a
 * fixed-size editing window. The outgoing panel holds still as an inert
 * overlay while the incoming panel crossfades in, translating 12px in the
 * switch direction — the window itself NEVER resizes, so nothing below
 * the fold jumps. List items inside the incoming panel (the first 6 of
 * `staggerSelector`) stagger in 20ms apart.
 *
 * Reduced motion: opacity only, 120ms — no translation, no stagger.
 */

/** Items that stagger per the spec: first six, 20ms apart. */
const STAGGER_ITEMS = 6;
const STAGGER_GAP = 0.02;
/** Reduced motion: opacity only, 120ms (t171 spec — no translation). */
const REDUCED_FADE = 0.12;

interface VdTabCrossfadeProps {
  /** Changes when the tab/step switches; anything else re-renders in place. */
  readonly tabKey: string;
  /** Travel direction of the switch: +1 forward, -1 back, 0 unknown. */
  readonly direction: 1 | -1 | 0;
  /** Selector for the incoming panel's list items to stagger (first 6). */
  readonly staggerSelector?: string | undefined;
  readonly className?: string;
  readonly children: ReactNode;
}

interface LeavingPanel {
  readonly key: string;
  readonly children: ReactNode;
}

export function VdTabCrossfade({
  tabKey,
  direction,
  staggerSelector,
  className,
  children,
}: VdTabCrossfadeProps) {
  const reducedMotion = useVdReducedMotion();
  const liveRef = useRef<HTMLDivElement | null>(null);
  const leavingRef = useRef<HTMLDivElement | null>(null);
  const [leaving, setLeaving] = useState<LeavingPanel | null>(null);
  const timerRef = useRef<number | null>(null);
  // The panel as of the PREVIOUS render — the snapshot the leaving layer
  // shows while the incoming one fades in.
  const previousRef = useRef<LeavingPanel>({ key: tabKey, children });

  useLayoutEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { key: tabKey, children };
    if (previous.key === tabKey) {
      return;
    }
    const duration = reducedMotion ? REDUCED_FADE : vdMotionDuration("editorTab");
    const live = liveRef.current;
    if (live !== null) {
      if (reducedMotion) {
        gsap.fromTo(live, { opacity: 0 }, { opacity: 1, duration, ease: "none", overwrite: "auto" });
      } else {
        gsap.fromTo(
          live,
          { opacity: 0, x: 12 * direction },
          { opacity: 1, x: 0, duration, ease: VD_MOTION_EASE, overwrite: "auto" }
        );
        if (staggerSelector !== undefined) {
          const items = live.querySelectorAll(staggerSelector);
          gsap.fromTo(
            Array.from(items).slice(0, STAGGER_ITEMS),
            { opacity: 0, y: 8 },
            { opacity: 1, y: 0, duration, stagger: STAGGER_GAP, ease: VD_MOTION_EASE, overwrite: "auto" }
          );
        }
      }
    }
    // The outgoing snapshot rides above, inert, fading out against the
    // incoming panel's slide.
    setLeaving(previous);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setLeaving(null);
    }, duration * 1000 + 40);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // The transition fires on tab switches only; children identity churn
    // (draft edits inside a panel) must not retrigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabKey, reducedMotion]);

  // The leaving layer fades out once it is mounted.
  useLayoutEffect(() => {
    const element = leavingRef.current;
    if (element === null) {
      return;
    }
    const duration = reducedMotion ? REDUCED_FADE : vdMotionDuration("editorTab");
    gsap.fromTo(
      element,
      { opacity: 1, x: 0 },
      reducedMotion
        ? { opacity: 0, duration, ease: "none" }
        : { opacity: 0, x: -12 * direction, duration, ease: VD_MOTION_EASE }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col overflow-hidden", className)}>
      <div key={tabKey} ref={liveRef} className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
      {leaving !== null ? (
        <div
          ref={leavingRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex flex-col"
        >
          {leaving.children}
        </div>
      ) : null}
    </div>
  );
}
