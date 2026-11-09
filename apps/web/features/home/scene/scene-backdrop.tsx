"use client";

import { useRef } from "react";

import { useVdAmbientDrift } from "@components/vd/ambient-drift";
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
   * The Dawn opening gate (P1): the `motion.experiments.helmMotion`
   * switch, resolved by the shell from the persisted preferences. Absent
   * or false renders the static scene — no timeline, no veil.
   */
  readonly dawnIntroEnabled?: boolean | undefined;
}

/**
 * The desktop scene BACKDROP (P1-ENG-1): the full-desktop background
 * layers, the Dawn horizon and the ambient drift node. Behind the rail,
 * workspace and dock; pointer-transparent, clipped. GSAP owns the ambient
 * drift (one yoyo on a real node) and — behind the helmMotion switch —
 * the Dawn opening (use-dawn-intro.ts); reduced motion renders a static
 * backdrop.
 */
export function SceneBackdrop({ wallpaper, assetUrl, dawnIntroEnabled = false }: SceneBackdropProps) {
  // Ambient wallpaper drift (022): one GSAP-owned yoyo on a real node.
  // Pure decoration behind everything; reduced motion renders a static
  // backdrop.
  const desktopAmbientRef = useRef<HTMLDivElement | null>(null);
  useVdAmbientDrift(desktopAmbientRef, { durationSeconds: 30 });

  // The Dawn opening (P1, motion-spec §2): the horizon band rises over
  // the PRESET scene while the brightness veil recedes. Custom image
  // wallpapers render no horizon at all — a photo is its own scene.
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
        <WorkspaceWallpaperLayers wallpaper={wallpaper} assetUrl={assetUrl} />
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
