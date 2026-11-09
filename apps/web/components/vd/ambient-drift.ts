"use client";

import { useEffect } from "react";
import type { RefObject } from "react";

import { gsap } from "./gsap";
import { VD_MOTION_AMBIENT, VD_MOTION_EASES } from "./motion-tokens";
import { useVdReducedMotion } from "./reduced-motion";

/**
 * useVdAmbientDrift (task 022): the slow ambient wallpaper drift, GSAP-
 * owned. One infinite yoyo tween on a REAL element (the old CSS
 * `vela-ambient` keyframes rode pseudo-elements and stylesheet
 * animations). The `drift` ease token (`sine.inOut`) is deliberate here — a
 * symmetric loop cannot pause at the extremes without it; ambient loops
 * are the only surfaces that do not use the shared ease-out token. The tween lives on GSAP's rAF
 * ticker (it stops advancing when the tab is hidden), dies with the
 * element, and reduced motion renders a static backdrop.
 */
export function useVdAmbientDrift(
  targetRef: RefObject<HTMLElement | null>,
  options: { readonly durationSeconds?: number } = {},
): void {
  const reducedMotion = useVdReducedMotion();
  const duration = options.durationSeconds ?? VD_MOTION_AMBIENT.drift;

  useEffect(() => {
    const element = targetRef.current;
    if (element === null) {
      return;
    }
    if (reducedMotion) {
      gsap.killTweensOf(element);
      gsap.set(element, { xPercent: 0, yPercent: 0, scale: 1, opacity: 1 });
      return;
    }
    const tween = gsap.fromTo(
      element,
      { xPercent: -1.5, yPercent: -1, scale: 1, opacity: 0.85 },
      {
        xPercent: 1.5,
        yPercent: 1.2,
        scale: 1.06,
        opacity: 1,
        duration,
        ease: VD_MOTION_EASES.drift,
        repeat: -1,
        yoyo: true,
      },
    );
    return () => {
      tween.kill();
    };
  }, [targetRef, reducedMotion, duration]);
}
