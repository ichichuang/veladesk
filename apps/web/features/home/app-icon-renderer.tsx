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

/**
 * Local-first object URL for an uploaded asset: an IndexedDB blob when
 * present, a hash-verified remote GET + hydrate on a miss, or `null`
 * (→ initials fallback) on any failure. The URL is revoked on
 * change/unmount — no object-URL leaks.
 */
function useAssetImageUrl(assetId: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    getBrowserAssetRuntime()
      .then((runtime) => runtime.loadAsset(assetId))
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.ok) {
          createdUrl = URL.createObjectURL(result.blob);
          setUrl(createdUrl);
        } else {
          setUrl(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUrl(null);
        }
      });
    return () => {
      cancelled = true;
      if (createdUrl !== null) {
        URL.revokeObjectURL(createdUrl);
      }
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
  const [loadStatus, setLoadStatus] = useState<IconLoadStatus>("loading");

  // Probing with an Image() means a 404 or a decode failure renders the
  // initials — a multicolor icon never shows up as a broken image.
  useEffect(() => {
    if (url === undefined) {
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) {
        setLoadStatus("ready");
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setLoadStatus("failed");
      }
    };
    image.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);

  const status: IconLoadStatus = url === undefined ? "failed" : loadStatus;
  if (status !== "ready" || model === undefined) {
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
 * nests {@link AppIconTile} inside its slot).
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

/** The full icon tile for an app, as rendered on the desktop grid. */
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
