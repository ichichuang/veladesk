"use client";

import { useEffect, useState } from "react";

import {
  COARSE_TOUCH_VIEWPORT_QUERY,
  NARROW_VIEWPORT_QUERY,
  readShellModeMatches,
  resolveWorkspaceShellMode,
} from "./responsive-shell-mode";
import type { WorkspaceShellMode } from "./responsive-shell-mode";

/**
 * The live workspace shell mode (task 026 §6/§7).
 *
 * `null` means the capability is UNRESOLVED — no shell has been chosen yet
 * and the caller keeps the existing startup/loading surface mounted (§7).
 * In practice a real browser resolves on the very first render: the ready
 * workspace UI only mounts client-side after the runtime's open effect
 * (the server render is the startup fallback), so reading matchMedia in
 * the state initializer is hydration-safe by construction and the first
 * meaningful frame is already the correct shell — no desktop flash on a
 * phone. The initializer returns null when matchMedia is unavailable
 * (SSR guard, jsdom without a stub) and the effect below keeps watching.
 *
 * Live listeners re-resolve on viewport changes: resizing a desktop
 * window narrow swaps the shell, rotating a phone re-evaluates both legs
 * (§87 — matchMedia only, never window.orientation). The mode is never
 * persisted (§86).
 */
export function useWorkspaceShellMode(): WorkspaceShellMode | null {
  const [mode, setMode] = useState<WorkspaceShellMode | null>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return null;
    }
    return resolveWorkspaceShellMode(readShellModeMatches(window.matchMedia));
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const narrow = window.matchMedia(NARROW_VIEWPORT_QUERY);
    const coarse = window.matchMedia(COARSE_TOUCH_VIEWPORT_QUERY);
    const onChange = () => {
      setMode(resolveWorkspaceShellMode({ narrowViewport: narrow.matches, coarseTouchViewport: coarse.matches }));
    };
    narrow.addEventListener("change", onChange);
    coarse.addEventListener("change", onChange);
    return () => {
      narrow.removeEventListener("change", onChange);
      coarse.removeEventListener("change", onChange);
    };
  }, []);

  return mode;
}
