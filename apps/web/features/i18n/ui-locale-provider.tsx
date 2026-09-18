"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  DEFAULT_UI_LOCALE,
  htmlLangFor,
  persistUiLocale,
  readStoredUiLocale,
} from "./locale";
import type { UiLocale } from "./locale";

/**
 * Browser-local UI locale store + React binding.
 *
 * Hydration contract: the server render and the hydration render are
 * ALWAYS zh-CN (`getServerSnapshot` — matching <html lang="zh-CN"> in the
 * root layout), so there is no first-paint locale mismatch. After
 * hydration React switches to the client snapshot, which lazily restores
 * the stored locale — if it differs, the switch happens post-hydration.
 * A layout effect keeps document.documentElement.lang in sync.
 *
 * Changing the locale updates the store, persists immediately (no Save
 * step) and is purely a browser preference: no workspace staging, no
 * localGeneration bump, no outbox, no sync.
 *
 * The store lives at module scope by design: the UI locale is app-wide
 * singleton state (one html document, one active language), exactly what
 * useSyncExternalStore models.
 */

const localeListeners = new Set<() => void>();
let cachedLocale: UiLocale | null = null;

function readLocaleSnapshot(): UiLocale {
  if (cachedLocale === null) {
    cachedLocale = readStoredUiLocale(window.localStorage);
  }
  return cachedLocale;
}

function getServerLocaleSnapshot(): UiLocale {
  return DEFAULT_UI_LOCALE;
}

function subscribeLocale(listener: () => void): () => void {
  localeListeners.add(listener);
  return () => {
    localeListeners.delete(listener);
  };
}

function writeLocale(next: UiLocale): void {
  cachedLocale = next;
  persistUiLocale(next, window.localStorage);
  for (const listener of localeListeners) {
    listener();
  }
}

export interface UiLocaleContextValue {
  readonly locale: UiLocale;
  readonly setLocale: (locale: UiLocale) => void;
}

const UiLocaleContext = createContext<UiLocaleContextValue>({
  locale: DEFAULT_UI_LOCALE,
  setLocale: () => {
    // Outside a provider the locale is fixed at the default; there is no
    // storage surface to persist to either.
  },
});

export function UiLocaleProvider({ children }: { readonly children: ReactNode }) {
  const locale = useSyncExternalStore(
    subscribeLocale,
    readLocaleSnapshot,
    getServerLocaleSnapshot,
  );

  // Side effects of the active locale only — never a render-state write.
  useEffect(() => {
    document.documentElement.lang = htmlLangFor(locale);
  }, [locale]);

  const setLocale = useCallback((next: UiLocale) => {
    if (next !== readLocaleSnapshot()) {
      writeLocale(next);
    }
  }, []);

  return <UiLocaleContext.Provider value={{ locale, setLocale }}>{children}</UiLocaleContext.Provider>;
}

export const useUiLocaleContext = (): UiLocaleContextValue => useContext(UiLocaleContext);
