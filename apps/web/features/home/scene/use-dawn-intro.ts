"use client";

import type { RefObject } from "react";
import { useLayoutEffect } from "react";

import { gsap } from "@components/vd/gsap";
import { VD_MOTION_DAWN, VD_MOTION_EASES } from "@components/vd/motion-tokens";
import { useVdReducedMotion } from "@components/vd/reduced-motion";

/**
 * The Dawn opening (P1, motion-spec-p1 §2) — the signature moment, GSAP.
 *
 * Budget: first frame to fully settled ≤ 300ms (VD_MOTION_DAWN.total is
 * the hard ceiling). The desktop paints completely and stays interactive
 * throughout — the timeline only drives OVERLAY nodes (the horizon band,
 * the brightness veil) plus a per-tile opacity/y reveal that never blocks
 * pointers. Sequence:
 *
 *   0–180ms  the horizon band rises (scaleY 0→1, y 8→0) while the
 *            full-frame brightness veil fades 0.6→0;
 *   60–280ms the tile layer reveals (opacity 0→1, y 6→0) staggered by
 *            distance from the horizon (12ms per step, ≤ 80ms total);
 *   280–300ms the bright burst fades out and the timeline ends.
 *
 * Gating: the whole moment hangs behind the `motion.experiments.helmMotion`
 * switch (supplied by the shell as `enabled`) AND plays at most once per
 * tab session — a same-session reopen within 5s, or a bfcache restore,
 * renders statically. Reduced motion never plays it: the scene renders in
 * its final state immediately (the spec's "或直接静态" downgrade).
 *
 * Interruptible: any pointer/keyboard/wheel input during the timeline
 * jumps it to `progress(1)` — the settled state — and ⌘K never waits.
 * The cleanup path clears every GSAP property it touched, so a killed
 * intro can never leave a tile hidden.
 */

/** Module-scoped session memory — survives bfcache restores with the tab. */
let dawnOpeningPlayed = false;

/**
 * Whether the Dawn opening may play for THIS mount. Pure except for the
 * session bookkeeping (the flag is only written on an accepted play).
 * The moment plays at most ONCE per tab session (a cold new-tab open —
 * spec §2 covers rapid remounts and bfcache restores alike: the module
 * state survives both with the tab, so every later mount renders
 * statically). Exported for tests.
 */
export function shouldPlayDawnOpening(_now: number, navigationType: string): boolean {
  if (navigationType === "back_forward") {
    // bfcache restore: static per spec §2.
    return false;
  }
  if (dawnOpeningPlayed) {
    return false;
  }
  dawnOpeningPlayed = true;
  return true;
}

/** Resets the session memory (tests only). */
export function resetDawnOpeningSessionForTests(): void {
  dawnOpeningPlayed = false;
}

/** The navigation type of this document, or "navigate" when unknown. */
function currentNavigationType(): string {
  try {
    const entry = performance.getEntriesByType("navigation")[0];
    return entry instanceof PerformanceNavigationTiming ? entry.type : "navigate";
  } catch {
    return "navigate";
  }
}

interface IntroTargets {
  readonly scope: RefObject<HTMLElement | null>;
  readonly band: RefObject<HTMLElement | null>;
  readonly veil: RefObject<HTMLElement | null>;
}

/**
 * Collects the visible tile BODIES inside the scope, sorted by distance
 * from the horizon (bottom of the frame first — the reveal starts where
 * the light starts). Warm/hidden layers, zero-box stragglers and the
 * inspector affordance never join the reveal.
 */
function collectIntroTiles(scope: HTMLElement): readonly HTMLElement[] {
  const candidates = Array.from(scope.querySelectorAll<HTMLElement>(".vela-item__body"));
  const visible = candidates.filter((element) => {
    if (element.closest("[data-warm-hidden='true'], [inert]") !== null) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  visible.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
  return visible;
}

export interface UseDawnIntroInput extends IntroTargets {
  /** The helmMotion experiment switch — false renders the static scene. */
  readonly enabled: boolean;
}

export function useDawnIntro(input: UseDawnIntroInput): void {
  const { enabled, scope, band, veil } = input;
  const reducedMotion = useVdReducedMotion();

  useLayoutEffect(() => {
    if (!enabled || reducedMotion) {
      return;
    }
    const scopeElement = scope.current;
    const bandElement = band.current;
    const veilElement = veil.current;
    if (scopeElement === null || bandElement === null || veilElement === null) {
      return;
    }
    if (!shouldPlayDawnOpening(Date.now(), currentNavigationType())) {
      return;
    }

    const tiles = collectIntroTiles(scopeElement);
    const burstElement = bandElement.querySelector<HTMLElement>(".vela-dawn-horizon__burst");
    const timeline = gsap.timeline({
      // settle: the timeline dies with its inline styles cleared — the CSS
      // rest state (band in place, veil/burst at opacity 0) IS the end
      // state, so a late kill can never leave a ghost veil.
      onComplete: () => {
        gsap.set([bandElement, veilElement, ...tiles], { clearProps: "opacity,transform" });
        if (burstElement !== null) {
          gsap.set(burstElement, { clearProps: "opacity" });
        }
      },
    });

    // 0–180ms: the band rises from the waterline; the veil recedes.
    timeline.fromTo(
      bandElement,
      { scaleY: 0, y: 8 },
      { scaleY: 1, y: 0, duration: VD_MOTION_DAWN.horizon, ease: VD_MOTION_EASES.standard },
      0,
    );
    timeline.fromTo(
      veilElement,
      { opacity: 0.6 },
      { opacity: 0, duration: VD_MOTION_DAWN.horizon, ease: VD_MOTION_EASES.standard },
      0,
    );

    // 60–280ms: tile reveal, staggered from the horizon. Every tween is
    // END-ALIGNED at revealStart + reveal so the whole layer settles inside
    // the total budget no matter how deep the field is (per-tile duration
    // shrinks by the stagger step; the spread stays ≤ staggerCap).
    if (tiles.length > 0) {
      const maxDelay = VD_MOTION_DAWN.staggerCap - VD_MOTION_DAWN.stagger;
      for (const [index, tile] of tiles.entries()) {
        const delay = Math.min(index * VD_MOTION_DAWN.stagger, maxDelay);
        timeline.fromTo(
          tile,
          { opacity: 0, y: 6 },
          {
            opacity: 1,
            y: 0,
            duration: VD_MOTION_DAWN.reveal - delay,
            ease: VD_MOTION_EASES.standard,
          },
          VD_MOTION_DAWN.revealStart + delay,
        );
      }
    }

    // The burst lights with the band and dies in the closing tail
    // (settle → total), easing out with the exit curve.
    if (burstElement !== null) {
      const burstFadeStart = VD_MOTION_DAWN.revealStart + VD_MOTION_DAWN.reveal;
      timeline.set(burstElement, { opacity: 1 }, 0);
      timeline.to(
        burstElement,
        {
          opacity: 0,
          duration: VD_MOTION_DAWN.total - burstFadeStart,
          ease: VD_MOTION_EASES.exit,
        },
        burstFadeStart,
      );
    }

    timeline.play();

    // Interruptibility (spec §2): any real input settles the timeline at
    // once — progress(1) fires the settle above and input keeps flowing.
    const settle = () => {
      timeline.progress(1);
    };
    const interruptEvents: readonly (keyof WindowEventMap)[] = [
      "pointerdown",
      "keydown",
      "wheel",
      "touchstart",
    ];
    for (const event of interruptEvents) {
      window.addEventListener(event, settle, { capture: true, passive: true });
    }
    return () => {
      for (const event of interruptEvents) {
        window.removeEventListener(event, settle, { capture: true } as EventListenerOptions);
      }
      timeline.kill();
      gsap.set([bandElement, veilElement, ...tiles], { clearProps: "opacity,transform" });
      if (burstElement !== null) {
        gsap.set(burstElement, { clearProps: "opacity" });
      }
    };
    // The intro is a mount moment: it must never restart on re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-scoped by design; ref contents and the guards are stable within a mount
  }, [enabled, reducedMotion]);
}
