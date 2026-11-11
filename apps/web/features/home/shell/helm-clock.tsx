"use client";

import { useEffect, useRef, useState } from "react";

/*
 * The Helm clock (Helm first picture): a large thin clock plus the date
 * line under it — the desktop's top landmark, and (Helm r2) the mobile
 * shell's compact variant. The whole block is decorative (aria-hidden):
 * the workspace name carries the identity, and the clock never takes
 * pointers or focus.
 *
 * t61 live-clock rework: HH:MM:SS on tabular numerals, every DIGIT its own
 * vertical odometer reel. Each reel holds the digits twice (0–9, 0–9) and
 * only ever rolls UP — a decrease (5→0 on a carry) travels the long way
 * around, exactly like a mechanical counter, so every change reads as
 * "old digit slides out the top, new digit slides in from below". Only
 * the digits that actually changed move; a 59→00 carry rolls both columns
 * in the same upward direction. The roll is a single transform transition
 * (~400ms, ease-out) with a soft vertical mask fade at the window edges;
 * reduced motion drops the transition (digits swap in place) and the
 * colon's breathing glow.
 *
 * Timing is boundary-aligned, never a free-running interval: each tick is
 * scheduled to the next whole second (setTimeout + rAF), so the clock
 * cannot drift, and a tab returning from the background simply rolls each
 * digit ONCE to the current time — no backlog of catch-up animations.
 */

export type HelmClockVariant = "band" | "compact";

/** The reel transition (t61 spec band 350–450ms). */
const ROLL_MS = 400;
/** The duplicate-set reel: 0–9 twice, so an upward roll never runs out. */
const REEL_DIGITS: readonly string[] = [
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
];
/** Reel cells beyond the first set exist only to roll onto. */
const REEL_WRAP_BASE = 10;

function timeDigits(date: Date): readonly number[] {
  const pad = (value: number): number[] => [
    Math.floor(value / 10) % 10,
    value % 10,
  ];
  return [...pad(date.getHours()), ...pad(date.getMinutes()), ...pad(date.getSeconds())];
}

function dateText(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

/** One rolling digit column. See the module comment for the reel model. */
function RollerDigit({ digit }: { readonly digit: number }) {
  // `pos` is the reel index; it may transiently exceed 9 after a wrap, and
  // parks back into 0–9 (an invisible snap between identical positions)
  // once the roll has finished.
  const [pos, setPos] = useState(digit);
  const [snap, setSnap] = useState(false);
  const prevDigitRef = useRef(digit);

  useEffect(() => {
    if (digit === prevDigitRef.current) {
      return;
    }
    prevDigitRef.current = digit;
    // Always roll UP: the steps to the next occurrence of `digit`, even
    // around a decrease (5→0 rolls +5, 9→0 rolls +1 onto the duplicate).
    setPos((current) => {
      const steps = (digit - (current % REEL_WRAP_BASE) + REEL_WRAP_BASE) % REEL_WRAP_BASE;
      return current + steps;
    });
  }, [digit]);

  // Park a rolled-past-the-wrap reel back into the first set. The parked
  // position shows the same digit, so even if the un-transitioned snap
  // paints it is invisible by construction.
  useEffect(() => {
    if (pos < REEL_WRAP_BASE) {
      return;
    }
    const timer = window.setTimeout(() => {
      setSnap(true);
      setPos((current) => (current >= REEL_WRAP_BASE ? current - REEL_WRAP_BASE : current));
      requestAnimationFrame(() => setSnap(false));
    }, ROLL_MS + 60);
    return () => window.clearTimeout(timer);
  }, [pos]);

  return (
    <span className="vela-clock-digit" aria-hidden="true">
      <span
        className="vela-clock-digit__reel"
        style={{
          transform: `translateY(${-pos}em)`,
          ...(snap ? { transition: "none" } : {}),
        }}
      >
        {REEL_DIGITS.map((value, index) => (
          <span key={index}>{value}</span>
        ))}
      </span>
    </span>
  );
}

function ClockColon() {
  return <span className="vela-helm-clock__colon">:</span>;
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

  // Boundary-aligned ticking (no drift, no background catch-up): schedule
  // each tick a hair past the next whole second, land it in a rAF, and
  // re-align from the wall clock every time. A hidden tab simply misses
  // ticks; the visible one rolls straight to the current time.
  useEffect(() => {
    let timer = 0;
    let frame = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) {
        return;
      }
      const next = new Date();
      setNow((current) =>
        current.getTime() >= next.getTime() ? current : next,
      );
      schedule();
    };
    const schedule = () => {
      const delay = 1000 - (Date.now() % 1000) + 2;
      timer = window.setTimeout(() => {
        frame = requestAnimationFrame(tick);
      }, delay);
    };
    const rescheduleOnVisibility = () => {
      if (document.visibilityState === "visible") {
        window.clearTimeout(timer);
        cancelAnimationFrame(frame);
        schedule();
      }
    };
    schedule();
    document.addEventListener("visibilitychange", rescheduleOnVisibility);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", rescheduleOnVisibility);
    };
  }, []);

  const digits = timeDigits(now);
  const label = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  return (
    <div className="vela-helm-clock" data-variant={variant} aria-hidden="true">
      <span className="vela-helm-clock__time" role="img" aria-label={label}>
        {digits.slice(0, 2).map((digit, index) => (
          <RollerDigit key={`h${index}`} digit={digit} />
        ))}
        <ClockColon />
        {digits.slice(2, 4).map((digit, index) => (
          <RollerDigit key={`m${index}`} digit={digit} />
        ))}
        <span className="vela-helm-clock__seconds">
          <ClockColon />
          {digits.slice(4, 6).map((digit, index) => (
            <RollerDigit key={`s${index}`} digit={digit} />
          ))}
        </span>
      </span>
      <span className="vela-helm-clock__date">{dateText(now, locale)}</span>
    </div>
  );
}
