"use client";

import { useEffect, useState } from "react";

/**
 * The shared reduced-motion bridge (task 022): the ONE source of the
 * `prefers-reduced-motion: reduce` preference for GSAP-owned surfaces.
 *
 * When the preference is on, animation call-sites settle valid product
 * state immediately (the state itself never waits), skip starting tweens,
 * and a preference change mid-transition simply stops the interpolation —
 * focus and DOM ownership are untouched, so nothing is lost or restored.
 */

const QUERY = "(prefers-reduced-motion: reduce)";

/** SSR-safe direct read (also usable outside React). */
export function vdPrefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(QUERY).matches === true
    );
  } catch {
    return false;
  }
}

/**
 * Live hook: client components that conditionally animate read this; the
 * listener keeps an open surface honest when the OS preference flips while
 * a transition is in flight (the tween owner re-evaluates on re-render).
 */
export function useVdReducedMotion(): boolean {
  const [reduced, setReduced] = useState(vdPrefersReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      setReduced(event.matches);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
