"use client";

import { useMemo } from "react";

import { resolveWorkspaceAppearance } from "@veladesk/domain";
import type {
  WorkspaceAppearancePreferences,
  WorkspacePreferences,
} from "@veladesk/domain";

import { useSystemPrefersLight } from "../use-system-prefers-light";
import { useDocumentColorScheme } from "../use-document-color-scheme";
import { buildAppearanceTheme, resolveEffectiveColorMode } from "../appearance-theme";

/**
 * The shell's theme derivation (P1-ENG-1), extracted verbatim from the
 * former desktop-shell.tsx: the effective appearance (Settings preview ??
 * persisted), the CSS-variable theme object and the EFFECTIVE color mode.
 *
 * t137: the desktop theme is LIVE-previewed from the Settings draft (the
 * shell calls this with the preview for BOTH themed roots); dropping the
 * preview on Cancel/close returns the desktop to the persisted appearance.
 * The portal-root call keeps `applyDocumentScheme: false` — the document
 * scheme stays with the desktop's own (previewed) derivation.
 */
export function useShellTheme({
  appearancePreview,
  preferences,
  applyDocumentScheme = true,
}: {
  /** Session-only live preview from the Settings Center, or null. */
  readonly appearancePreview: WorkspaceAppearancePreferences | null;
  readonly preferences: WorkspacePreferences;
  /** Whether to mirror the resolved mode onto the document (one owner). */
  readonly applyDocumentScheme?: boolean;
}) {
  /**
   * The rendered theme: the Settings preview while open, otherwise the
   * persisted appearance (legacy snapshots resolve to the Task013
   * defaults). This is the ONLY theme source — no component reads
   * appearance individually, everything inherits the CSS variables.
   */
  const resolvedAppearance = appearancePreview ?? resolveWorkspaceAppearance(preferences);
  const theme = useMemo(() => buildAppearanceTheme(resolvedAppearance), [resolvedAppearance]);
  /**
   * The EFFECTIVE color mode (021-R1): "system" resolves against the OS
   * preference (live, via matchMedia) before it reaches the DOM or any
   * library theme attribute. Both themed roots — the desktop and the shared
   * overlay portal root — always carry the same effective value, so every
   * portaled overlay subtree inherits exactly one palette. A live OS theme
   * switch re-renders the shell through the matchMedia listener below.
   */
  const systemPrefersLight = useSystemPrefersLight();
  const effectiveColorMode = useMemo(
    () => resolveEffectiveColorMode(theme.colorMode, systemPrefersLight),
    [theme.colorMode, systemPrefersLight],
  );
  useDocumentColorScheme(effectiveColorMode, applyDocumentScheme);

  return { resolvedAppearance, theme, effectiveColorMode };
}
