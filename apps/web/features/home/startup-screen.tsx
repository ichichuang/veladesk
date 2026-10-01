"use client";

import { useEffect, useRef } from "react";

import { gsap } from "@components/vd/gsap";
import { useVdReducedMotion } from "@components/vd/reduced-motion";
import { BrandLogo } from "@components/vd/brand-logo";
import { useVdAmbientDrift } from "@components/vd/ambient-drift";
import { useI18n } from "../i18n/use-i18n";

/**
 * Minimal ambient boot screen (018: real brand mark; 022: GSAP-owned
 * motion). The product logo at a calm size, one status line, one light
 * pulse — honest loading feedback only, no invented progress and no
 * artificial readiness delay. The pulse sweep is an owned infinite GSAP
 * tween (the CSS `vela-pulse` keyframes are gone); the ambient backdrop
 * drifts through {@link useVdAmbientDrift}. Reduced motion: static pulse
 * bar, static backdrop.
 */
export function StartupScreen() {
  const { t } = useI18n();
  const ambientRef = useRef<HTMLDivElement | null>(null);
  const pulseThumbRef = useRef<HTMLSpanElement | null>(null);
  const reducedMotion = useVdReducedMotion();
  useVdAmbientDrift(ambientRef, { durationSeconds: 26 });

  useEffect(() => {
    const thumb = pulseThumbRef.current;
    if (thumb === null || reducedMotion) {
      return;
    }
    const tween = gsap.fromTo(
      thumb,
      { xPercent: -110 },
      { xPercent: 370, duration: 1.6, ease: "sine.inOut", repeat: -1 },
    );
    return () => {
      tween.kill();
    };
  }, [reducedMotion]);

  return (
    <main className="vela-boot" role="status">
      <div className="vela-boot__ambient" aria-hidden="true" ref={ambientRef} />
      <div className="vela-boot__content">
        <BrandLogo size={72} className="vela-boot__logo" />
        <p className="vela-boot__status">{t("startup.status")}</p>
        <div className="vela-boot__pulse" aria-hidden="true">
          <span className="vela-boot__pulse-thumb" ref={pulseThumbRef} />
        </div>
      </div>
    </main>
  );
}
