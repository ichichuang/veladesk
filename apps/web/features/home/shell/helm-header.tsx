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
  showClock = true,
  showDate = true,
  showCommandBar = true,
}: {
  /** Opens the ⌘K launcher palette. */
  readonly onOpenCommands: () => void;
  /** task 029 block visibility: absent = shown. The reserved band height
   *  follows per hidden block through the shell's data-helm-*-off markers
   *  (F1) — any combination shrinks its own share. */
  readonly showClock?: boolean;
  /** task 029: the date rides the clock block but toggles independently. */
  readonly showDate?: boolean;
  /** task 029: the ⌘K command bar (search entry). */
  readonly showCommandBar?: boolean;
}) {
  const { t, locale } = useI18n();
  // Entrance/exit (task 029 rework): the header stays MOUNTED and its
  // blocks toggle data-vd-block-hidden — home-shell.css eases each one
  // while the F1 token zeroing collapses the reserved band. The container
  // renders even when every block is hidden (its height is then the
  // breathing margins alone, per F1).
  return (
    <header className="vela-helm-header">
      <HelmClock locale={locale} showTime={showClock} showDate={showDate} />
      <button
        type="button"
        className="vela-helm-commandbar"
        data-vd-block=""
        data-vd-block-hidden={showCommandBar ? undefined : "true"}
        tabIndex={showCommandBar ? 0 : -1}
        aria-hidden={!showCommandBar}
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

