"use client";

import type { RefObject } from "react";

/**
 * The Dawn horizon (P1, motion-spec-p1 §2 visual layer): the persistent
 * scene identity on PRESET wallpapers — the dawn.1→dawn.3 gradient band at
 * the lower third, its hairline waterline and a whisper of chart graticule
 * across the ground. A custom (asset) wallpaper never renders it: the
 * photo IS the scene and the renderer applies no preset tint there.
 *
 * Node ownership for the Dawn opening: `bandRef` points at the scalable
 * band wrapper (GSAP raises scaleY 0→1 from the waterline;
 * `data-motion-owner="gsap"`), and the burst child is the bright overlay
 * only the timeline ever lights. Everything is aria-hidden decoration
 * that never takes pointers.
 */
export function DawnHorizon({
  bandRef,
}: {
  /** The scalable band wrapper the Dawn opening timeline animates. */
  readonly bandRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="vela-dawn-horizon" aria-hidden="true">
      <div className="vela-dawn-horizon__graticule" />
      <div
        className="vela-dawn-horizon__band"
        ref={bandRef}
        data-motion-owner="gsap"
      >
        <div className="vela-dawn-horizon__glow" />
        <div className="vela-dawn-horizon__burst" />
      </div>
    </div>
  );
}
