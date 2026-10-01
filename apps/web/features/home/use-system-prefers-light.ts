"use client";

import { useEffect, useState } from "react";

/**
 * Tracks the OS color-scheme preference (`prefers-color-scheme: light`) so
 * a workspace shell can resolve the "system" color choice in JS (021-R1).
 * Extracted from DesktopShell for task 026: both presentation shells
 * (desktop and mobile) resolve the SAME effective color mode through the
 * SAME listener.
 *
 * Mirrors the client-only contract of the reduced-motion bridge: the
 * workspace shells only mount after boot in the browser, so the SSR-safe
 * default (dark, the product default) is never hydrated against.
 */
export function useSystemPrefersLight(): boolean {
  const [prefersLight, setPrefersLight] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia("(prefers-color-scheme: light)").matches;
  });
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (event: MediaQueryListEvent) => {
      setPrefersLight(event.matches);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return prefersLight;
}
