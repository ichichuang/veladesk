"use client";

import { ClickScrollPlugin, OverlayScrollbars } from "overlayscrollbars";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import "overlayscrollbars/overlayscrollbars.css";

import type { VdScrollAxis } from "./scroll-area";

/**
 * The system scrollbar (t63): OverlayScrollbars on one scroll container,
 * themed entirely by the `--vd-scrollbar-*` tokens (accent-driven, see
 * packages/ui tokens.css `.os-theme-vd`).
 *
 * Initialization uses the HOST-AS-VIEWPORT form (`elements.viewport` returns
 * the target itself): OverlayScrollbars never re-parents the host's children
 * — it only appends its own overlay scrollbar nodes and sets inline overflow
 * on the host — so React keeps owning its subtree, and the host REMAINS the
 * real `scrollTop` element. Every existing scroll reader/writer (scroll
 * memory, restore-on-mount, the drag session, dnd-kit's auto-scroll via
 * getScrollableAncestors) keeps touching the same element.
 *
 * Behavior contract (t63):
 * - auto: nothing shows while the content fits (`visibility: "auto"`).
 * - fade: the bars appear on scroll and fade out ~1s after it stops
 *   (`autoHide: "move"`, `autoHideDelay: 1000`).
 * - interactive: the handle is draggable and the track is clickable
 *   (`dragScroll`, `clickScroll`).
 * - native scrollbars are fully suppressed (OverlayScrollbars sets
 *   `scrollbar-width: none` on the host), so no native gutter ever appears.
 *
 * Reduced motion is handled in CSS (tokens.css kills the `.os-scrollbar`
 * transitions under the media query). jsdom (unit tests) has no matchMedia;
 * the surface degrades to the plain native scrollbar styling.
 */
export function useVdScrollbar(
  ref: RefObject<HTMLElement | null>,
  axis: VdScrollAxis,
): void {
  const managed = useRef<{ host: HTMLElement; axis: VdScrollAxis; dispose: () => void } | null>(null);
  useEffect(() => {
    const host = ref.current;
    if (managed.current?.host === host && managed.current.axis === axis) return;
    managed.current?.dispose();
    managed.current = null;
    if (host === null || typeof window.matchMedia !== "function") {
      return;
    }
    const originalPosition = host.style.position;
    const position = getComputedStyle(host).position;
    OverlayScrollbars.plugin(ClickScrollPlugin);
    const instance = OverlayScrollbars({ target: host, elements: { viewport: host } }, {
      overflow: {
        x: axis === "y" ? "hidden" : "scroll",
        y: axis === "x" ? "hidden" : "scroll",
      },
      scrollbars: {
        theme: "os-theme-vd",
        visibility: "auto",
        autoHide: "move",
        autoHideDelay: Number.parseFloat(getComputedStyle(host).getPropertyValue("--vd-scrollbar-idle-ms")) || 1000,
        dragScroll: true,
        clickScroll: true,
      },
    });
    // The library's [data-overlayscrollbars] rule sets position: relative.
    // Keep fixed/absolute/sticky hosts in their existing coordinate space.
    if (position !== "static") host.style.position = position;
    managed.current = { host, axis, dispose: () => {
      instance.destroy();
      host.style.position = originalPosition;
    } };
  });
  useEffect(() => () => {
    managed.current?.dispose();
    managed.current = null;
  }, []);
}
