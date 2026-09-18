/**
 * UI locale model and browser-local persistence.
 *
 * zh-CN is the product default — the first visit is Chinese, never inferred
 * from navigator.language (explicit product decision). The locale is a
 * browser preference only: it lives in localStorage, never in the
 * WorkspaceSnapshot, so switching languages cannot stage a workspace,
 * bump localGeneration, fill the outbox or fire a sync.
 *
 * Storage is the v2 key (014-E). The v1 key may still hold `en-US` in
 * real browser profiles polluted during development/automation — v1 is
 * never read and never migrated. When v2 is absent the locale is
 * unconditionally zh-CN; a user language choice only exists once it is
 * explicitly written to v2.
 */

/** The two supported UI languages. */
export type UiLocale = "zh-CN" | "en-US";

/** First-use and fallback locale. Always Simplified Chinese. */
export const DEFAULT_UI_LOCALE: UiLocale = "zh-CN";

export const UI_LOCALE_STORAGE_KEY = "veladesk.ui-locale.v2";

const SUPPORTED_LOCALES: readonly UiLocale[] = ["zh-CN", "en-US"];

function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Parses a raw stored value into a locale. Anything unsupported — other
 * languages, underscores, blank strings, null — falls back to zh-CN.
 */
export function parseUiLocale(raw: string | null | undefined): UiLocale {
  return isUiLocale(raw) ? raw : DEFAULT_UI_LOCALE;
}

/** The `lang` attribute value for a locale (identical by design here). */
export function htmlLangFor(locale: UiLocale): string {
  return locale;
}

/**
 * Reads the persisted locale. Storage failures (privacy mode, quota,
 * unavailable) must never crash the app — the default locale wins.
 */
export function readStoredUiLocale(storage: Storage | null | undefined): UiLocale {
  try {
    return parseUiLocale(storage?.getItem(UI_LOCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_UI_LOCALE;
  }
}

/** Persists the locale; write failures are swallowed the same way. */
export function persistUiLocale(locale: UiLocale, storage: Storage | null | undefined): void {
  try {
    storage?.setItem(UI_LOCALE_STORAGE_KEY, locale);
  } catch {
    // Unavailable storage costs persistence, never stability.
  }
}
