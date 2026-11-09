"use client";

import { useCallback, useRef } from "react";
import type { HTMLAttributes, Ref } from "react";

import { useVdSmoothScroll } from "./smooth-scroll";

/**
 * VdScrollArea (task 021-A) — the ONE canonical scroll surface.
 *
 * A deliberately thin owner of NATIVE scrolling: it emits `data-vd-scroll`
 * (plus `data-vd-scroll` value = axis) and nothing else, and every visual
 * scrollbar rule lives in the token layer (`@veladesk/ui` tokens.css,
 * `[data-vd-ui] [data-vd-scroll]`). No custom scrollbar widgets, no scroll
 * event React state, no ResizeObserver — wheel, touch and keyboard
 * scrolling stay exactly the browser's, only restyled.
 *
 * Axis: `"y"` (default) owns vertical overflow with a stable gutter so
 * appearing scrollbars never resize the content; `"x"` owns horizontal
 * overflow (dock); `"both"` owns both. The attribute — not Tailwind
 * overflow classes — must own the overflow of any migrated surface.
 *
 * `smooth` (P1) opts the surface into Lenis interpolation — for
 * independent overlay panes/lists ONLY (Settings, launcher results, icon
 * picker, folder overlay), never the fixed app frame. Reduced motion
 * turns it off inside the hook; the native surface is unchanged either
 * way.
 *
 * Wheel scoping (`data-vd-wheel-scope`) is deliberately NOT emitted here:
 * it marks interactive overlay scrollers whose wheel must not page the
 * section stack (017/018 contract) and stays an explicit per-surface call.
 */

export type VdScrollAxis = "y" | "x" | "both";

export interface VdScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  /** Which overflow axis this surface owns. Defaults to `"y"`. */
  axis?: VdScrollAxis;
  /** Opt into Lenis smooth scrolling (independent panes/lists only). */
  smooth?: boolean;
  /** Wheel-scope marker consumed by the section navigation model. */
  "data-vd-wheel-scope"?: string;
  /** Host ref for the scroll element (React 19 ref-as-prop). */
  readonly ref?: Ref<HTMLDivElement>;
}

export function VdScrollArea({
  axis = "y",
  smooth = false,
  className,
  ref,
  ...props
}: VdScrollAreaProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
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
  return <div ref={setHostRef} data-vd-scroll={axis} className={className} {...props} />;
}
