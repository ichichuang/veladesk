"use client";

import { useI18n } from "../../i18n/use-i18n";
import "../home-shell.css";

/**
 * The no-pages invariant fallback (P1-ENG-1), extracted verbatim from the
 * former desktop-shell render: a workspace always has pages, so this only
 * shows on invariant violation — stay calm, stay inspectable, never crash
 * the tab.
 */
export function NoPagesFallback() {
  const { t } = useI18n();
  return (
    <main className="vela-screen">
      <div className="vela-screen__ambient" aria-hidden="true" />
      <section className="vela-screen__panel">
        <h1 className="vela-wordmark">VelaDesk</h1>
        <p className="vela-screen__lead">{t("recovery.noPages")}</p>
        <button type="button" className="vela-button" onClick={() => window.location.reload()}>
          {t("common.retry")}
        </button>
      </section>
    </main>
  );
}
