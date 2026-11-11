"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { gsap } from "@components/vd/gsap";
import { VD_MOTION_EASE, VD_MOTION_WALLPAPER } from "@components/vd/motion-tokens";
import { useVdReducedMotion } from "@components/vd/reduced-motion";
import { DEFAULT_WALLPAPER } from "@veladesk/domain";
import type { EffectiveWallpaper, WallpaperConfig } from "@veladesk/domain";

import { isWallpaperBright } from "./wallpaper-luminance";
import "./home-shell.css";

/**
 * The shared wallpaper renderer (task 023-C): ONE definition used by the
 * desktop background layer AND the Settings thumbnails, so a choice always
 * shows the same background it will paint. Presets render the same blob
 * geometry the desktop CSS defines (`--vd-wall-*`), scoped to the surface
 * element; custom images render the resolved asset URL with cover/contain
 * semantics — cover = centered fill without distortion, contain = centered,
 * no repetition, the shared neutral canvas color in uncovered areas. No
 * preset ambient drift or tint is applied to custom photos; an image that
 * measures TOO BRIGHT gets the ~6% bg.deep readability veil (P1).
 */

/** The release delay — one crossfade plus settle margin (see below). */
export const WALLPAPER_PREVIEW_RELEASE_DELAY_MS =
  VD_MOTION_WALLPAPER.crossfade * 1000 + 250;

/**
 * Delays the release of a never-saved wallpaper preview URL (UX-07,
 * building on UX-02's ordering rule): a Cancel/close must never yank a
 * blob URL out from under a surface that may still be painting it — the
 * settings panel's own thumbnail or an in-flight decode. The delay covers
 * the wallpaper crossfade token plus margin; the URL is session-scoped
 * either way.
 */
export function releaseWallpaperPreviewUrl(url: string): void {
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, WALLPAPER_PREVIEW_RELEASE_DELAY_MS);
}

/** Serializes a config to its stable identity (crossfade / same-node key). */
export function wallpaperConfigKey(config: WallpaperConfig): string {
  return config.kind === "preset"
    ? `preset:${config.presetId}`
    : `asset:${config.assetId}:${config.fit}`;
}

/**
 * Whether the image behind `assetUrl` measured too bright for unadapted
 * text (cached per URL — see wallpaper-luminance.ts). `false` until the
 * (once-per-image) measurement lands; a failure stays `false`.
 */
function useWallpaperVeil(assetUrl: string | null): boolean {
  const [measurement, setMeasurement] = useState<{ url: string; bright: boolean } | null>(null);
  useEffect(() => {
    if (assetUrl === null) {
      return;
    }
    let cancelled = false;
    void isWallpaperBright(assetUrl).then((value) => {
      if (!cancelled) {
        setMeasurement({ url: assetUrl, bright: value });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [assetUrl]);
  return measurement?.url === assetUrl && measurement.bright;
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
  const bright = useWallpaperVeil(config.kind === "asset" ? assetUrl : null);
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
      data-bright={bright ? "true" : undefined}
      aria-hidden="true"
    >
      {assetUrl !== null ? (
        // Local blob URLs must use a native image; Next optimization cannot fetch them.
        // eslint-disable-next-line @next/next/no-img-element
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

/**
 * Transfers a staged upload's preview object URL into the shared asset
 * cache (UX-02): after a successful Save the desktop keeps rendering the
 * EXACT URL it already shows — no revoke-under-a-live-surface, no
 * crossfade through a dead blob — and a cold boot (or another surface)
 * resolves the same asset id to the cached URL instead of re-fetching.
 * Content-addressed asset ids make the preview URL a faithful stand-in for
 * the staged bytes.
 */
export function retainWallpaperAssetUrl(assetId: string, url: string): void {
  if (!assetUrlCache.has(assetId)) {
    assetUrlCache.set(assetId, url);
  }
}

/**
 * Revokes a retired layer URL — but NEVER one the shared cache still hands
 * out (staged-asset URLs live for the tab session; only preview URLs the
 * settings session retired are the layer's to release, and only once the
 * crossfade has fully covered them).
 */
function releaseRetiredLayerUrl(url: string | null): void {
  if (url !== null && !Array.from(assetUrlCache.values()).includes(url)) {
    URL.revokeObjectURL(url);
  }
}

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
 * and, when the EFFECTIVE wallpaper changes with the accepted navigation
 * or a light/dark mode flip (P1), the incoming one crossfading over it on
 * one GSAP tween (VD_MOTION_WALLPAPER.crossfade) that retires the settled
 * node on completion. The fade starts only after BOTH images are decoded:
 * the settled one is already on screen, the incoming one awaits `decode()`
 * — reduced motion never fades, it cuts in the arming pass. An unchanged
 * config keeps the SAME nodes
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
  const initialWallpaper = wallpaper.config.kind === "asset" && assetUrl === null
    ? { config: DEFAULT_WALLPAPER, provenance: "default" as const } : wallpaper;
  const [settled, setSettled] = useState<WallpaperSlot>(() => ({
    key: `${wallpaperConfigKey(initialWallpaper.config)}|${assetUrl ?? ""}`,
    wallpaper: initialWallpaper, assetUrl,
  }));
  // Keep the visible image until local bytes arrive. A failed load is
  // resolved by the scene's fallback chain, never by a blank crossfade.
  const target = wallpaper.config.kind === "asset" && assetUrl === null
    ? settled : { key: `${wallpaperConfigKey(wallpaper.config)}|${assetUrl ?? ""}`, wallpaper, assetUrl };
  const key = target.key;
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
    setSettled(target);
  }
  // Reduced motion switched on mid-crossfade: retire the underneath layer in
  // the same render-phase pass (derived state) instead of from the effect.
  if (reducedMotion && previous !== null) {
    setPrevious(null);
  }

  const crossfading = previous !== null && !reducedMotion;
  useLayoutEffect(() => {
    const element = incomingRef.current;
    if (element === null) return;
    if (!crossfading) {
      gsap.set(element, { clearProps: "opacity" });
      return;
    }
    // Hold the incoming layer dark synchronously, then fade ONLY after the
    // INCOMING image is genuinely decoded (UX-02 ordering rule: the
    // underneath layer is already on screen; gating on its decode too left
    // the incoming layer stuck at opacity 0 forever whenever the previous
    // URL had been revoked — the black-screen defect).
    gsap.set(element, { opacity: 0 });
    let cancelled = false;
    let tween: gsap.core.Tween | null = null;
    const images = element.querySelectorAll("img[data-wallpaper-image]");
    const decoded = Promise.all(Array.from(images, (image) =>
      image instanceof HTMLImageElement ? image.decode() : Promise.resolve(),
    ));
    void decoded.then(() => {
      if (cancelled) {
        return;
      }
      tween = gsap.fromTo(element, { opacity: 0 }, {
        opacity: 1, duration: VD_MOTION_WALLPAPER.crossfade, ease: VD_MOTION_EASE,
        onComplete: () => {
          gsap.set(element, { clearProps: "opacity" });
          setPrevious(null);
          // The underneath slot left the screen with this completion — its
          // preview URL (if the layer owns it) is released only NOW, never
          // earlier (UX-02: an early revoke shows a broken/black layer).
          if (previous !== null) {
            releaseRetiredLayerUrl(previous.assetUrl);
          }
        },
      });
    }).catch(() => { /* Keep the previous decoded surface visible on failure. */ });
    return () => {
      cancelled = true;
      tween?.kill();
      gsap.set(element, { clearProps: "opacity" });
    };
    // `previous` is read inside onComplete through this closure only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, crossfading]);

  return (
    <div className={className} data-wallpaper-provenance={settled.wallpaper.provenance}>
      {previous !== null ? (
        <WallpaperSurface
          wallpaper={previous.wallpaper}
          assetUrl={previous.assetUrl}
          className="vela-desktop__wallpaper-settled"
        />
      ) : null}
      <div ref={incomingRef} className="vela-desktop__wallpaper-incoming">
        <WallpaperSurface wallpaper={settled.wallpaper} assetUrl={settled.assetUrl} />
      </div>
    </div>
  );
}
