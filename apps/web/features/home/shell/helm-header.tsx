"use client";

import { Search } from "lucide-react";

import { useI18n } from "../../i18n/use-i18n";
import { HelmClock } from "./helm-clock";
import "../home-shell.css";

/*
 * The Helm header (Helm first picture, 2026-11-10): the one top-center
 * landmark over the scene — a large thin clock (the ONLY consumer of the
 * 72px type token), the date line under it, and the glass ⌘K command bar
 * beneath. The whole band is pointer-transparent EXCEPT the command bar:
 * tiles may fly under the clock during drags and section travel, and the
 * clock never steals a click from the desktop. The bar routes into the
 * existing launcher palette (Ctrl/Cmd+K also still works — the shortcut
 * and the bar are two doors into the same room).
 */

export function HelmHeader({
  onOpenCommands,
}: {
  /** Opens the ⌘K launcher palette. */
  readonly onOpenCommands: () => void;
}) {
  const { t, locale } = useI18n();
  return (
    <header className="vela-helm-header">
      <HelmClock locale={locale} />
      <button
        type="button"
        className="vela-helm-commandbar"
        onClick={onOpenCommands}
      >
        <Search className="vela-helm-commandbar__icon" strokeWidth={1.5} aria-hidden="true" />
        <span className="vela-helm-commandbar__placeholder">
          {t("helm.commandbar")}
        </span>
        <kbd className="vela-helm-commandbar__kbd">{t("helm.commandbarKey")}</kbd>
      </button>
    </header>
  );
}

