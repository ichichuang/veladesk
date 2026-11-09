"use client";

import Lenis from "lenis";
import type { LenisOptions } from "lenis";
import { useEffect } from "react";
import type { RefObject } from "react";

import { useVdReducedMotion } from "./reduced-motion";

/**
 * Lenis smooth scrolling for ONE independent scroll container (P1,
 * motion-spec-p1 §0/Lenis): the Settings content pane and the long lists
 * (launcher results, icon picker, folder overlay) — never the fixed app
 * frame, never the section stack. The element keeps its NATIVE scrolling
 * (`data-vd-scroll` still owns the overflow and the scrollbar styling);
 * Lenis only interpolates wheel/touch input on top of it, so keyboard
 * scrolling, focus jumps and programmatic scrollTop writes keep working.
 *
 * Reduced motion: no instance at all — native scrolling, exactly as
 * before. A preference flip mid-session re-runs the effect and tears the
 * instance down (or brings it back) without remounting the surface.
 */

/**
 * Whether Lenis can run here at all: it reaches for `matchMedia` in its
 * constructor. Every supported browser has it; jsdom (the test DOM)
 * deliberately does not, and ancient embedders may not — both degrade to
 * plain native scrolling, which is exactly what the surface is without
 * this hook.
 */
function lenisSupported(): boolean {
  return typeof window.matchMedia === "function";
}

export function useVdSmoothScroll(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  const reducedMotion = useVdReducedMotion();
  useEffect(() => {
    if (!enabled || reducedMotion || !lenisSupported()) {
      return;
    }
    const wrapper = ref.current;
    if (wrapper === null) {
      return;
    }
    // Lenis scrolls a wrapper/content pair; VdScrollArea hosts its content
    // as direct children, so the first child is the content element.
    const content = wrapper.firstElementChild;
    if (!(content instanceof HTMLElement)) {
      return;
    }
    const options: LenisOptions = {
      wrapper,
      content,
      eventsTarget: wrapper,
      autoRaf: true,
      // Wheel smoothing only: touch keeps the OS gesture (syncTouch off)
      // so pull-to-refresh-ish interactions stay native.
      smoothWheel: true,
      // Nested scrolling inside these panes (an inner listbox popup) is
      // the browser's own — Lenis must not fight it.
      allowNestedScroll: true,
    };
    const lenis = new Lenis(options);
    return () => {
      lenis.destroy();
    };
  }, [enabled, reducedMotion, ref]);
}
