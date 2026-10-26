"use client";

import { useSyncExternalStore } from "react";

/**
 * Tracks the OS color-scheme preference (`prefers-color-scheme: light`) so
 * a workspace shell can resolve the "system" color choice in JS (021-R1).
 * Both presentation shells (desktop and mobile) resolve the SAME effective
 * color mode through this SAME subscription.
 *
 * Mobile live-switch bug (the palette only changed after a reload):
 *
 * 1. On a phone the OS appearance is switched from ANOTHER app (Settings,
 *    Control Center, an automatic sunset switch). Mobile browsers and
 *    in-app webviews suspend a backgrounded page and do not reliably
 *    deliver the MediaQueryList `change` event that happened meanwhile, so
 *    the page came back still showing the old mode. The subscription now
 *    also re-reads the live query when the page becomes visible / is
 *    restored from the back-forward cache / regains focus. The snapshot is
 *    a boolean, so a re-read with no change costs no re-render.
 * 2. `MediaQueryList.addEventListener` does not exist on Safari < 14 /
 *    iOS < 14 — the only spelling is `addListener`/`removeListener`.
 *    `subscribeColorScheme` owns both spellings, so an old engine never
 *    throws inside the subscription.
 * 3. `useSyncExternalStore` reads the live MQL during render and subscribes
 *    in the same commit, so there is no stale first frame, and
 *    `getServerSnapshot` keeps SSR deterministic (the product default: dark).
 *
 * Manual light/dark choices never read this hook's value — they pass
 * through `resolveEffectiveColorMode` untouched — so an OS switch cannot
 * override an explicit choice.
 */
export const COLOR_SCHEME_QUERY = "(prefers-color-scheme: light)";

/** The MQL surface both the modern and the legacy Safari spelling share. */
export interface ColorSchemeMediaQuery {
  readonly matches: boolean;
  addEventListener?: (type: "change", listener: (event: MediaQueryListEvent) => void) => void;
  removeEventListener?: (type: "change", listener: (event: MediaQueryListEvent) => void) => void;
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
}

/**
 * Subscribes `onChange` to a media-query list using whichever API the
 * browser has. Returns the matching unsubscribe — a no-op when neither API
 * exists (a live change is then simply not observable, which must never
 * throw during an effect).
 */
export function subscribeColorScheme(
  query: ColorSchemeMediaQuery,
  onChange: (matches: boolean) => void,
): () => void {
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);

  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", listener);
    return () => query.removeEventListener?.("change", listener);
  }
  // Legacy Safari / iOS: the only API is addListener/removeListener.
  if (typeof query.addListener === "function") {
    query.addListener(listener);
    return () => query.removeListener?.(listener);
  }
  return () => {};
}

function canMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function colorSchemeQuery(): MediaQueryList | undefined {
  try {
    return window.matchMedia(COLOR_SCHEME_QUERY);
  } catch {
    return undefined;
  }
}

/** SSR-safe one-shot read; `false` (dark) when the capability is absent. */
export function prefersLightNow(): boolean {
  if (!canMatchMedia()) {
    return false;
  }
  try {
    return window.matchMedia(COLOR_SCHEME_QUERY).matches === true;
  } catch {
    return false;
  }
}

/**
 * Subscribes once per query change. The cached MQL instance keeps
 * `getSnapshot` stable across renders (a fresh MediaQueryList per call
 * would be a new object, but `matches` — the actual snapshot — is a
 * boolean, so React's equality check stays cheap and correct).
 */
function subscribe(onStoreChange: () => void): () => void {
  if (!canMatchMedia()) {
    return () => {};
  }
  const query = colorSchemeQuery();
  const unsubscribeQuery =
    query === undefined ? () => {} : subscribeColorScheme(query, () => onStoreChange());
  // A change that happened while the page was suspended in the background
  // may never fire `change`: re-read whenever the page comes back.
  const recheck = () => onStoreChange();
  document.addEventListener("visibilitychange", recheck);
  window.addEventListener("pageshow", recheck);
  window.addEventListener("focus", recheck);
  return () => {
    unsubscribeQuery();
    document.removeEventListener("visibilitychange", recheck);
    window.removeEventListener("pageshow", recheck);
    window.removeEventListener("focus", recheck);
  };
}

function getSnapshot(): boolean {
  return prefersLightNow();
}

/** The server/first-paint answer: the product default, never a mismatch. */
function getServerSnapshot(): false {
  return false;
}

export function useSystemPrefersLight(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
