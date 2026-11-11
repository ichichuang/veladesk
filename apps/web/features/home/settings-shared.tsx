import type { ReactNode } from "react";

import type {
  WorkspaceColorMode,
  WorkspaceInterfaceStyle,
  WorkspaceWallpaperPreset,
} from "@veladesk/domain";

import { MAX_ASSET_BYTES } from "@veladesk/assets/core";
import type { TranslationKey } from "../i18n/messages";

/**
 * Shared constants and the one settings row layout, split out of the
 * Settings Center (P1) so the window shell and the section modules stay
 * under the file-size budget. Nothing here owns state.
 */

/** The EFFECTIVE upload cap rendered to users: the shared core byte budget. */
export const EFFECTIVE_UPLOAD_LIMIT_MIB = Math.round(MAX_ASSET_BYTES / (1024 * 1024));

export const COLOR_MODE_OPTIONS: readonly {
  readonly value: WorkspaceColorMode;
  readonly labelKey: TranslationKey;
}[] = [
  { value: "system", labelKey: "settings.colorMode.system" },
  { value: "dark", labelKey: "settings.colorMode.dark" },
  { value: "light", labelKey: "settings.colorMode.light" },
];

export const WALLPAPER_OPTIONS: readonly {
  readonly value: WorkspaceWallpaperPreset;
  readonly labelKey: TranslationKey;
}[] = [
  { value: "chart", labelKey: "settings.wallpaper.chart" },
  { value: "aurora", labelKey: "settings.wallpaper.aurora" },
  { value: "midnight", labelKey: "settings.wallpaper.midnight" },
  { value: "dawn", labelKey: "settings.wallpaper.dawn" },
  { value: "mist", labelKey: "settings.wallpaper.mist" },
];

export const INTERFACE_STYLE_LABEL_KEY: Readonly<
  Record<WorkspaceInterfaceStyle, TranslationKey>
> = {
  clean: "settings.interfaceStyle.clean",
  soft: "settings.interfaceStyle.soft",
  glass: "settings.interfaceStyle.glass",
};

export const INTERFACE_STYLE_HINT_KEY: Readonly<
  Record<WorkspaceInterfaceStyle, TranslationKey>
> = {
  clean: "settings.interfaceStyle.clean.hint",
  soft: "settings.interfaceStyle.soft.hint",
  glass: "settings.interfaceStyle.glass.hint",
};

/** One settings row: title (+optional hint) left, control right. */
export function SettingsRow({
  title,
  hint,
  htmlFor,
  children,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly htmlFor?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(200px,1fr)_minmax(240px,320px)] items-center gap-6">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-vdu-fg">
          {title}
        </label>
        {hint !== undefined ? (
          <p className="mt-1 text-xs leading-relaxed text-vdu-fg-muted">{hint}</p>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center justify-end">{children}</div>
    </div>
  );
}
