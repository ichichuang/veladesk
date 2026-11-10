"use client";

import { useEffect, useState } from "react";

import { Search } from "lucide-react";

import { useI18n } from "../../i18n/use-i18n";
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
 *
 * The clock is its own tiny state island: one 1s interval that only
 * re-renders when the DISPLAYED string changes (HH:MM), so the workspace
 * tree never ticks.
 */

function clockText(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function dateText(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

function HelmClock({ locale }: { readonly locale: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = new Date();
      setNow((current) =>
        clockText(current) === clockText(next) ? current : next,
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="vela-helm-clock" aria-hidden="true">
      <span className="vela-helm-clock__time">{clockText(now)}</span>
      <span className="vela-helm-clock__date">{dateText(now, locale)}</span>
    </div>
  );
}

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
