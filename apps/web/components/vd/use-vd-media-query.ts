"use client";

import { useEffect, useState } from "react";

/**
 * A live media-query read for overlay placement decisions (t171: the
 * editing window becomes a full-screen bottom sheet on narrow viewports).
 * SSR and jsdom (no matchMedia) read as no-match; a flip mid-session
 * re-renders the caller.
 */
export function useVdMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    try {
      return typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(query).matches
        : false;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };
    list.addEventListener("change", onChange);
    return () => {
      list.removeEventListener("change", onChange);
    };
  }, [query]);
  return matches;
}
