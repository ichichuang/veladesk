"use client";

import { useEffect } from "react";

import type { EffectiveColorMode } from "./appearance-theme";

/**
 * Mirrors the shell's EFFECTIVE color mode onto the document element's
 * `color-scheme`. The themed roots already carry it, but the document
 * itself was always `dark` (vd-ui.css `:root`), so the browser-owned
 * surfaces outside them — the canvas behind an iOS overscroll bounce,
 * native scrollbars — stayed dark in light mode. It follows the RESOLVED
 * mode, so a manual light/dark choice never tracks the OS, and "system"
 * tracks it live. Restored on unmount (a shell switch or the boot screen).
 */
export function useDocumentColorScheme(mode: EffectiveColorMode): void {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.colorScheme;
    root.style.colorScheme = mode;
    return () => {
      root.style.colorScheme = previous;
    };
  }, [mode]);
}
