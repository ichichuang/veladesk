"use client";

import { useEffect, useRef } from "react";

import { gsap } from "@components/vd/gsap";
import { VD_MOTION_AMBIENT, VD_MOTION_EASES } from "@components/vd/motion-tokens";
import { useVdReducedMotion } from "@components/vd/reduced-motion";

/*
 * The night sky's dusting of stars (Helm first picture): deterministic
 * pseudo-random dots — same sky every mount, no hydration flicker, no
 * storage. Two interleaved families twinkle out of phase on slow sine
 * loops, so the sky breathes without ever drawing attention. Rendered
 * above the wallpaper and below the horizon; masked away toward the
 * waterline and hidden entirely in light mode (白昼海图 has no stars) by
 * the stylesheet.
 */
const STAR_SEED = 2271032;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Star {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly opacity: number;
  readonly family: 0 | 1;
}

const STARS: readonly Star[] = (() => {
  const random = mulberry32(STAR_SEED);
  return Array.from({ length: 170 }, () => ({
    cx: Math.round(random() * 1600 * 10) / 10,
    cy: Math.round(random() * 640 * 10) / 10,
    // Round 2: a slightly wider radius/opacity range — the sky reads as
    // depth (a few near stars, mostly far dust) instead of sparse dots.
    r: Math.round((0.5 + random() * 1.2) * 10) / 10,
    opacity: Math.round((0.42 + random() * 0.58) * 100) / 100,
    family: random() > 0.5 ? 1 : 0,
  }));
})();

/**
 * The star layer — pure decoration, aria-hidden, pointer-transparent. GSAP
 * owns the two twinkle yoyos (sine.inOut, the ambient drift ease); reduced
 * motion renders the static sky.
 */
export function SceneStars() {
  const reducedMotion = useVdReducedMotion();
  const familyARef = useRef<SVGGElement | null>(null);
  const familyBRef = useRef<SVGGElement | null>(null);

  useEffect(() => {
    if (reducedMotion) {
      for (const node of [familyARef.current, familyBRef.current]) {
        if (node !== null) {
          gsap.killTweensOf(node);
          gsap.set(node, { clearProps: "opacity" });
        }
      }
      return;
    }
    const tweens = [
      familyARef.current === null
        ? null
        : gsap.to(familyARef.current, {
            opacity: 0.45,
            duration: VD_MOTION_AMBIENT.breathe * 0.9,
            ease: VD_MOTION_EASES.drift,
            repeat: -1,
            yoyo: true,
          }),
      familyBRef.current === null
        ? null
        : gsap.to(familyBRef.current, {
            opacity: 1,
            duration: VD_MOTION_AMBIENT.breathe * 1.4,
            ease: VD_MOTION_EASES.drift,
            repeat: -1,
            yoyo: true,
          }),
    ];
    return () => {
      for (const tween of tweens) {
        tween?.kill();
      }
    };
  }, [reducedMotion]);

  return (
    <svg
      className="vela-desktop__stars"
      viewBox="0 0 1600 1000"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <g ref={familyARef} className="vela-desktop__stars-family">
        {STARS.filter((star) => star.family === 0).map((star) => (
          <circle key={`${star.cx}-${star.cy}`} cx={star.cx} cy={star.cy} r={star.r} opacity={star.opacity} />
        ))}
      </g>
      <g ref={familyBRef} className="vela-desktop__stars-family">
        {STARS.filter((star) => star.family === 1).map((star) => (
          <circle key={`${star.cx}-${star.cy}`} cx={star.cx} cy={star.cy} r={star.r} opacity={star.opacity} />
        ))}
      </g>
    </svg>
  );
}
