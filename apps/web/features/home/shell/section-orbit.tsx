"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import type { DesktopPage, DesktopPageId } from "@veladesk/domain";

import { gsap } from "@components/vd/gsap";
import { VD_MOTION_ORBIT, VD_MOTION_EASES } from "@components/vd/motion-tokens";
import { useVdReducedMotion } from "@components/vd/reduced-motion";

import { useI18n } from "../../i18n/use-i18n";
import {
  contextMenuAnchorFromElement,
  isContextMenuKeyEvent,
} from "../context-menu";
import {
  advanceWheelNav,
  normalizeWheelEvent,
  resetWheelNav,
  stepSectionIndex,
} from "../section-wheel-nav";
import type { WheelNavState } from "../section-wheel-nav";
import "../home-shell.css";

/*
 * The space ORBIT (Helm first picture, 2026-11-10) — the decision the
 * director delegated: the left title rail became a half-visible orbit ring
 * on the right edge. Why this over a restyled vertical rail:
 *
 *  1. It is the memorable move — keyframe A's composition ("右侧露出半个
 *     「在家」空间轨道环") and the one element no other start page has; the
 *     vertical title list is exactly the "2015 nav site" reading Chris
 *     rejected.
 *  2. It frees the left edge, so the desktop reads as one full-bleed scene
 *     (horizon under the tiles) instead of an admin layout with a sidebar.
 *  3. Usability is preserved 1:1 from the rail: click / Enter / Space to
 *     switch, ArrowUp/Down + Home/End roving focus, wheel navigation over
 *     the whole column (same pure intent model), per-section context menu,
 *     and the active space is always named in a chip beside its dot.
 *
 * Geometry: the sections sit as chart waypoints on one large ellipse whose
 * center hangs off the right edge — param t runs top→bottom along the LEFT
 * half (t=0.5 is the ring's closest point to the workspace). Switching
 * spaces sends a small comet gliding along the ring (orbit.travel +
 * ease.travel, the camera easing) while the section pair slide runs in the
 * viewport; the arrival dot lights up in the accent glow. Reduced motion:
 * no comet, the dot lights instantly.
 */

/** The orbit strip's fixed width (px) carved out of the desktop's right edge. */
const ORBIT_STRIP_PX = 300;
/**
 * The strip height used until the ResizeObserver reports the real one (and
 * in DOM-less test environments, where the observer never fires): a
 * typical desktop viewport. Wrong guesses last one frame in browsers and
 * keep the semantic DOM (the waypoint buttons) present everywhere.
 */
const ORBIT_STRIP_FALLBACK_HEIGHT_PX = 720;
/** The ellipse center's offset beyond the strip's right edge (px). */
const ORBIT_CENTER_OFFSET_PX = 20;
/** The ellipse's horizontal radius (px): the ring's closest approach. */
const ORBIT_RX_PX = 200;

/** Point on the ring's left half for param t ∈ [0,1] (top → bottom). */
function orbitPoint(
  t: number,
  height: number,
): { readonly x: number; readonly y: number } {
  const cy = height / 2;
  const ry = height * 0.34;
  const cx = ORBIT_STRIP_PX + ORBIT_CENTER_OFFSET_PX;
  return {
    x: cx - ORBIT_RX_PX * Math.sin(Math.PI * t),
    y: cy - ry * Math.cos(Math.PI * t),
  };
}

/** The param range the waypoints occupy — narrower rings for few sections. */
function orbitSpan(sectionCount: number): number {
  return Math.min(0.76, Math.max(0.24, 0.21 * (sectionCount - 1) + 0.08));
}

function sectionT(index: number, count: number): number {
  const span = orbitSpan(count);
  const start = 0.5 - span / 2;
  if (count <= 1) {
    return 0.5;
  }
  return start + (span * index) / (count - 1);
}

interface SectionOrbitProps {
  readonly pages: readonly DesktopPage[];
  readonly activePageId: DesktopPageId | null;
  /** Click / keyboard activation — switches the explicit active section. */
  readonly onSelectSection: (pageId: DesktopPageId) => void;
  readonly onSectionContextMenu: (pageId: DesktopPageId, x: number, y: number) => void;
  /** Orbit-surface (gaps) fallback: the shared desktop command menu. */
  readonly onOpenCommandMenu: (x: number, y: number) => void;
  /**
   * True while a drag/resize owns the desktop or any modal surface is up —
   * wheel navigation stands down entirely AND accumulated intent is
   * cleared, so nothing replays when the lock lifts.
   */
  readonly navigationLocked: boolean;
}

export function SectionOrbit({
  pages,
  activePageId,
  onSelectSection,
  onSectionContextMenu,
  onOpenCommandMenu,
  navigationLocked,
}: SectionOrbitProps) {
  const { t } = useI18n();
  const reducedMotion = useVdReducedMotion();
  const rootRef = useRef<HTMLElement | null>(null);
  const [stripHeight, setStripHeight] = useState<number | null>(null);
  const wheelStateRef = useRef<WheelNavState>(resetWheelNav());
  const cometRef = useRef<HTMLDivElement | null>(null);
  /** The comet's current param — the latest-value mirror for GSAP. */
  const cometTRef = useRef<number>(0.5);

  // Measure the strip (its height is the desktop viewport's). Positioning
  // needs it before the first paint of the dots.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height ?? 0;
      if (height > 0) {
        setStripHeight((current) => (current === height ? current : height));
      }
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // Latest-value mirrors: the wheel listener and the comet tween are stable
  // across renders, exactly like the rail's.
  const pagesRef = useRef(pages);
  const activePageIdRef = useRef(activePageId);
  const onSelectSectionRef = useRef(onSelectSection);
  const lockedRef = useRef(navigationLocked);

  useEffect(() => {
    pagesRef.current = pages;
    activePageIdRef.current = activePageId;
    onSelectSectionRef.current = onSelectSection;
  }, [pages, activePageId, onSelectSection]);

  useEffect(() => {
    lockedRef.current = navigationLocked;
    if (navigationLocked) {
      wheelStateRef.current = resetWheelNav();
    }
  }, [navigationLocked]);

  const activeIndex = Math.max(
    0,
    pages.findIndex((page) => page.id === activePageId),
  );

  // The comet: glide along the ring from the previous waypoint to the newly
  // active one. Interruptible — a rapid switch retargets from wherever the
  // comet currently is (the product motion rule: never jump back, never queue).
  // Layout effect so the FIRST placement lands before paint (no flash at
  // the strip's origin).
  useLayoutEffect(() => {
    const comet = cometRef.current;
    if (comet === null || pages.length === 0) {
      return;
    }
    const height = stripHeight ?? ORBIT_STRIP_FALLBACK_HEIGHT_PX;
    const targetT = sectionT(activeIndex, pages.length);
    const place = (t: number) => {
      const point = orbitPoint(t, height);
      comet.style.transform = `translate(${point.x}px, ${point.y}px)`;
    };
    if (reducedMotion) {
      cometTRef.current = targetT;
      place(targetT);
      return;
    }
    // Place at the CURRENT param synchronously (never the unset origin),
    // then glide to the target.
    place(cometTRef.current);
    const proxy = { t: cometTRef.current };
    const tween = gsap.to(proxy, {
      t: targetT,
      duration: VD_MOTION_ORBIT.travel,
      ease: VD_MOTION_EASES.travel,
      onUpdate: () => {
        cometTRef.current = proxy.t;
        place(proxy.t);
      },
    });
    return () => {
      tween.kill();
    };
  }, [activeIndex, pages.length, stripHeight, reducedMotion]);

  // One stable, non-passive wheel listener on the FULL orbit strip (the
  // rail's contract: deliberate wheel input pages through spaces).
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) {
      return;
    }

    function onWheel(event: WheelEvent): void {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return;
      }
      for (const node of event.composedPath()) {
        if (node instanceof Element && node.hasAttribute("data-vd-wheel-scope")) {
          return;
        }
      }
      event.preventDefault();
      if (lockedRef.current) {
        return;
      }
      const normalized = normalizeWheelEvent(event);
      const { state, action } = advanceWheelNav(
        wheelStateRef.current,
        normalized,
        event.timeStamp + performance.timeOrigin,
      );
      wheelStateRef.current = state;
      if (action === null) {
        return;
      }
      const pages = pagesRef.current;
      const currentIndex = pages.findIndex((page) => page.id === activePageIdRef.current);
      const nextIndex = stepSectionIndex(currentIndex, pages.length, action);
      const target = nextIndex === null ? undefined : pages[nextIndex];
      if (target !== undefined) {
        onSelectSectionRef.current(target.id);
      }
    }

    root.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      root.removeEventListener("wheel", onWheel);
      wheelStateRef.current = resetWheelNav();
    };
  }, []);

  function focusOrbitItem(index: number): void {
    const root = rootRef.current;
    if (root === null) {
      return;
    }
    const clamped = Math.min(Math.max(index, 0), pages.length - 1);
    const button = root.querySelectorAll<HTMLButtonElement>(".vela-orbit__item")[clamped];
    button?.focus();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    const buttons = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(".vela-orbit__item") ?? [],
    );
    const focusedIndex = buttons.findIndex((button) => button === document.activeElement);
    const base = focusedIndex >= 0 ? focusedIndex : activeIndex;
    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        focusOrbitItem(base - 1);
        return;
      case "ArrowDown":
        event.preventDefault();
        focusOrbitItem(base + 1);
        return;
      case "Home":
        event.preventDefault();
        focusOrbitItem(0);
        return;
      case "End":
        event.preventDefault();
        focusOrbitItem(pages.length - 1);
        return;
      default:
        return;
    }
  }

  function handleItemContextMenu(
    event: ReactMouseEvent,
    pageId: DesktopPageId,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    onSectionContextMenu(pageId, event.clientX, event.clientY);
  }

  function handleItemKeyDown(
    event: ReactKeyboardEvent<HTMLElement>,
    pageId: DesktopPageId,
  ): void {
    if (!isContextMenuKeyEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const anchor = contextMenuAnchorFromElement(event.currentTarget);
    onSectionContextMenu(pageId, anchor.x, anchor.y);
  }

  const height = stripHeight ?? ORBIT_STRIP_FALLBACK_HEIGHT_PX;
  const span = orbitSpan(Math.max(pages.length, 1));
  const start = 0.5 - span / 2;
  const end = 0.5 + span / 2;

  return (
    <nav
      className="vela-orbit"
      aria-label={t("nav.label")}
      ref={rootRef}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => {
        // Orbit surface (gaps): suppress the native menu and fall back to
        // the desktop command menu.
        event.preventDefault();
        onOpenCommandMenu(event.clientX, event.clientY);
      }}
    >
      <svg
        className="vela-orbit__ring"
        viewBox={`0 0 ${ORBIT_STRIP_PX} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          className="vela-orbit__ring-path"
          d={orbitArcPath(start, end, height)}
        />
      </svg>
      {/* The comet: GSAP owns its transform; it lands on the active
          waypoint and rests there as its glow. */}
      <div className="vela-orbit__comet" ref={cometRef} aria-hidden="true" />
      {pages.map((page, index) => {
        const active = page.id === activePageId;
        const point = orbitPoint(sectionT(index, pages.length), height);
        return (
          <button
            key={page.id}
            type="button"
            className="vela-orbit__item"
            data-page-id={page.id}
            data-active={active ? "true" : undefined}
            aria-current={active ? "page" : undefined}
            tabIndex={active ? 0 : -1}
            style={{ left: point.x, top: point.y }}
            onClick={() => onSelectSection(page.id)}
            onContextMenu={(event) => handleItemContextMenu(event, page.id)}
            onKeyDown={(event) => handleItemKeyDown(event, page.id)}
          >
            <span className="vela-orbit__dot" aria-hidden="true" />
            <span className="vela-orbit__chip">{page.name}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** The visible arc from param start to end (SVG path, left half of the ring). */
function orbitArcPath(start: number, end: number, height: number): string {
  const samples = 32;
  const points: string[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const t = start + ((end - start) * index) / samples;
    const point = orbitPoint(t, height);
    points.push(`${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`);
  }
  return points.join(" ");
}
