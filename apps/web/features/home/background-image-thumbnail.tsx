"use client";

import { useEffect, useState } from "react";
import type { WallpaperConfig } from "@veladesk/domain";

import { getBrowserAssetRuntime } from "../assets/browser-assets";
import { useI18n } from "../i18n/use-i18n";
import type { PreparedWallpaperImage } from "./wallpaper-prep";

/** Saved URLs belong to this thumbnail; pending URLs belong to SettingsCenter. */
type ThumbnailProps = {
  readonly config: WallpaperConfig | null;
  readonly pending: PreparedWallpaperImage | null;
};

export function BackgroundImageThumbnail(props: ThumbnailProps) {
  const id = props.config?.kind === "asset" ? props.config.assetId : "empty";
  const previewUrl = props.pending?.asset.id === id ? props.pending.previewUrl : null;
  return <ResolvedThumbnail key={`${id}:${previewUrl ?? "saved"}`} {...props} />;
}

function ResolvedThumbnail({ config, pending }: ThumbnailProps) {
  const { t } = useI18n();
  const assetId = config?.kind === "asset" ? config.assetId : null;
  const candidate = pending?.asset.id === assetId ? pending : null;
  const [resolved, setResolved] = useState<{ id: string; url: string | null } | null>(null);

  useEffect(() => {
    if (assetId === null || candidate !== null) return;
    let cancelled = false;
    let ownedUrl: string | null = null;
    void (async () => {
      try {
        const runtime = await getBrowserAssetRuntime();
        const result = await runtime.loadAsset(assetId);
        if (cancelled) return;
        if (result.ok && "blob" in result && result.blob instanceof Blob) {
          ownedUrl = URL.createObjectURL(result.blob);
        }
        setResolved({ id: assetId, url: ownedUrl });
      } catch {
        if (!cancelled) setResolved({ id: assetId, url: null });
      }
    })();
    return () => {
      cancelled = true;
      if (ownedUrl !== null) URL.revokeObjectURL(ownedUrl);
    };
  }, [assetId, candidate]);

  const url = candidate?.previewUrl ?? (resolved?.id === assetId ? resolved.url : null);
  const failed = candidate === null && resolved?.id === assetId && resolved.url === null;
  return (
    <ThumbnailImage
      key={`${assetId ?? "empty"}:${url ?? "loading"}`}
      url={url}
      empty={assetId === null}
      failed={failed}
      fit={config?.kind === "asset" ? config.fit : "cover"}
      pending={candidate !== null}
      label={t("settings.background.imagePreview")}
    />
  );
}

function ThumbnailImage({ url, empty, failed, fit, pending, label }: {
  readonly url: string | null;
  readonly empty: boolean;
  readonly failed: boolean;
  readonly fit: "cover" | "contain";
  readonly pending: boolean;
  readonly label: string;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const error = failed || status === "error";
  const loading = !empty && !error && status === "loading";
  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={loading}
      className={`relative flex h-[72px] w-[168px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-vdu-border bg-vdu-bg text-xs text-vdu-fg ${empty ? "border-dashed" : ""}`}
    >
      {empty ? <span>{t("settings.background.noImage")}</span> : error ? (
        <span role="status">{t("settings.background.imageLoadError")}</span>
      ) : (
        <>
          {loading ? (
            <span className="absolute inset-0 animate-pulse motion-reduce:animate-none bg-vdu-border"
              role="status" aria-label={t("settings.background.imageLoading")} />
          ) : null}
          {url !== null ? (
            <img src={url} alt={label} draggable={false}
              className="h-full w-full"
              style={{ objectFit: fit, visibility: loading ? "hidden" : "visible" }}
              onLoad={() => setStatus("loaded")}
              onError={() => setStatus("error")} />
          ) : null}
          {pending ? (
            <span className="absolute bottom-1 right-1 rounded bg-vdu-bg px-1 text-vdu-fg">
              {t("settings.background.imagePending")}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}
