"use client";

import { useCallback } from "react";

import { translate } from "./messages";
import type { MessageParams, TranslationKey } from "./messages";
import type { UiLocale } from "./locale";
import { useUiLocaleContext } from "./ui-locale-provider";

export type TranslateFn = (key: TranslationKey, params?: MessageParams) => string;

export interface UseI18nResult {
  readonly locale: UiLocale;
  readonly setLocale: (locale: UiLocale) => void;
  readonly t: TranslateFn;
}

/**
 * The consumer side of the UI locale: the active locale, an immediate
 * switcher (persists to localStorage, never touches the workspace) and a
 * typed `t` bound to the current catalog.
 */
export function useI18n(): UseI18nResult {
  const { locale, setLocale } = useUiLocaleContext();
  const t = useCallback<TranslateFn>(
    (key, params) => translate(locale, key, params),
    [locale],
  );
  return { locale, setLocale, t };
}
