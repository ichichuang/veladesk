"use client";

import { useCallback, useRef } from "react";
import type { HTMLAttributes, Ref } from "react";

import { useVdScrollbar } from "./use-vd-scrollbar";
import { useVdSmoothScroll } from "./smooth-scroll";

/**
 * Canonical independent scroll surface. OverlayScrollbars decorates the
 * host without reparenting React children; Lenis smooths wheel and keyboard
 * input by default. Touch and programmatic writes retain native ownership.
 * Visuals and timing come from packages/ui's --vd-scrollbar-* tokens.
 * Wheel scope stays an explicit per-surface navigation decision.
 */

export type VdScrollAxis = "y" | "x" | "both";

export interface VdScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  /** Which overflow axis this surface owns. Defaults to `"y"`. */
  axis?: VdScrollAxis;
  /** Enable Lenis interpolation (default true). */
  smooth?: boolean;
  /** Wheel-scope marker consumed by the section navigation model. */
  "data-vd-wheel-scope"?: string;
  /** Host ref for the scroll element (React 19 ref-as-prop). */
  readonly ref?: Ref<HTMLDivElement>;
}

export function VdScrollArea({
  axis = "y",
  smooth = true,
  className,
  ref,
  ...props
}: VdScrollAreaProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useVdScrollbar(hostRef, axis);
  useVdSmoothScroll(hostRef, smooth);
  const setHostRef = useCallback(
    (node: HTMLDivElement | null) => {
      hostRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref !== null && ref !== undefined) {
        (ref as { current: HTMLDivElement | null }).current = node;
      }
    },
    [ref],
  );
  return <div ref={setHostRef} tabIndex={0} data-vd-scroll={axis} className={className} {...props} />;
}
