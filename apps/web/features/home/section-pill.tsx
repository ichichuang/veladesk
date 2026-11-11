"use client";

import { useVdSmoothScroll } from "@components/vd/smooth-scroll";
import { useVdScrollbar } from "@components/vd/use-vd-scrollbar";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { motion } from "motion/react";
import type { DesktopPage, DesktopPageId } from "@veladesk/domain";

import { useI18n } from "../i18n/use-i18n";
import { vdPrefersReducedMotion } from "@components/vd/reduced-motion";
import {
  contextMenuAnchorFromElement,
  isContextMenuKeyEvent,
} from "./context-menu";
import {
  advanceWheelNav,
  normalizeWheelEvent,
  resetWheelNav,
  stepSectionIndex,
} from "./section-wheel-nav";
import type { WheelNavState } from "./section-wheel-nav";
import "./home-shell.css";

/**
 * Below this viewport HEIGHT the pill collapses to the compact form: the
 * current section's name plus ‹ › steppers (t61) — a full segmented strip
 * does not fit between a short header band and the dock.
 */
const PILL_COMPACT_QUERY = "(max-height: 559px)";

/** Long-press threshold for the touch context-menu path (t61 pill). */
const LONG_PRESS_MS = 480;
/** Pointer travel that cancels a long-press (it became a drag/scroll). */
const LONG_PRESS_SLOP_PX = 8;

interface SectionPillProps {
  readonly pages: readonly DesktopPage[];
  readonly activePageId: DesktopPageId | null;
  /** Click / keyboard activation — switches the explicit active section. */
  readonly onSelectSection: (pageId: DesktopPageId) => void;
  readonly onSectionContextMenu: (pageId: DesktopPageId, x: number, y: number) => void;
  /**
   * True while a drag/resize owns the desktop or any modal surface is up —
   * wheel navigation stands down entirely AND accumulated intent is
   * cleared, so nothing replays when the lock lifts.
   */
  readonly navigationLocked: boolean;
}

/**
 * The section pill (t61, replacing the right SectionRail): ONE compact
 * glass capsule centered above the dock — the whole screen stays
 * left/right symmetric and the grid owns the full width.
 *
 * Inputs, all hover-free:
 *  - CLICK / Enter / Space on a segment switches sections; the active
 *    segment carries a sliding highlight block (Motion layout animation —
 *    `layoutId` moves ONE element between segments);
 *  - WHEEL over the pill pages through sections (trackpad horizontal
 *    swipes and Shift+wheel alike — the 018 intent model); when the
 *    segment list overflows, the wheel scrolls it natively instead;
 *  - the compact form (short viewports) adds ‹ › steppers around the
 *    current name;
 *  - per-section context menu: right-click, long-press or the Menu key —
 *    the SAME management entries the rail had (rename / new / delete /
 *    reorder), nothing was dropped;
 *  - ArrowLeft/ArrowRight roving-tabindex focus among segments.
 *
 * Overflowing pill content scrolls horizontally inside the capsule with
 * fading edges (a mask on the scroller) — never a second row, never a
 * wrap, and the active segment scrolls into view on switch.
 */
export function SectionPill({
  pages,
  activePageId,
  onSelectSection,
  onSectionContextMenu,
  navigationLocked,
}: SectionPillProps) {
  const { t } = useI18n();
  const wheelStateRef = useRef<WheelNavState>(resetWheelNav());
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useVdScrollbar(scrollerRef, "x");
  useVdSmoothScroll(scrollerRef, true);
  /** Long-press timer + origin, cancelled by slop travel or release. */
  const longPressRef = useRef<{
    readonly pageId: DesktopPageId;
    readonly timer: number;
    readonly x: number;
    readonly y: number;
  } | null>(null);

  // Latest-value mirrors: the listeners are stable across renders.
  const pagesRef = useRef(pages);
  const activePageIdRef = useRef(activePageId);
  const onSelectSectionRef = useRef(onSelectSection);
  const lockedRef = useRef(navigationLocked);

  useEffect(() => {
    pagesRef.current = pages;
    activePageIdRef.current = activePageId;
    onSelectSectionRef.current = onSelectSection;
  }, [pages, activePageId, onSelectSection]);

  // A lock taking over clears accumulated intent (never replays it).
  useEffect(() => {
    lockedRef.current = navigationLocked;
    if (navigationLocked) {
      wheelStateRef.current = resetWheelNav();
    }
  }, [navigationLocked]);

  // The compact form follows the viewport HEIGHT (a width query would
  // fire on the same narrow stages that already shrink the dock).
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(PILL_COMPACT_QUERY);
    const sync = () => setCompact(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Keep the active segment visible when it changes (the pill's own
  // scroller reveals it — never a parent/body scroll).
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null || compact) {
      return;
    }
    const activeButton = scroller.querySelector<HTMLButtonElement>(
      `[data-page-id="${CSS.escape(activePageId ?? "")}"]`,
    );
    activeButton?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activePageId, compact, pages]);

  /** Steps to the neighbor section in `direction` (-1 / +1). */
  const stepSection = useCallback((direction: -1 | 1) => {
    const list = pagesRef.current;
    const currentIndex = list.findIndex((page) => page.id === activePageIdRef.current);
    const nextIndex = stepSectionIndex(currentIndex, list.length, direction > 0 ? "next" : "prev");
    const target = nextIndex === null ? undefined : list[nextIndex];
    if (target !== undefined) {
      onSelectSectionRef.current(target.id);
    }
  }, []);

  // One stable, non-passive wheel listener on the pill: horizontal swipe /
  // Shift+wheel pages through sections; a scrollable segment list keeps
  // its native scrolling instead.
  useEffect(() => {
    const pill = scrollerRef.current;
    if (pill === null) {
      return;
    }
    function onWheel(event: WheelEvent): void {
      if (event.ctrlKey) {
        return; // Browser zoom stays native.
      }
      const horizontalSwipe = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      const along = horizontalSwipe
        ? event.deltaX
        : event.shiftKey
          ? event.deltaY
          : 0;
      if (along === 0) {
        return;
      }
      for (const node of event.composedPath()) {
        if (node instanceof Element && node.hasAttribute("data-vd-wheel-scope")) {
          return;
        }
      }
      const scroller = scrollerRef.current;
      if (scroller !== null && scroller.scrollWidth > scroller.clientWidth + 1) {
        // The capsule has its own scrolling to do — never hijack it.
        return;
      }
      event.preventDefault();
      if (lockedRef.current) {
        return;
      }
      const normalized = normalizeWheelEvent({
        deltaY: along,
        deltaMode: event.deltaMode,
        ctrlKey: false,
      });
      const { state, action } = advanceWheelNav(
        wheelStateRef.current,
        normalized,
        event.timeStamp + performance.timeOrigin,
      );
      wheelStateRef.current = state;
      if (action === null) {
        return;
      }
      stepSection(action === "next" ? 1 : -1);
    }
    pill.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      pill.removeEventListener("wheel", onWheel);
      wheelStateRef.current = resetWheelNav();
    };
  }, [stepSection]);

  function cancelLongPress(): void {
    const pending = longPressRef.current;
    if (pending !== null) {
      window.clearTimeout(pending.timer);
      longPressRef.current = null;
    }
  }

  // Long-press cleanup on unmount.
  useEffect(() => () => cancelLongPress(), []);

  function handleSegmentPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    pageId: DesktopPageId,
  ): void {
    if (event.button !== 0 && event.pointerType === "mouse") {
      return;
    }
    const x = event.clientX;
    const y = event.clientY;
    cancelLongPress();
    const timer = window.setTimeout(() => {
      longPressRef.current = null;
      onSectionContextMenu(pageId, x, y);
    }, LONG_PRESS_MS);
    longPressRef.current = { pageId, timer, x, y };
  }

  function handleSegmentPointerMove(event: ReactPointerEvent<HTMLButtonElement>): void {
    const pending = longPressRef.current;
    if (pending === null) {
      return;
    }
    if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > LONG_PRESS_SLOP_PX) {
      cancelLongPress();
    }
  }

  function handleSegmentContextMenu(
    event: ReactMouseEvent,
    pageId: DesktopPageId,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    cancelLongPress();
    onSectionContextMenu(pageId, event.clientX, event.clientY);
  }

  function handleSegmentKeyDown(
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

  function focusSegment(index: number): void {
    const buttons = scrollerRef.current?.querySelectorAll<HTMLButtonElement>(".vela-pill__item");
    const clamped = Math.min(Math.max(index, 0), pages.length - 1);
    buttons?.[clamped]?.focus();
  }

  function handleListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    // Arrows move FOCUS from the focused segment (fallback: the active
    // one); Enter/Space stay native button activation. Both axis pairs
    // work — the pill is horizontal, but the rail's habits stay honored.
    const buttons = Array.from(
      scrollerRef.current?.querySelectorAll<HTMLButtonElement>(".vela-pill__item") ?? [],
    );
    const focusedIndex = buttons.findIndex((button) => button === document.activeElement);
    const activeIndex = Math.max(0, pages.findIndex((page) => page.id === activePageId));
    const base = focusedIndex >= 0 ? focusedIndex : activeIndex;
    switch (event.key) {
      case "Home":
        event.preventDefault();
        focusSegment(0);
        return;
      case "End":
        event.preventDefault();
        focusSegment(pages.length - 1);
        return;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        focusSegment(base - 1);
        return;
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        focusSegment(base + 1);
        return;
      default:
        return;
    }
  }

  const activePage = pages.find((page) => page.id === activePageId);
  const activeIndex = Math.max(0, pages.findIndex((page) => page.id === activePageId));
  const reducedMotion = vdPrefersReducedMotion();

  if (compact) {
    // The compact form (short viewports): current name + steppers.
    return (
      <nav className="vela-pill" data-compact="true" aria-label={t("nav.label")}>
        <button
          type="button"
          className="vela-pill__stepper"
          aria-label={t("nav.previousSection")}
          onClick={() => stepSection(-1)}
          disabled={activeIndex <= 0}
        >
          ‹
        </button>
        <span className="vela-pill__compact-name" title={activePage?.name}>
          {activePage?.name ?? t("nav.label")}
        </span>
        <button
          type="button"
          className="vela-pill__stepper"
          aria-label={t("nav.nextSection")}
          onClick={() => stepSection(1)}
          disabled={activeIndex >= pages.length - 1}
        >
          ›
        </button>
      </nav>
    );
  }

  return (
    <nav className="vela-pill" aria-label={t("nav.label")}>
      <div
        className="vela-pill__scroller"
        data-vd-scroll="x"
        ref={scrollerRef}
        onKeyDown={handleListKeyDown}
      >
        {pages.map((page) => {
          const active = page.id === activePageId;
          return (
            <button
              key={page.id}
              type="button"
              className="vela-pill__item"
              data-page-id={page.id}
              data-active={active ? "true" : undefined}
              aria-current={active ? "page" : undefined}
              tabIndex={active ? 0 : -1}
              title={page.name}
              onClick={() => onSelectSection(page.id)}
              onPointerDown={(event) => handleSegmentPointerDown(event, page.id)}
              onPointerMove={handleSegmentPointerMove}
              onPointerUp={cancelLongPress}
              onPointerCancel={cancelLongPress}
              onContextMenu={(event) => handleSegmentContextMenu(event, page.id)}
              onKeyDown={(event) => handleSegmentKeyDown(event, page.id)}
            >
              {active ? (
                <motion.span
                  className="vela-pill__highlight"
                  layoutId="vela-section-pill-highlight"
                  transition={
                    reducedMotion
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 480, damping: 42 }
                  }
                />
              ) : null}
              <span className="vela-pill__item-label">{page.name}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
