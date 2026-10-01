"use client";

import type { LocalWorkspaceRecord } from "@veladesk/local-store";

import { VELADESK_VERSION } from "../../../lib/app-version";
import { useI18n } from "../../i18n/use-i18n";
import type { UiLocale } from "../../i18n/locale";
import { MobileSheet } from "./mobile-sheet";
import "./mobile-shell.css";

/**
 * The mobile menu (task 026 §47–§52; layout tightened 026-R1 §26/§27):
 * deliberately tiny — the current workspace, the browser-local language
 * choice, the product version, and the desktop-management hint. Rows are
 * two-level (quiet label, clear value) so a long workspace name never
 * crowds a `label:value` single line. Management features are NOT disabled
 * here; they are absent. Workspace switching is omitted in v1 (no clean
 * ready-state switch action exists today — see the task 026 report).
 */
export function MobileMenuSheet({
  open,
  onOpenChange,
  workspace,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly workspace: LocalWorkspaceRecord;
}) {
  const { locale, setLocale, t } = useI18n();
  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} variant="menu" label={t("mobile.menu.title")}>
      <div className="vela-mobile-sheet__head">
        <h2 className="vela-mobile-sheet__title">{t("mobile.menu.title")}</h2>
      </div>
      <div className="vela-mobile-menu__body">
        <div className="vela-mobile-menu__row">
          <span className="vela-mobile-menu__row-label">{t("mobile.menu.workspaceLabel")}</span>
          <span className="vela-mobile-menu__row-value">{workspace.snapshot.name}</span>
        </div>
        <div className="vela-mobile-menu__row">
          <span className="vela-mobile-menu__row-label">{t("mobile.menu.language")}</span>
          <span
            className="vela-mobile-menu__language"
            role="group"
            aria-label={t("mobile.menu.language")}
          >
            <LocaleOption locale={locale} target="zh-CN" setLocale={setLocale} label="中文" />
            <LocaleOption locale={locale} target="en-US" setLocale={setLocale} label="English" />
          </span>
        </div>
        <div className="vela-mobile-menu__row">
          <span className="vela-mobile-menu__row-label">{t("mobile.menu.versionLabel")}</span>
          <span className="vela-mobile-menu__row-value">{VELADESK_VERSION}</span>
        </div>
        <p className="vela-mobile-menu__hint">{t("mobile.menu.desktopHint")}</p>
      </div>
    </MobileSheet>
  );
}

function LocaleOption({
  locale,
  target,
  setLocale,
  label,
}: {
  readonly locale: UiLocale;
  readonly target: UiLocale;
  readonly setLocale: (locale: UiLocale) => void;
  readonly label: string;
}) {
  return (
    <button
      type="button"
      className="vela-mobile-menu__language-option"
      aria-pressed={locale === target ? "true" : "false"}
      onClick={() => setLocale(target)}
    >
      {label}
    </button>
  );
}
