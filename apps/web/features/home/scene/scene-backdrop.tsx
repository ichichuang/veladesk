"use client";

import { useRef } from "react";

import { useVdAmbientDrift } from "@components/vd/ambient-drift";
import type { EffectiveWallpaper } from "@veladesk/domain";

import { WorkspaceWallpaperLayers } from "../desktop-wallpaper";
import { useDawnIntro } from "./use-dawn-intro";
import "../home-shell.css";

interface SceneBackdropProps {
  /** The effective wallpaper of the VISIBLE section (scene-resolved). */
  readonly wallpaper: EffectiveWallpaper;
  /** The resolved object URL for an asset config (null while cold). */
  readonly assetUrl: string | null;
}

/**
 * The desktop scene BACKDROP (P1-ENG-1): the full-desktop background
 * layers and the ambient drift node, extracted verbatim from the former
 * desktop-shell render. Behind the rail, workspace and dock;
 * pointer-transparent, clipped. GSAP owns the ambient drift (one yoyo on a
 * real node — the CSS ::before keyframes are gone); reduced motion
 * renders a static backdrop.
 */
export function SceneBackdrop({ wallpaper, assetUrl }: SceneBackdropProps) {
  // Ambient wallpaper drift (022): one GSAP-owned yoyo on a real node.
  // Pure decoration behind everything; reduced motion renders a static
  // backdrop.
  const desktopAmbientRef = useRef<HTMLDivElement | null>(null);
  useVdAmbientDrift(desktopAmbientRef, { durationSeconds: 30 });

  // Dawn opening (motion-spec-p1 §2): reserved mount point, stub only.
  useDawnIntro();

  return (
    <>
      {/* The full-desktop background layers (023-C): behind the rail,
          workspace and dock; pointer-transparent, clipped, at most two
          prepared surfaces with a restrained accepted-generation crossfade.
          The ambient drift stays its own decorative layer above it. */}
      <WorkspaceWallpaperLayers wallpaper={wallpaper} assetUrl={assetUrl} />
      <div className="vela-desktop__ambient" aria-hidden="true" ref={desktopAmbientRef} />
    </>
  );
}
