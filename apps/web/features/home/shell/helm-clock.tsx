"use client";

import { useEffect, useState } from "react";

/*
 * The Helm clock (Helm first picture): a large thin clock plus the date
 * line under it — the desktop's top landmark, and (Helm r2) the mobile
 * shell's compact variant. The whole block is decorative (aria-hidden):
 * the workspace name carries the identity, and the clock never takes
 * pointers or focus.
 *
 * Its own tiny state island: one 1s interval that only re-renders when the
 * DISPLAYED string changes (HH:MM), so the workspace tree never ticks.
 */

export type HelmClockVariant = "band" | "compact";

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

export function HelmClock({
  locale,
  variant = "band",
}: {
  readonly locale: string;
  /** `band` = the desktop's 72px landmark; `compact` = the mobile shrunken twin. */
  readonly variant?: HelmClockVariant;
}) {
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
    <div className="vela-helm-clock" data-variant={variant} aria-hidden="true">
      <span className="vela-helm-clock__time">{clockText(now)}</span>
      <span className="vela-helm-clock__date">{dateText(now, locale)}</span>
    </div>
  );
}
