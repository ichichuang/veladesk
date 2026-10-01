"use client";

import { useLayoutEffect, useRef } from "react";

import { gsap } from "./gsap";
import { VD_MOTION_EASE, vdMotionDuration } from "./motion-tokens";
import { useVdReducedMotion } from "./reduced-motion";

/**
 * VdAnimatedIndicator (task 022, repaired 022-R2; horizontal axis 026-R2):
 * a quiet absolutely-positioned marker that glides to the active item of a
 * list — the vertical section rail, or the mobile horizontal category
 * tabs.
 *
 * The target is RESOLVED at activation time (never stored across renders
 * and never a document-wide lookup): `resolveTarget(activeKey, container)`
 * finds the item element — both callers feed it direct per-item refs. The
 * FIRST placement settles without a tween (no sweep from a stale corner);
 * a reduced-motion preference pins the marker instantly; every later
 * CATEGORY change tweens from the current valid position. Before a valid
 * target and box exist the marker stays HIDDEN — it is never stretched
 * over the list and never guesses a row.
 *
 * AXIS (026-R2 §16): "vertical" (default — the desktop rail, byte-for-byte
 * unchanged) tweens top/height. "horizontal" (the mobile tabs) moves via
 * TRANSFORM x only — per-frame layout animation is forbidden there — and
 * the pill's WIDTH is written exactly once per placement with gsap.set
 * (never tweened), so the only per-frame work is compositing.
 *
 * 022-R2 container arrival: the container arrives as an ELEMENT PROP, not
 * a ref (see below). Geometry that changes WITHOUT an activation change
 * (rows reordered/added/removed, a row or the container resizing) re-
 * places the marker on the SAME row through an instant gsap.set — never a
 * tween, never a timer, never per-frame React: the caller's
 * `remeasureToken` (row-set identity) re-runs the layout math, and a
 * ResizeObserver on the row and the container catches later box changes.
 * The corrector stands down while an activation tween owns the marker, so
 * it can never snap the glide.
 */
export function VdAnimatedIndicator({
  container,
  activeKey,
  resolveTarget,
  remeasureToken,
  axis = "vertical",
  className,
  "aria-hidden": ariaHidden = true,
}: {
  /**
   * The positioned ancestor the marker lives in and is measured against —
   * an element PROP (ref-arrival safe; null keeps the marker hidden).
   */
  readonly container: HTMLElement | null;
  /** The current activation key (item id); null hides the marker. */
  readonly activeKey: string | null;
  /** Finds the item element for a key INSIDE the container. */
  readonly resolveTarget: (key: string, container: HTMLElement) => HTMLElement | null;
  /**
   * Row-set identity (item ids in order): changes when the rows are
   * reordered, added or removed WITHOUT an activation change, re-measuring
   * the same active row. Omit when the list is static.
   */
  readonly remeasureToken?: string | undefined;
  /**
   * "vertical" (default): the rail's top/height tween. "horizontal": the
   * mobile tabs' transform-x glide with a once-per-placement width set
   * (026-R2 §16 — no per-frame layout animation in horizontal mode).
   */
  readonly axis?: "vertical" | "horizontal";
  readonly className?: string;
  readonly "aria-hidden"?: boolean | "true";
}) {
  const reducedMotion = useVdReducedMotion();
  const ref = useRef<HTMLSpanElement | null>(null);
  const placedRef = useRef(false);
  /**
   * The key the last placement was made for: distinguishes an ACTIVATION
   * change (glide) from a token-only re-measure (row set moved — snap).
   */
  const placedKeyRef = useRef<string | null>(null);
  /**
   * True while an activation tween owns the marker: the geometry corrector
   * must not write during the glide (its set would snap the marker and the
   * tween would start from the snapped pose).
   */
  const placingRef = useRef(false);

  // Activation change: hide / first-place (set) / glide (tween). A
  // token-only change (rows reordered/changed, same active row) re-measures
  // through the set path — only CATEGORY changes animate.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || container === null) {
      return;
    }
    const horizontal = axis === "horizontal";
    const activationChanged = placedKeyRef.current !== activeKey;
    placedKeyRef.current = activeKey;
    const target = activeKey === null ? null : resolveTarget(activeKey, container);
    // One coordinate space: the row must measure against the very container
    // the marker is positioned in (offsetParent null = no layout engine —
    // DOM-emulated tests inject boxes; the browser always resolves one).
    const sharesSpace =
      target !== null && (target.offsetParent === null || target.offsetParent === container);
    if (target === null || !sharesSpace) {
      gsap.set(element, { opacity: 0 });
      placedRef.current = false;
      placingRef.current = false;
      return;
    }
    // Horizontal mode: the pill's width is part of the REST geometry —
    // written once per placement, never tweened (026-R2 §16).
    if (horizontal) {
      gsap.set(element, { width: target.offsetWidth });
    }
    const destination = horizontal
      ? { x: target.offsetLeft, opacity: 1 }
      : { top: target.offsetTop, height: target.offsetHeight, opacity: 1 };
    if (reducedMotion || !placedRef.current || !activationChanged) {
      gsap.set(element, destination);
      placedRef.current = true;
      return;
    }
    const tween = gsap.to(element, {
      ...destination,
      duration: vdMotionDuration("indicator"),
      ease: VD_MOTION_EASE,
      overwrite: "auto",
      onComplete: () => {
        placingRef.current = false;
      },
    });
    placingRef.current = true;
    return () => {
      tween.kill();
      placingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveTarget is a stable identity owned by the caller
  }, [container, activeKey, reducedMotion, remeasureToken, axis]);

  // Geometry re-validation (022-R2): correct the marker's box when the
  // LAYOUT moved without an activation change — the token (row set
  // reordered/changed) re-runs this effect, and the ResizeObserver catches
  // later row/container box changes (font swap, wrap, resize). Instant
  // gsap.set only: an activation tween owns the glide, and a geometry
  // correction is never itself animated.
  useLayoutEffect(() => {
    const element = ref.current;
    if (
      element === null ||
      container === null ||
      activeKey === null ||
      !placedRef.current ||
      typeof ResizeObserver !== "function"
    ) {
      return;
    }
    const target = resolveTarget(activeKey, container);
    if (target === null) {
      return;
    }
    const replace = () => {
      if (placingRef.current) {
        return; // the activation glide owns the marker right now
      }
      if (target.offsetParent !== null && target.offsetParent !== container) {
        return;
      }
      if (axis === "horizontal") {
        gsap.set(element, { width: target.offsetWidth, x: target.offsetLeft, opacity: 1 });
      } else {
        gsap.set(element, { top: target.offsetTop, height: target.offsetHeight, opacity: 1 });
      }
    };
    replace();
    const observer = new ResizeObserver(replace);
    observer.observe(target);
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveTarget is a stable identity owned by the caller
  }, [container, activeKey, remeasureToken, axis]);

  return (
    <span
      ref={ref}
      className={className}
      aria-hidden={ariaHidden}
      data-vd-indicator=""
    />
  );
}
