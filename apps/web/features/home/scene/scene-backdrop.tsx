"use client";

import { useRef } from "react";

import { useVdAmbientDrift } from "@components/vd/ambient-drift";
import { VD_MOTION_AMBIENT } from "@components/vd/motion-tokens";
import type { EffectiveWallpaper } from "@veladesk/domain";

import { WorkspaceWallpaperLayers } from "../desktop-wallpaper";
import { DawnHorizon } from "./dawn-horizon";
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
   * Either way the opening plays only over a PRESET wallpaper and never
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
 * so a desktop↔mobile swap never replays it). Behind the rail,
 * workspace and dock; pointer-transparent, clipped. GSAP owns the ambient
 * drift (one yoyo on a real node) and — on by default over preset
 * scenes — the Dawn opening (use-dawn-intro.ts); reduced motion renders a
 * static backdrop.
 */
export function SceneBackdrop({
  wallpaper,
  assetUrl,
  dawnIntroEnabled = true,
  wallpaperClassName,
}: SceneBackdropProps) {
  // Ambient wallpaper drift (022): one GSAP-owned yoyo on a real node.
  // Pure decoration behind everything; reduced motion renders a static
  // backdrop.
  const desktopAmbientRef = useRef<HTMLDivElement | null>(null);
  useVdAmbientDrift(desktopAmbientRef, { durationSeconds: VD_MOTION_AMBIENT.drift });

  // The Dawn opening (P1, motion-spec §2): the horizon band rises over
  // the PRESET scene while the brightness veil recedes. Custom image
  // wallpapers render no horizon and never play the opening — a photo is
  // its own scene. Not gated by helmMotion.
  const sceneRootRef = useRef<HTMLDivElement | null>(null);
  const horizonBandRef = useRef<HTMLDivElement | null>(null);
  const dawnVeilRef = useRef<HTMLDivElement | null>(null);
  const presetScene = wallpaper.config.kind === "preset";
  useDawnIntro({
    enabled: dawnIntroEnabled && presetScene,
    scope: sceneRootRef,
    band: horizonBandRef,
    veil: dawnVeilRef,
  });

  return (
    <>
      <div className="vela-desktop__scene" ref={sceneRootRef}>
        {/* The full-desktop background layers (023-C): behind the rail,
            workspace and dock; pointer-transparent, clipped, at most two
            prepared surfaces with a restrained accepted-generation
            crossfade. The ambient drift stays its own decorative layer
            above it. */}
        <WorkspaceWallpaperLayers
          wallpaper={wallpaper}
          assetUrl={assetUrl}
          {...(wallpaperClassName === undefined ? {} : { className: wallpaperClassName })}
        />
        {presetScene ? <DawnHorizon bandRef={horizonBandRef} /> : null}
        <div className="vela-desktop__ambient" aria-hidden="true" ref={desktopAmbientRef} />
      </div>
      {/* The Dawn opening's brightness veil (spec §2: 整张画面的亮度遮罩):
          a sibling ABOVE the chrome bands, painted at opacity 0 unless the
          timeline drives it; it never takes pointers. */}
      <div className="vela-dawn-veil" aria-hidden="true" ref={dawnVeilRef} />
    </>
  );
}
