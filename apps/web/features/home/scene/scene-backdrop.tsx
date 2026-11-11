"use client";

import { useRef } from "react";

import { useVdAmbientDrift } from "@components/vd/ambient-drift";
import { VD_MOTION_AMBIENT } from "@components/vd/motion-tokens";
import type { EffectiveWallpaper } from "@veladesk/domain";

import { WorkspaceWallpaperLayers } from "../desktop-wallpaper";
import { DawnHorizon } from "./dawn-horizon";
import { SceneStars } from "./scene-stars";
import { useDawnIntro } from "./use-dawn-intro";
import "../home-shell.css";

interface SceneBackdropProps {
  /** The effective wallpaper of the VISIBLE section (scene-resolved). */
  readonly wallpaper: EffectiveWallpaper;
  /** The resolved object URL for an asset config (null while cold). */
  readonly assetUrl: string | null;
  /**
   * The Dawn opening gate (P1). Dawn is ON BY DEFAULT — it is not behind
   * the `motion.experiments.helmMotion` switch (that gates only Orbits/
   * Wake). Absent means true; pass false only to force the static scene.
   * Either way the opening plays only over the chart scene and never
   * under reduced motion.
   */
  readonly dawnIntroEnabled?: boolean | undefined;
  /**
   * The wallpaper layers' positioning/clipping class (desktop default;
   * the mobile shell passes its own root-relative class).
   */
  readonly wallpaperClassName?: string | undefined;
}

/**
 * The scene BACKDROP (P1-ENG-1): the full-frame background layers, the
 * Dawn horizon and the ambient drift node — shared by the desktop and the
 * mobile shell (the Dawn opening's once-per-tab memory is module-scoped,
 * so a desktop↔mobile swap never replays it). Behind the workspace and
 * dock; pointer-transparent, clipped. GSAP owns the ambient drift (one
 * yoyo on a real node) and — on by default over the chart scene — the
 * Dawn opening (use-dawn-intro.ts); reduced motion renders a static
 * backdrop.
 *
 * t61 scene tiers: the full Dawn Chart decoration set (horizon band,
 * waterline, graticule, stars, ambient washes, grain) belongs to the
 * CHART preset alone — it IS the scene. The four color presets and custom
 * photos are backgrounds the user chose: they keep only the soft depth
 * vignette (and the readability veil for bright photos), so a choice is
 * actually VISIBLE and the Settings thumbnail tells the truth.
 */
export function SceneBackdrop({
  wallpaper,
  assetUrl,
  dawnIntroEnabled = true,
  wallpaperClassName,
}: SceneBackdropProps) {
  // The full chart decoration set renders only for the chart preset.
  const chartScene = wallpaper.config.kind === "preset" && wallpaper.config.presetId === "chart";

  // Ambient wallpaper drift (022): one GSAP-owned yoyo on a real node.
  // Pure decoration behind everything; reduced motion renders a static
  // backdrop. Chart scene only (t61).
  const desktopAmbientRef = useRef<HTMLDivElement | null>(null);
  useVdAmbientDrift(desktopAmbientRef, { durationSeconds: VD_MOTION_AMBIENT.drift });

  // The Dawn opening (P1, motion-spec §2): the horizon band rises over
  // the chart scene while the brightness veil recedes. Not gated by
  // helmMotion.
  const sceneRootRef = useRef<HTMLDivElement | null>(null);
  const horizonBandRef = useRef<HTMLDivElement | null>(null);
  const dawnVeilRef = useRef<HTMLDivElement | null>(null);
  useDawnIntro({
    enabled: dawnIntroEnabled && chartScene,
    scope: sceneRootRef,
    band: horizonBandRef,
    veil: dawnVeilRef,
  });

  return (
    <>
      <div
        className="vela-desktop__scene"
        data-scene={chartScene ? "chart" : "plain"}
        ref={sceneRootRef}
      >
        {/* The full-desktop background layers (023-C): behind the
            workspace and dock; pointer-transparent, clipped, at most two
            prepared surfaces with a restrained accepted-generation
            crossfade. The ambient drift stays its own decorative layer
            above it. */}
        <WorkspaceWallpaperLayers
          wallpaper={wallpaper}
          assetUrl={assetUrl}
          {...(wallpaperClassName === undefined ? {} : { className: wallpaperClassName })}
        />
        {chartScene ? (
          <>
            {/* The night sky's stars: above the ground, below the horizon
                glow; hidden in light mode by the stylesheet. */}
            <SceneStars />
            <DawnHorizon bandRef={horizonBandRef} />
            <div className="vela-desktop__ambient" aria-hidden="true" ref={desktopAmbientRef} />
            {/* The film grain: a whisper of noise so the deep ground never
                reads as a flat gradient print. Colorless luminance noise —
                every tint stays in the tokens below it. */}
            <div className="vela-desktop__grain" aria-hidden="true" />
          </>
        ) : null}
      </div>
      {/* The Dawn opening's brightness veil (spec §2: 整张画面的亮度遮罩):
          a sibling ABOVE the chrome bands, painted at opacity 0 unless the
          timeline drives it; it never takes pointers. */}
      <div className="vela-dawn-veil" aria-hidden="true" ref={dawnVeilRef} />
    </>
  );
}
