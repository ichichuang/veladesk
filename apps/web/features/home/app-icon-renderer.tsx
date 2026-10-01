"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { AppShortcut, AppDecorationStyle } from "@veladesk/domain";

import {
  appIconDisplayText,
  appVisual,
  buildAppIconStyleVars,
  iconifyGlyphModel,
} from "./app-icon";
import { generatedIconText } from "./generated-icon";
import { getBrowserAssetRuntime } from "../assets/browser-assets";
import "./home-shell.css";

/**
 * AppIconRenderer (task 016-A/016-B, multicolor split in 016-C) — the ONE
 * icon renderer for apps, shared by the desktop grid, the dock, the folder
 * overlay, the visual editor preview and the catalog picker.
 *
 * Monochrome library icons load from the self-hosted SVG endpoint and are
 * tinted via a CSS mask (`mask-image` + background color) — never
 * `innerHTML`, never an `<img>` that cannot take a foreground color.
 * Multicolor library icons (fluent-color, devicon, vscode-icons,
 * catppuccin, noto) ship their own pigments, so they render as a plain
 * same-origin `<img>` and are never masked — masking them would flatten
 * every collection to one accent color. Uploaded assets render through a
 * local-first object URL (IndexedDB hit, hash-verified remote hydrate on a
 * miss) and keep their OWN colors too — `foregroundColor` never tints
 * them. Any load failure degrades to the generated text initials, so a
 * broken icon never renders as a broken image. Decoration styles and
 * colors come from the resolved `AppVisualStyle`; all CSS values are
 * composed in `app-icon.ts` from validated data.
 */

type IconLoadStatus = "loading" | "ready" | "failed";

/*
 * Icon-layer cold-work caches (task 026-R2 §21/§22): every mobile section
 * switch remounts tiles, so a re-shown icon must neither re-probe the
 * library SVG nor re-fetch/re-decode an uploaded asset. Both caches live
 * HERE — the one icon layer shared by the desktop grid, dock, folder
 * overlay, launcher and mobile tiles (no second cache system):
 *
 *  - probe results: a library URL that loaded (or failed) once never
 *    probes again — a remount renders the glyph synchronously.
 *  - asset object URLs: created once per asset id and never revoked under
 *    a live surface, exactly like the wallpaper layer's assetUrlCache —
 *    bounded by the workspace's distinct icon assets for the tab session.
 */
const libraryIconProbeResults = new Map<string, Exclude<IconLoadStatus, "loading">>();
const assetIconUrlCache = new Map<string, string>();

/** One uploaded-asset glyph: layer-cached local object URL, initials on failure. */
function useAssetImageUrl(assetId: string): string | null {
  // Same shape as the wallpaper layer's URL hook: cache hits are DERIVED
  // during render (never a setState-in-effect); only an async load result
  // lives in state, keyed by asset so a late result can't leak onto
  // another asset's tile.
  const [loaded, setLoaded] = useState<{ readonly id: string; readonly url: string | null } | null>(null);
  const cached = assetIconUrlCache.get(assetId);
  const url =
    cached ?? (loaded !== null && loaded.id === assetId ? loaded.url : null);
  useEffect(() => {
    if (assetIconUrlCache.has(assetId)) {
      return;
    }
    let cancelled = false;
    getBrowserAssetRuntime()
      .then((runtime) => runtime.loadAsset(assetId))
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.ok) {
          const created = URL.createObjectURL(result.blob);
          assetIconUrlCache.set(assetId, created);
          setLoaded({ id: assetId, url: created });
        } else {
          setLoaded({ id: assetId, url: null });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded({ id: assetId, url: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [assetId]);
  return url;
}

/** One uploaded-asset glyph: local-first <img>, initials fallback on failure. */
function AssetImageGlyph({ assetId, fallback }: { assetId: string; fallback: string }) {
  const url = useAssetImageUrl(assetId);
  if (url === null) {
    return <span className="vela-app-icon__text">{fallback}</span>;
  }
  // A local object URL must render as-is: next/image optimization would
  // re-fetch and re-process bytes that are already local and verified.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="vela-app-icon__image"
      src={url}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

/** CSS mask that paints a monochrome glyph in the tile's foreground color. */
export function glyphMaskStyle(url: string): CSSProperties {
  return {
    WebkitMaskImage: `url("${url}")`,
    maskImage: `url("${url}")`,
    WebkitMaskSize: "contain",
    maskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
  };
}

/**
 * One library glyph: masked self-hosted SVG for monochrome collections, a
 * plain same-origin `<img>` for multicolor ones, generated-text fallback on
 * any failure. The id is validated at parse time, so the URL only ever
 * contains bundled collection ids and strict icon names.
 */
function LibraryIconGlyph({ icon, fallback }: { icon: string; fallback: string }) {
  const model = iconifyGlyphModel(icon);
  const url = model?.url;
  const [loadStatus, setLoadStatus] = useState<IconLoadStatus>(() =>
    url === undefined ? "failed" : (libraryIconProbeResults.get(url) ?? "loading"),
  );

  // Probing with an Image() means a 404 or a decode failure renders the
  // initials — a multicolor icon never shows up as a broken image. The
  // result is cached at the icon layer: a REMOUNT never probes again, so
  // re-shown tiles render their glyph synchronously (R2 §21).
  useEffect(() => {
    if (url === undefined || libraryIconProbeResults.has(url)) {
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      libraryIconProbeResults.set(url, "ready");
      if (!cancelled) {
        setLoadStatus("ready");
      }
    };
    image.onerror = () => {
      libraryIconProbeResults.set(url, "failed");
      if (!cancelled) {
        setLoadStatus("failed");
      }
    };
    image.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (loadStatus !== "ready" || model === undefined) {
    return <span className="vela-app-icon__text">{fallback}</span>;
  }
  if (model.kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- same-origin SVG route, not an optimizable static asset
      <img
        className="vela-app-icon__glyph vela-app-icon__glyph--image"
        src={model.url}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    );
  }
  return <span className="vela-app-icon__glyph" style={glyphMaskStyle(model.url)} />;
}

/** The inner glyph of an app icon — text, masked library SVG, or uploaded image. */
export function AppIconGlyph({ app }: { app: AppShortcut }) {
  const fallback = generatedIconText(app.name);
  if (app.icon.kind === "iconify") {
    return <LibraryIconGlyph key={app.icon.icon} icon={app.icon.icon} fallback={fallback} />;
  }
  if (app.icon.kind === "asset") {
    return <AssetImageGlyph key={app.icon.assetId} assetId={app.icon.assetId} fallback={fallback} />;
  }
  return <span className="vela-app-icon__text">{appIconDisplayText(app)}</span>;
}

/**
 * Host-element props that turn a button/div into the icon tile itself —
 * used by the dock, whose buttons ARE the tiles (the desktop item instead
 * composes surface + glyph through the adaptive content layer).
 */
export function appIconDecorationProps(app: AppShortcut): {
  "data-decoration": AppDecorationStyle;
  style: CSSProperties;
} {
  const style = appVisual(app);
  return {
    "data-decoration": style.decorationStyle,
    style: buildAppIconStyleVars(style) as CSSProperties,
  };
}

/**
 * The full icon tile for an app, as rendered in fixed-slot contexts (dock,
 * folder overlay): decoration + glyph in one element, sized by the shared
 * slot variable.
 */
export function AppIconTile({ app }: { app: AppShortcut }) {
  const style = appVisual(app);
  return (
    <span
      aria-hidden="true"
      className="vela-item__icon vela-app-icon"
      data-decoration={style.decorationStyle}
      style={buildAppIconStyleVars(style) as CSSProperties}
    >
      <AppIconGlyph app={app} />
    </span>
  );
}

/**
 * The DECORATION-ONLY layer of an adaptive desktop tile (019-B): fills the
 * ENTIRE outer geometry (grid span box / freeform rect / preview stage)
 * with the app's gradient/solid/glass/none surface, and nothing else. The
 * icon + title composition lives in the sibling `.vela-app-content` flow
 * (see desktop-item.tsx and app-content-layout.ts).
 */
export function AppIconSurface({ app }: { app: AppShortcut }) {
  const style = appVisual(app);
  return (
    <span
      aria-hidden="true"
      className="vela-app-icon vela-app-icon--surface"
      data-decoration={style.decorationStyle}
      style={buildAppIconStyleVars(style) as CSSProperties}
    />
  );
}
