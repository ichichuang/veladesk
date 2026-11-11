"use client";

import Lenis from "lenis";
import type { LenisOptions } from "lenis";
import { useEffect, useRef } from "react";
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
  const managed = useRef<{ wrapper: HTMLElement; dispose: () => void } | null>(null);
  useEffect(() => {
    const wrapper = ref.current;
    if (managed.current?.wrapper === wrapper && enabled && !reducedMotion) return;
    managed.current?.dispose();
    managed.current = null;
    if (!enabled || reducedMotion || !lenisSupported()) {
      return;
    }
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
      lerp: Number.parseFloat(getComputedStyle(wrapper).getPropertyValue("--vd-scrollbar-lerp")) || 0.12,
      orientation: wrapper.dataset.vdScroll === "x" ? "horizontal" : "vertical",
      naiveDimensions: true,
      prevent: (node) => node.matches("input, textarea, select, [contenteditable=true]") || wrapper.dataset.scrollLocked === "true" || document.querySelector("[data-dragging=true]") !== null,
      // Wheel smoothing only: touch keeps the OS gesture (syncTouch off)
      // so pull-to-refresh-ish interactions stay native.
      smoothWheel: true,
      duration: (Number.parseFloat(getComputedStyle(wrapper).getPropertyValue("--vd-scrollbar-settle-ms")) || 500) / 1000,
      easing: (t) => t === 1 ? 1 : 1 - Math.pow(1 - t, 4),
      // Nested scrolling inside these panes (an inner listbox popup) is
      // the browser's own — Lenis must not fight it.
      allowNestedScroll: true,
    };
    const lenis = new Lenis(options);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.closest("input, textarea, select, button, [contenteditable=true], [role=option]")) return;
      if (target.closest("[data-vd-scroll]") !== wrapper || wrapper.dataset.scrollLocked === "true") return;
      const horizontal = options.orientation === "horizontal";
      const extent = horizontal ? wrapper.clientWidth : wrapper.clientHeight;
      const current = lenis.targetScroll;
      const delta: Record<string, number> = horizontal
        ? { ArrowRight: 40, ArrowLeft: -40 }
        : { ArrowDown: 40, ArrowUp: -40, PageDown: extent * 0.85, PageUp: -extent * 0.85, " ": extent * (event.shiftKey ? -0.85 : 0.85) };
      const destination = event.key === "Home" ? 0 : event.key === "End" ? lenis.limit : delta[event.key] === undefined ? null : current + delta[event.key]!;
      if (destination === null || lenis.limit === 0) return;
      event.preventDefault();
      lenis.scrollTo(destination);
    };
    const onPointerDown = () => { lenis.stop(); lenis.start(); };
    wrapper.addEventListener("pointerdown", onPointerDown, { capture: true });
    wrapper.addEventListener("keydown", onKeyDown);
    managed.current = { wrapper, dispose: () => {
      wrapper.removeEventListener("pointerdown", onPointerDown, { capture: true });
      wrapper.removeEventListener("keydown", onKeyDown);
      lenis.destroy();
    } };
  });
  useEffect(() => () => {
    managed.current?.dispose();
    managed.current = null;
  }, []);
}
