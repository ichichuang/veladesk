"use client";

import { useEffect, useRef } from "react";

import { Loader2 } from "lucide-react";

import { gsap } from "./gsap";
import { cn } from "@components/ui/cn";
import { useVdReducedMotion } from "./reduced-motion";

/**
 * VdLoadingIndicator (task 022): the ONE product spinner. The rotation is
 * an owned infinite GSAP tween (replacing the Tailwind `animate-spin`
 * keyframe) on a single node, driven by GSAP's rAF ticker — so it stops
 * advancing when the tab is hidden or the surface unmounts, and
 * `active=false` (no longer pending) removes it. Reduced motion renders a
 * static glyph: pending state stays visible, nothing rotates.
 *
 * Determinate progress, where a product surface ever has one, must show
 * real values — this component is indeterminate-only by design.
 */
export function VdLoadingIndicator({
  size = 14,
  active = true,
  className,
}: {
  readonly size?: number;
  readonly active?: boolean;
  readonly className?: string;
}) {
  const reducedMotion = useVdReducedMotion();
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    if (!active || reducedMotion) {
      gsap.killTweensOf(element);
      gsap.set(element, { rotation: 0 });
      return;
    }
    const tween = gsap.to(element, {
      rotation: 360,
      duration: 1,
      ease: "none",
      repeat: -1,
      transformOrigin: "50% 50%",
    });
    return () => {
      tween.kill();
    };
  }, [active, reducedMotion]);

  return (
    <span
      ref={ref}
      className={cn("inline-flex shrink-0", className)}
      data-vd-loading={active ? "true" : "false"}
    >
      <Loader2 size={size} aria-hidden="true" />
    </span>
  );
}
