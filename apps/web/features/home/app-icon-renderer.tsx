"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { AppShortcut, AppDecorationStyle } from "@veladesk/domain";

import {
  appIconDisplayText,
  appVisual,
  buildAppIconStyleVars,
  iconSvgUrlForId,
} from "./app-icon";
import { generatedIconText } from "./generated-icon";
import "./home-shell.css";

/**
 * AppIconRenderer (task 016-A) — the ONE icon renderer for apps, shared by
 * the desktop grid, the dock, the folder overlay and the visual editor
 * preview.
 *
 * Library icons load from the self-hosted SVG endpoint and are tinted via
 * a CSS mask (`mask-image` + background color) — never `innerHTML`, never
 * an `<img>` that cannot take a foreground color. A 404 or load failure
 * degrades to the generated text initials, so a broken icon never renders
 * as a broken image. Decoration styles and colors come from the resolved
 * `AppVisualStyle`; all CSS values are composed in `app-icon.ts` from
 * validated data.
 */

type IconLoadStatus = "loading" | "ready" | "failed";

/** One library glyph: masked self-hosted SVG with generated-text fallback. */
function LibraryIconGlyph({ icon, fallback }: { icon: string; fallback: string }) {
  // Validated at parse time: the URL only ever contains bundled collection
  // ids and strict icon names, so quoting is safe.
  const url = iconSvgUrlForId(icon);
  const [loadStatus, setLoadStatus] = useState<IconLoadStatus>("loading");

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

  // An unparseable id is a permanent failure — derived, never state.
  const status: IconLoadStatus = url === undefined ? "failed" : loadStatus;
  if (status !== "ready" || url === undefined) {
    return <span className="vela-app-icon__text">{fallback}</span>;
  }
  const maskStyle: CSSProperties = {
    WebkitMaskImage: `url("${url}")`,
    maskImage: `url("${url}")`,
    WebkitMaskSize: "contain",
    maskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
  };
  return <span className="vela-app-icon__glyph" style={maskStyle} />;
}

/** The inner glyph of an app icon — text or masked library SVG. */
export function AppIconGlyph({ app }: { app: AppShortcut }) {
  const fallback = generatedIconText(app.name);
  if (app.icon.kind === "iconify") {
    return <LibraryIconGlyph key={app.icon.icon} icon={app.icon.icon} fallback={fallback} />;
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
