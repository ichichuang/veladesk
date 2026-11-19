"use client";

import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

import { gsap } from "@components/vd/gsap";
import { VD_MOTION_EASE, vdMotionDuration } from "@components/vd/motion-tokens";
import { useVdReducedMotion } from "@components/vd/reduced-motion";
import { useVdPresence } from "@components/vd/presence";

/**
 * One settings row's reveal/collapse (user-report fix, background audit
 * round 2): a row whose EXISTENCE depends on another control — e.g.
 * 分区背景模式 disappears while a per-mode wallpaper layer is edited —
 * must never pop the pane's layout. The row expands from height 0 (with
 * its flex GAP compensated through the margin) and collapses back on the
 * control-state token, the same presence pattern as the workspace menu's
 * exiting rows. Reduced motion mounts and unmounts instantly.
 *
 * `gapPx` is the host container's flex gap: the wrapper hides exactly one
 * gap while collapsed, so neighbours glide instead of jumping.
 */
export function SettingsReveal({
  open,
  gapPx = 20,
  children,
}: {
  readonly open: boolean;
  /** The host flex container's gap in px (default: the settings gap-5). */
  readonly gapPx?: number;
  readonly children: ReactNode;
}) {
  const { mounted, completeExit } = useVdPresence(open);
  const ref = useRef<HTMLDivElement | null>(null);
  const reduced = useVdReducedMotion();
  const exitRef = useRef(completeExit);
  useLayoutEffect(() => {
    exitRef.current = completeExit;
  });

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    const collapseMargin = `${-gapPx}px`;
    if (reduced) {
      gsap.set(element, { clearProps: "height,marginTop,opacity,overflow" });
      if (!open) {
        exitRef.current();
      }
      return;
    }
    gsap.killTweensOf(element);
    if (open) {
      // Enter: pre-paint the collapsed pose (zero height AND the gap
      // still hidden), then expand into place.
      const tween = gsap.fromTo(
        element,
        { height: 0, marginTop: collapseMargin, opacity: 0, overflow: "hidden" },
        {
          height: "auto",
          marginTop: 0,
          opacity: 1,
          duration: vdMotionDuration("controlState"),
          ease: VD_MOTION_EASE,
          onComplete: () => {
            gsap.set(element, { clearProps: "height,marginTop,opacity,overflow" });
          },
        },
      );
      return () => {
        tween.kill();
        gsap.set(element, { clearProps: "height,marginTop,opacity,overflow" });
      };
    }
    // Exit: shrink AND fold the gap away, so the rows below glide up by
    // exactly the distance they will travel when the node unmounts.
    const tween = gsap.to(element, {
      height: 0,
      marginTop: collapseMargin,
      opacity: 0,
      overflow: "hidden",
      duration: vdMotionDuration("controlState"),
      ease: VD_MOTION_EASE,
      onComplete: () => {
        exitRef.current();
      },
    });
    return () => {
      tween.kill();
      gsap.set(element, { clearProps: "height,marginTop,opacity,overflow" });
    };
  }, [open, reduced, gapPx]);

  if (!mounted) {
    return null;
  }
  return (
    <div ref={ref} inert={!open || undefined} aria-hidden={!open || undefined}>
      {children}
    </div>
  );
}
