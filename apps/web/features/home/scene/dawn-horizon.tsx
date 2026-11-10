"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import { gsap } from "@components/vd/gsap";
import { VD_MOTION_AMBIENT, VD_MOTION_EASES } from "@components/vd/motion-tokens";
import { useVdReducedMotion } from "@components/vd/reduced-motion";

/*
 * The chart graticule with a whisper of spherical perspective (Helm first
 * picture): meridians bow outward from the zenith meridian, parallels smile
 * toward the poles — a nautical chart painted on a very large sphere, not
 * graph paper. Static geometry in a 1600×1000 viewBox; `none` stretching +
 * non-scaling strokes keep the hairlines 1px at any aspect.
 */
const CHART_MERIDIANS = [-300, -150, -50, 50, 150, 300, 500, 750, 1100]
  .map((x) => {
    const bulge = (x - 800) * 0.22;
    return `M ${x} 0 Q ${x + bulge} 500 ${x} 1000`;
  })
  .join(" ");
const CHART_PARALLELS = [170, 330, 490, 650, 830]
  .map((y) => `M -300 ${y} Q 800 ${y + (y - 500) * 0.2} 1900 ${y}`)
  .join(" ");

/**
 * The Dawn horizon (P1, motion-spec-p1 §2 visual layer + direction A): the
 * persistent scene identity over presets and custom wallpapers — the dawn.1→dawn.3 gradient band at
 * the lower third, its hairline waterline and the chart graticule across
 * the whole ground. Custom photos keep the static light band; only preset
 * scenes run the opening animation.
 *
 * At rest the glow BREATHES (GSAP yoyo, the `breathe` ambient token): the
 * dawn slowly swells and settles — the scene alive, never a static
 * gradient. Reduced motion renders it static.
 *
 * Node ownership: `bandRef` points at the scalable band wrapper (GSAP
 * raises scaleY 0→1 from the waterline; `data-motion-owner="gsap"`), the
 * burst child is the bright overlay only the intro timeline ever lights,
 * and the glow child is the breathing loop's node (a different element, so
 * the intro and the breath never fight). Everything is aria-hidden
 * decoration that never takes pointers.
 */
export function DawnHorizon({
  bandRef,
}: {
  /** The scalable band wrapper the Dawn opening timeline animates. */
  readonly bandRef: RefObject<HTMLDivElement | null>;
}) {
  const reducedMotion = useVdReducedMotion();
  const glowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const glow = glowRef.current;
    if (glow === null) {
      return;
    }
    if (reducedMotion) {
      gsap.killTweensOf(glow);
      gsap.set(glow, { clearProps: "opacity,scale" });
      return;
    }
    const tween = gsap.fromTo(
      glow,
      { opacity: 0.78, scaleY: 1 },
      {
        opacity: 1,
        scaleY: 1.05,
        transformOrigin: "50% 100%",
        duration: VD_MOTION_AMBIENT.breathe,
        ease: VD_MOTION_EASES.drift,
        repeat: -1,
        yoyo: true,
      },
    );
    return () => {
      tween.kill();
    };
  }, [reducedMotion]);

  return (
    <div className="vela-dawn-horizon" aria-hidden="true">
      <svg
        className="vela-dawn-horizon__chart"
        viewBox="0 0 1600 1000"
        preserveAspectRatio="none"
        focusable="false"
      >
        <path className="vela-dawn-horizon__chart-lines" d={CHART_MERIDIANS} />
        <path className="vela-dawn-horizon__chart-lines" d={CHART_PARALLELS} />
      </svg>
      <div
        className="vela-dawn-horizon__band"
        ref={bandRef}
        data-motion-owner="gsap"
      >
        <div className="vela-dawn-horizon__glow" ref={glowRef} />
        <div className="vela-dawn-horizon__burst" />
      </div>
    </div>
  );
}
