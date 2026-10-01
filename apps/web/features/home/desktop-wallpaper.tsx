"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { gsap } from "@components/vd/gsap";
import { VD_MOTION_EASE } from "@components/vd/motion-tokens";
import { useVdReducedMotion } from "@components/vd/reduced-motion";
import type { EffectiveWallpaper, WallpaperConfig } from "@veladesk/domain";

import "./home-shell.css";

/**
 * The shared wallpaper renderer (task 023-C): ONE definition used by the
 * desktop background layer AND the Settings thumbnails, so a choice always
 * shows the same background it will paint. Presets render the same blob
 * geometry the desktop CSS defines (`--vd-wall-*`), scoped to the surface
 * element; custom images render the resolved asset URL with cover/contain
 * semantics — cover = centered fill without distortion, contain = centered,
 * no repetition, the shared neutral canvas color in uncovered areas. No
 * preset ambient drift, tint or dark veil is applied to custom photos.
 */

/**
 * What the Settings background editor streams to the shell for a live
 * desktop preview (023-C.2). Scope-keyed so the desktop's resolver can
 * substitute exactly one layer; `null` config = explicit removal, and
 * `explicitlyInherits` marks a section's Follow-workspace choice.
 */
export interface BackgroundPreview {
  readonly scope: "workspace" | string;
  readonly config: import("@veladesk/domain").WallpaperConfig | null;
  readonly explicitlyInherits: boolean;
  /** The not-yet-staged image's content id, when the draft previews one. */
  readonly pendingAssetId?: string | undefined;
  /** Its object URL (owned by the settings session). */
  readonly previewUrl?: string | undefined;
}

/** Serializes a config to its stable identity (crossfade / same-node key). */
export function wallpaperConfigKey(config: WallpaperConfig): string {
  return config.kind === "preset"
    ? `preset:${config.presetId}`
    : `asset:${config.assetId}:${config.fit}`;
}

export function WallpaperSurface({
  wallpaper,
  assetUrl,
  className = "",
}: {
  /** The effective wallpaper definition. */
  readonly wallpaper: EffectiveWallpaper;
  /** The resolved object URL for an asset config (null while cold). */
  readonly assetUrl: string | null;
  readonly className?: string;
}) {
  const { config } = wallpaper;
  if (config.kind === "preset") {
    return (
      <div
        className={`vela-wallpaper-surface vela-wallpaper-surface--preset ${className}`.trim()}
        data-wallpaper-preset={config.presetId}
        aria-hidden="true"
      />
    );
  }
  return (
    <div
      className={`vela-wallpaper-surface vela-wallpaper-surface--image ${className}`.trim()}
      data-wallpaper-fit={config.fit}
      aria-hidden="true"
    >
      {assetUrl !== null ? (
        <img
          src={assetUrl}
          alt=""
          draggable={false}
          className="vela-wallpaper-surface__image"
          data-wallpaper-image={config.assetId}
        />
      ) : (
        // Cold/missing asset: the neutral canvas shows (never another
        // section's default); a resolved URL reveals with the fade-in.
        <div
          className="vela-wallpaper-surface__pending"
          data-wallpaper-image={config.assetId}
        />
      )}
    </div>
  );
}

/**
 * Resolves an asset-backed wallpaper to a displayable object URL through
 * the existing asset runtime (local-first). Results are cached per asset
 * id (module-scoped, bounded by the workspace's wallpaper count; object
 * URLs live for the tab session and are never revoked under a live
 * surface). A LATE result applies only when its request identity still
 * matches; an unavailable asset keeps `null` — the neutral canvas —
 * without touching section state, and a later availability can fill it in.
 */
const assetUrlCache = new Map<string, string>();

export function useWallpaperAssetUrl(
  assetId: string | null,
  loadAsset: ((id: string) => Promise<{ ok: boolean; url: string | null }>) | null,
): string | null {
  // Synchronous paths (null input, cache hit) are DERIVED during render —
  // never a setState-in-effect. Only an async load result lives in state,
  // keyed by the asset it belongs to so a late result can never leak onto
  // another asset's surface.
  const [loaded, setLoaded] = useState<{ readonly id: string; readonly url: string } | null>(null);
  const requestRef = useRef(0);
  const cached = assetId === null ? undefined : assetUrlCache.get(assetId);
  const url =
    assetId === null ? null : (cached ?? (loaded !== null && loaded.id === assetId ? loaded.url : null));
  useLayoutEffect(() => {
    if (assetId === null || loadAsset === null) {
      return;
    }
    if (assetUrlCache.has(assetId)) {
      return;
    }
    const request = requestRef.current + 1;
    requestRef.current = request;
    let cancelled = false;
    void loadAsset(assetId).then((result) => {
      if (cancelled || request !== requestRef.current || !result.ok || result.url === null) {
        return;
      }
      assetUrlCache.set(assetId, result.url);
      setLoaded({ id: assetId, url: result.url });
    });
    return () => {
      cancelled = true;
    };
  }, [assetId, loadAsset]);
  return url;
}

interface WallpaperSlot {
  readonly key: string;
  readonly wallpaper: EffectiveWallpaper;
  readonly assetUrl: string | null;
}

/**
 * The full-surface background layers (023-C.4; shared desktop/mobile since
 * task 026 §45): at most TWO prepared surfaces — the settled one underneath
 * and, when the EFFECTIVE wallpaper changes with the accepted navigation,
 * the incoming one crossfading over it on one short GSAP tween that retires
 * the settled node on completion. An unchanged config keeps the SAME nodes
 * with no transition at all. Layers are pointer-transparent, clipped to the
 * caller's root (the `className` positions/clips them), and live behind
 * the chrome — never inside a content scroller, never per app item, and
 * never reset from a page-settle callback (the 022-R2 hide-before-rest
 * ordering is untouched).
 */
export function WorkspaceWallpaperLayers({
  wallpaper,
  assetUrl,
  className = "vela-desktop__wallpaper",
}: {
  readonly wallpaper: EffectiveWallpaper;
  readonly assetUrl: string | null;
  /** The positioning/clipping root class — desktop or mobile shell. */
  readonly className?: string;
}) {
  const reducedMotion = useVdReducedMotion();
  const key = `${wallpaperConfigKey(wallpaper.config)}|${assetUrl ?? ""}`;
  const [settled, setSettled] = useState<WallpaperSlot>({ key, wallpaper, assetUrl });
  const [previous, setPrevious] = useState<WallpaperSlot | null>(null);
  const [armedKey, setArmedKey] = useState(key);
  const incomingRef = useRef<HTMLDivElement | null>(null);

  // Render-phase arm (derived-state pattern): a changed background identity
  // promotes the incoming slot to settled BEFORE commit and — unless motion
  // is reduced — keeps the old slot as the underneath layer. No setState
  // inside an effect; the crossfade tween below runs once the two nodes are
  // actually committed.
  if (key !== armedKey) {
    setArmedKey(key);
    if (!reducedMotion) {
      setPrevious(settled);
    }
    setSettled({ key, wallpaper, assetUrl });
  }

  useLayoutEffect(() => {
    if (previous === null) {
      // Nothing crossfading: under reduced motion a fresh incoming node is
      // settled instantly (and never left at a tween's start opacity).
      if (reducedMotion) {
        gsap.set(incomingRef.current, { opacity: 1 });
      }
      return;
    }
    gsap.fromTo(
      incomingRef.current,
      { opacity: 0 },
      {
        opacity: 1,
        duration: reducedMotion ? 0 : 0.24,
        ease: VD_MOTION_EASE,
        overwrite: "auto",
        onComplete: () => {
          setPrevious(null); // the old node is retired only once covered
        },
      },
    );
  }, [key, reducedMotion, previous !== null]);

  return (
    <div className={className} data-wallpaper-provenance={wallpaper.provenance}>
      {previous !== null ? (
        <WallpaperSurface
          wallpaper={previous.wallpaper}
          assetUrl={previous.assetUrl}
          className="vela-desktop__wallpaper-settled"
        />
      ) : null}
      <div ref={incomingRef} className="vela-desktop__wallpaper-incoming">
        <WallpaperSurface wallpaper={wallpaper} assetUrl={assetUrl} />
      </div>
    </div>
  );
}
