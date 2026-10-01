"use client";

import { forwardRef, useLayoutEffect, useRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";

import { gsap } from "./gsap";
import { VD_MOTION_EASE, vdMotionDuration } from "./motion-tokens";
import { useVdReducedMotion } from "./reduced-motion";

/**
 * VdAnimatedSurface (task 022): the INNER visual surface for overlays —
 * the GSAP-owned layer that sits inside a library-owned positioning node
 * (a Radix Dialog Content, a fixed centered wrapper, a floating popover
 * node). GSAP never writes a positioning transform here; every variant
 * animates opacity plus a small y/scale/x settle that is independent of
 * how the surface is placed.
 *
 * Lifecycle (with `useVdPresence`):
 *  - A fresh mount applies the hidden pose SYNCHRONOUSLY in the layout
 *    phase — the first painted frame is the entrance's start pose, never
 *    a flash of the resting surface.
 *  - `active=true` runs one enter tween; `active=false` runs one exit
 *    tween whose completion reports `onPresenceReleased` exactly once.
 *  - Re-opening mid-exit kills nothing but the direction: the SAME tween
 *    slot retargets from the surface's CURRENT values, so no snap and no
 *    remount.
 *  - Reduced motion: poses settle instantly and an exit releases presence
 *    immediately — product state never waits for an animation.
 *
 * The exit is slightly quicker than the entrance (the 018 contract).
 */

export type VdSurfaceVariant =
  | "overlay"
  | "dialog"
  | "panel"
  | "popup"
  | "tooltip"
  | "launcher"
  | "recognition";

interface SurfacePose {
  readonly hidden: { opacity: number; y?: number; x?: number; scale?: number };
  readonly shown: { opacity: 1; y: 0; x: 0; scale: 1 };
  readonly duration: number;
  readonly exitDuration: number;
}

const EXIT_SCALE = 0.75;

function poseFor(variant: VdSurfaceVariant): SurfacePose {
  switch (variant) {
    case "overlay":
      return {
        hidden: { opacity: 0 },
        shown: { opacity: 1, y: 0, x: 0, scale: 1 },
        duration: vdMotionDuration("hoverPress"),
        exitDuration: vdMotionDuration("hoverPress"),
      };
    case "dialog":
      return {
        hidden: { opacity: 0, y: 8, scale: 0.985 },
        shown: { opacity: 1, y: 0, x: 0, scale: 1 },
        duration: vdMotionDuration("dialog"),
        exitDuration: vdMotionDuration("dialog") * EXIT_SCALE,
      };
    case "panel":
      return {
        hidden: { opacity: 0, x: 24 },
        shown: { opacity: 1, y: 0, x: 0, scale: 1 },
        duration: vdMotionDuration("inspector"),
        exitDuration: vdMotionDuration("inspector") * EXIT_SCALE,
      };
    case "popup":
    case "tooltip":
    case "recognition":
      return {
        hidden: { opacity: 0, y: 4 },
        shown: { opacity: 1, y: 0, x: 0, scale: 1 },
        duration:
          variant === "tooltip"
            ? vdMotionDuration("tooltip")
            : vdMotionDuration("popup"),
        exitDuration:
          variant === "tooltip"
            ? vdMotionDuration("tooltip")
            : vdMotionDuration("popup") * EXIT_SCALE,
      };
    case "launcher":
      return {
        hidden: { opacity: 0, y: 6, scale: 0.985 },
        shown: { opacity: 1, y: 0, x: 0, scale: 1 },
        duration: vdMotionDuration("popup"),
        exitDuration: vdMotionDuration("popup") * EXIT_SCALE,
      };
  }
}

export interface VdAnimatedSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  /** Requested visibility. Mount implies a fresh entrance. */
  readonly active: boolean;
  readonly variant: VdSurfaceVariant;
  /** Exit completion → presence release (from `useVdPresence`). */
  readonly onPresenceReleased?: (() => void) | undefined;
  readonly children?: ReactNode;
}

export const VdAnimatedSurface = forwardRef<HTMLDivElement, VdAnimatedSurfaceProps>(
  function VdAnimatedSurface(
    { active, variant, onPresenceReleased, children, ...rest },
    forwardedRef
  ) {
    const reducedMotion = useVdReducedMotion();
    const innerRef = useRef<HTMLDivElement | null>(null);
    const tweenRef = useRef<gsap.core.Tween | null>(null);
    const releasedRef = useRef(false);
    const releaseRef = useRef(onPresenceReleased);
    const reducedRef = useRef(reducedMotion);
    useLayoutEffect(() => {
      releaseRef.current = onPresenceReleased;
      reducedRef.current = reducedMotion;
    });

    // Fresh mount: the hidden pose is committed before the first paint.
    useLayoutEffect(() => {
      const element = innerRef.current;
      if (element === null || !active) {
        return;
      }
      const pose = poseFor(variant);
      gsap.set(element, { ...pose.hidden, scale: pose.hidden.scale ?? 1, x: pose.hidden.x ?? 0 });
      // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
    }, []);

    // Retarget-driven enter/exit. One tween slot; `.to()` always animates
    // from the CURRENT visual values, so re-opening mid-exit continues
    // from where the exit was instead of snapping.
    useLayoutEffect(() => {
      const element = innerRef.current;
      if (element === null) {
        return;
      }
      const pose = poseFor(variant);
      tweenRef.current?.kill();
      if (active) {
        releasedRef.current = false;
        element.style.pointerEvents = "";
        if (reducedMotion) {
          gsap.set(element, pose.shown);
          tweenRef.current = null;
          return;
        }
        tweenRef.current = gsap.to(element, {
          ...pose.shown,
          duration: pose.duration,
          ease: VD_MOTION_EASE,
          overwrite: "auto",
          onComplete: () => {
            tweenRef.current = null;
          },
        });
      } else {
        // Pointer-inert while the exit plays.
        element.style.pointerEvents = "none";
        if (reducedMotion) {
          gsap.set(element, { opacity: 0 });
          tweenRef.current = null;
          if (!releasedRef.current) {
            releasedRef.current = true;
            releaseRef.current?.();
          }
          return;
        }
        tweenRef.current = gsap.to(element, {
          ...pose.hidden,
          duration: pose.exitDuration,
          ease: VD_MOTION_EASE,
          overwrite: "auto",
          onComplete: () => {
            tweenRef.current = null;
            if (!releasedRef.current) {
              releasedRef.current = true;
              releaseRef.current?.();
            }
          },
        });
      }
      return () => {
        tweenRef.current?.kill();
        tweenRef.current = null;
      };
    }, [active, variant, reducedMotion]);

    return (
      <div
        ref={(node) => {
          innerRef.current = node;
          if (typeof forwardedRef === "function") {
            forwardedRef(node);
          } else if (forwardedRef !== null) {
            forwardedRef.current = node;
          }
        }}
        data-vd-surface={variant}
        {...rest}
      >
        {children}
      </div>
    );
  }
);

/**
 * Entrance-only surface for primitives that own their own unmount
 * (Radix popover/select/tooltip content): one mount tween from the hidden
 * pose; the library removes the node on close. No exit machinery.
 */
export function VdPopupSurface({
  variant,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  readonly variant: "popup" | "tooltip";
  readonly children?: ReactNode;
}) {
  const reducedMotion = useVdReducedMotion();
  const innerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = innerRef.current;
    if (element === null) {
      return;
    }
    const pose = poseFor(variant);
    if (reducedMotion) {
      gsap.set(element, pose.shown);
      return;
    }
    gsap.set(element, pose.hidden);
    const tween = gsap.to(element, {
      ...pose.shown,
      duration: pose.duration,
      ease: VD_MOTION_EASE,
    });
    return () => {
      tween.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only entrance
  }, []);

  return (
    <div ref={innerRef} data-vd-surface={variant} {...rest}>
      {children}
    </div>
  );
}
