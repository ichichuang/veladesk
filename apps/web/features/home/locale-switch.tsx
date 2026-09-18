"use client";

import { buildLocaleSwitchButtons } from "../i18n/locale-switch";
import { useI18n } from "../i18n/use-i18n";
import "./home-shell.css";

/**
 * The compact 中/EN switch in the top bar (014-E): bilingual support is
 * discoverable without opening Settings. Writes the same browser-local
 * UiLocale store the Settings General section uses — one source of truth,
 * immediate UI + `<html lang>` switch, never any workspace staging.
 */
export function LocaleSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="vela-locale-switch" role="group" aria-label={t("topbar.language")}>
      {buildLocaleSwitchButtons(locale).map((button) => (
        <button
          key={button.locale}
          type="button"
          className="vela-locale-switch__button"
          aria-pressed={button.pressed}
          lang={button.locale}
          onClick={() => setLocale(button.locale)}
        >
          {button.label}
        </button>
      ))}
    </div>
  );
}
