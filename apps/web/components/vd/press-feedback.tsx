"use client";

import { forwardRef, useLayoutEffect, useRef } from "react";
import type { HTMLAttributes } from "react";

import { cn } from "@components/ui/cn";

import { gsap } from "./gsap";
import { VD_MOTION_EASE, vdMotionDuration } from "./motion-tokens";
import { useVdReducedMotion } from "./reduced-motion";

/**
 * VdPressFeedback (task 022): the press-scale wrapper for controls. The
 * scale lives on this INNER span, so the control's hit geometry (the
 * button itself) stays stable while the visual compresses. One owned,
 * retargetable tween per press state change — never a new overlapping
 * tween per pointer event; under reduced motion the visual state changes
 * instantly (no scale animation at all).
 */
export interface VdPressFeedbackProps extends HTMLAttributes<HTMLSpanElement> {
  /** True while the pointer is down on the owning control. */
  readonly pressed: boolean;
  readonly children: React.ReactNode;
}

export const VdPressFeedback = forwardRef<HTMLSpanElement, VdPressFeedbackProps>(
  function VdPressFeedback({ pressed, className, children, ...rest }, forwardedRef) {
    const reducedMotion = useVdReducedMotion();
    const innerRef = useRef<HTMLSpanElement | null>(null);

    useLayoutEffect(() => {
      const element = innerRef.current;
      if (element === null) {
        return;
      }
      if (reducedMotion) {
        gsap.set(element, { scale: 1 });
        return;
      }
      const tween = gsap.to(element, {
        scale: pressed ? 0.97 : 1,
        duration: vdMotionDuration("hoverPress"),
        ease: VD_MOTION_EASE,
        overwrite: "auto",
      });
      return () => {
        tween.kill();
      };
    }, [pressed, reducedMotion]);

    return (
      <span
        ref={(node) => {
          innerRef.current = node;
          if (typeof forwardedRef === "function") {
            forwardedRef(node);
          } else if (forwardedRef !== null) {
            forwardedRef.current = node;
          }
        }}
        data-vd-press={pressed ? "true" : "false"}
        className={cn("inline-flex items-center justify-center gap-[inherit]", className)}
        {...rest}
      >
        {children}
      </span>
    );
  }
);
