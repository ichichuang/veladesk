"use client";

import { useEffect } from "react";
import type { RefObject } from "react";

import { gsap } from "./gsap";
import { useVdReducedMotion } from "./reduced-motion";

/**
 * useVdAmbientDrift (task 022): the slow ambient wallpaper drift, GSAP-
 * owned. One infinite yoyo tween on a REAL element (the old CSS
 * `vela-ambient` keyframes rode pseudo-elements and stylesheet
 * animations). `sine.inOut` is deliberate here — a symmetric loop cannot
 * pause at the extremes without it; this is the one product surface that
 * does not use the shared ease-out token. The tween lives on GSAP's rAF
 * ticker (it stops advancing when the tab is hidden), dies with the
 * element, and reduced motion renders a static backdrop.
 */
export function useVdAmbientDrift(
  targetRef: RefObject<HTMLElement | null>,
  options: { readonly durationSeconds?: number } = {},
): void {
  const reducedMotion = useVdReducedMotion();
  const duration = options.durationSeconds ?? 30;

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
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
      },
    );
    return () => {
      tween.kill();
    };
  }, [targetRef, reducedMotion, duration]);
}
