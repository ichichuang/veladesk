"use client";

import { ListTree, Plus } from "lucide-react";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";

import { VELADESK_VERSION } from "../../../lib/app-version";
import { useI18n } from "../../i18n/use-i18n";
import type { UiLocale } from "../../i18n/locale";
import { WorkspaceMenuInline } from "../workspace-manager";
import { MobileSheet } from "./mobile-sheet";
import "./mobile-shell.css";

/**
 * The mobile menu (task 026 §47–§52; layout tightened 026-R1 §26/§27):
 * deliberately tiny — the current workspace, the browser-local language
 * choice, the product version, and the desktop-management hint. Rows are
 * two-level (quiet label, clear value) so a long workspace name never
 * crowds a `label:value` single line.
 *
 * UX-12 adds the minimal mobile EDIT entry points at the top: 添加应用
 * (the shared Add dialog, targeted at the active section) and 管理分区
 * (the mobile section manager). Layout/background authoring stays on the
 * desktop — the hint below says exactly that.
 */
export function MobileMenuSheet({
  open,
  onOpenChange,
  workspace,
  onAddApp,
  onManageSections,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly workspace: LocalWorkspaceRecord;
  /** Opens the shared Add-app dialog targeted at the active section (UX-12). */
  readonly onAddApp: () => void;
  /** Opens the mobile section manager (UX-12). */
  readonly onManageSections: () => void;
}) {
  const { locale, setLocale, t } = useI18n();
  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} variant="menu" label={t("mobile.menu.title")}>
      <div className="vela-mobile-sheet__head">
        <h2 className="vela-mobile-sheet__title">{t("mobile.menu.title")}</h2>
      </div>
      <div className="vela-mobile-menu__body">
        <div className="vela-mobile-menu__actions">
          <button
            type="button"
            className="vela-mobile-menu__action"
            onClick={() => {
              onOpenChange(false);
              onAddApp();
            }}
          >
            <Plus size={20} aria-hidden="true" />
            <span>{t("dialog.addApp.title")}</span>
          </button>
          <button
            type="button"
            className="vela-mobile-menu__action"
            onClick={() => {
              onOpenChange(false);
              onManageSections();
            }}
          >
            <ListTree size={20} aria-hidden="true" />
            <span>{t("mobile.sections.manage")}</span>
          </button>
        </div>
        <WorkspaceMenuInline beforeAction={() => onOpenChange(false)} />
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
