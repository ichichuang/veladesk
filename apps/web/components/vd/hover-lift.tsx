"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import { gsap } from "./gsap";
import { VD_MOTION_EASE, vdMotionDuration } from "./motion-tokens";
import { useVdReducedMotion } from "./reduced-motion";

/**
 * useVdHoverLift (task 022): the decorative hover lift for large surfaces
 * (desktop tiles in View mode, dock icons). GSAP owns the interpolation —
 * one retargetable tween per node (`overwrite: "auto"` keeps exactly one
 * owner), 0.16s, on the INNER visual node so hit geometry and drag
 * transforms (dnd-kit on the item root) are never touched. Reduced motion
 * renders the lift statically: no tween, no movement.
 *
 * Destructure the return at the call site (`const { innerRef, ... } =`)
 * and spread NOTHING — the handlers are stable callbacks; the ref goes to
 * one inner node. Arrange-mode tiles deliberately do NOT use this hook —
 * hover must never compete with a live drag/resize transform.
 */
export function useVdHoverLift<HTMLHostElement extends HTMLElement = HTMLElement>(
  offset = -2,
): {
  /** Ref for the INNER visual node the transform applies to. */
  readonly innerRef: RefObject<HTMLElement | null>;
  readonly onPointerEnter: (event: ReactPointerEvent<HTMLHostElement>) => void;
  readonly onPointerLeave: (event: ReactPointerEvent<HTMLHostElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLHostElement>) => void;
} {
  const reducedMotion = useVdReducedMotion();
  const innerRef = useRef<HTMLElement | null>(null);
  /** Latest-value mirrors (assigned in effects, never during render). */
  const offsetRef = useRef(offset);
  const reducedRef = useRef(reducedMotion);
  useEffect(() => {
    offsetRef.current = offset;
    reducedRef.current = reducedMotion;
  });

  const lift = useCallback((y: number) => {
    const inner = innerRef.current;
    if (inner === null) {
      return;
    }
    gsap.to(inner, {
      y,
      duration: vdMotionDuration("hoverPress"),
      ease: VD_MOTION_EASE,
      overwrite: "auto",
    });
  }, []);

  const onPointerEnter = useCallback(() => {
    if (!reducedRef.current) {
      lift(offsetRef.current);
    }
  }, [lift]);

  const onPointerLeave = useCallback(() => {
    lift(0);
  }, [lift]);

  const onPointerCancel = useCallback(() => {
    lift(0);
  }, [lift]);

  return { innerRef, onPointerEnter, onPointerLeave, onPointerCancel };
}
