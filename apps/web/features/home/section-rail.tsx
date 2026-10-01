"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import type { DesktopPage, DesktopPageId } from "@veladesk/domain";

import { useI18n } from "../i18n/use-i18n";
import { VdAnimatedIndicator } from "@components/vd/animated-indicator";
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

interface SectionRailProps {
  readonly pages: readonly DesktopPage[];
  readonly activePageId: DesktopPageId | null;
  /** Click / keyboard activation — switches the explicit active section. */
  readonly onSelectSection: (pageId: DesktopPageId) => void;
  readonly onSectionContextMenu: (pageId: DesktopPageId, x: number, y: number) => void;
  /** Rail-surface (gaps) fallback: the shared desktop command menu. */
  readonly onOpenCommandMenu: (x: number, y: number) => void;
  /**
   * True while a drag/resize owns the desktop or any modal surface is up —
   * wheel navigation stands down entirely AND accumulated intent is
   * cleared, so nothing replays when the lock lifts.
   */
  readonly navigationLocked: boolean;
}

/**
 * The left section rail (task 017, wheel interaction rebuilt in 018):
 * titles only, no footer, no ⋯ button, no sync status.
 *
 * WHEEL NAVIGATION (task 018 contract): the ENTIRE reserved left column
 * owns section-wheel navigation — the non-passive listener binds to the
 * full-height rail root, not just the title list, so the padding, the gaps
 * between titles and the blank space below them all navigate. No prior
 * click, focus or hover is required, and hover alone never selects; only
 * wheel movement does. One deliberate gesture (a detent, a clear flick)
 * advances one adjacent section; continued deliberate input keeps paging;
 * a decaying momentum tail is swallowed by the pure intent model in
 * section-wheel-nav.ts. Browser zoom gestures (ctrl+wheel) and horizontal
 * scrolling are left to the browser. A modal/gesture lock resets the
 * accumulated intent instead of replaying it later.
 *
 * The listener is registered ONCE (empty dependency array) and reads the
 * latest pages/selection/lock through refs — the old dependency-driven
 * teardown both re-registered on every selection change and cancelled the
 * in-flight settle timer, which could leave navigation locked forever.
 *
 * The active indicator is ONE absolutely-positioned marker in the list
 * that glides to the active title (task 022, GSAP VdAnimatedIndicator —
 * the Motion shared-layout pill is gone); the marker is decoration and
 * never moves the text/rows.
 *
 * With focus inside the rail, ArrowUp/ArrowDown move focus (roving
 * tabindex), Home/End jump to the ends, Enter/Space activates.
 */
export function SectionRail({
  pages,
  activePageId,
  onSelectSection,
  onSectionContextMenu,
  onOpenCommandMenu,
  navigationLocked,
}: SectionRailProps) {
  const { t } = useI18n();
  const railRef = useRef<HTMLElement | null>(null);
  const wheelStateRef = useRef<WheelNavState>(resetWheelNav());
  /**
   * The title-list element, through a callback ref into state (the shell's
   * setPortalRoot pattern): React attaches a parent's ref only AFTER child
   * layout effects have run, so a plain useRef handed to the indicator was
   * still null at its mount effect — the marker was never placed on first
   * entry (022-R2). As a PROP the attach re-renders and the indicator
   * places pre-paint. The event handlers below read the same element.
   */
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  /**
   * Direct row refs keyed by page id (022-R2): the indicator measures the
   * SELECTED row element itself — never a selector that could match a
   * hovered or focused row. ONE stable callback (identity never changes, so
   * React never detaches rows mid-commit) derives the page id from the
   * node's own attribute in the commit phase — writing a ref there is
   * legal, and reading the map only from effects and the resolver keeps
   * render pure. Vanished rows are pruned after each structural change.
   */
  const rowElementsRef = useRef(new Map<string, HTMLButtonElement>());
  const registerRow = useCallback((node: HTMLButtonElement | null) => {
    if (node === null) {
      return; // row unmounts are pruned from the map by the effect below
    }
    const id = node.dataset.pageId;
    if (id !== undefined) {
      rowElementsRef.current.set(id, node);
    }
  }, []);
  useEffect(() => {
    const live = new Set(pages.map((page) => page.id));
    for (const id of rowElementsRef.current.keys()) {
      if (!live.has(id)) {
        rowElementsRef.current.delete(id);
      }
    }
  }, [pages]);
  /**
   * Row-set identity for the indicator's geometry re-validation: reordered,
   * added or removed rows re-measure the SAME active row (its position
   * moved without an activation change — first-entry font swaps arrive via
   * the indicator's ResizeObserver instead).
   */
  const rowOrderToken = pages.map((page) => page.id).join(" ");
  // Latest-value mirrors: the wheel listener is stable across renders.
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

  // Keep the active title visible when it changes (the rail's own list
  // scrolls just enough to reveal it — never a parent/body scroll).
  useEffect(() => {
    if (listElement === null) {
      return;
    }
    const activeButton = listElement.querySelector<HTMLButtonElement>(
      `[data-page-id="${CSS.escape(activePageId ?? "")}"]`,
    );
    activeButton?.scrollIntoView({ block: "nearest" });
  }, [listElement, activePageId]);

  // One stable, non-passive wheel listener on the FULL-HEIGHT rail root.
  useEffect(() => {
    const rail = railRef.current;
    if (rail === null) {
      return;
    }

    function onWheel(event: WheelEvent): void {
      // Browser zoom stays native; horizontal intent is not section
      // navigation.
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return;
      }
      // A local wheel scope (interactive overlay) over the rail keeps its
      // own scrolling — examine the actual event path, not assumptions.
      for (const node of event.composedPath()) {
        if (node instanceof Element && node.hasAttribute("data-vd-wheel-scope")) {
          return;
        }
      }
      // The rail column never scrolls natively — its wheel is either
      // navigation or suppressed (a locked/ignored gesture is still ours
      // to swallow, so no page-level scroll ever leaks through).
      event.preventDefault();
      if (lockedRef.current) {
        return;
      }
      // One normalization path (019-E §5): the helper re-checks ctrlKey
      // defensively; the early guard above already returned zoom to the
      // browser BEFORE preventDefault.
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

    rail.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      rail.removeEventListener("wheel", onWheel);
      wheelStateRef.current = resetWheelNav();
    };
  }, []);

  function focusRailItem(index: number): void {
    if (listElement === null) {
      return;
    }
    const clamped = Math.min(Math.max(index, 0), pages.length - 1);
    const button = listElement.querySelectorAll<HTMLButtonElement>(".vela-rail__item")[clamped];
    button?.focus();
  }

  function handleListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    // Arrows move FOCUS from the focused item (fallback: the active one);
    // Enter/Space stay native button activation.
    const buttons = Array.from(
      listElement?.querySelectorAll<HTMLButtonElement>(".vela-rail__item") ?? [],
    );
    const focusedIndex = buttons.findIndex((button) => button === document.activeElement);
    const activeIndex = Math.max(0, pages.findIndex((page) => page.id === activePageId));
    const base = focusedIndex >= 0 ? focusedIndex : activeIndex;
    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        focusRailItem(base - 1);
        return;
      case "ArrowDown":
        event.preventDefault();
        focusRailItem(base + 1);
        return;
      case "Home":
        event.preventDefault();
        focusRailItem(0);
        return;
      case "End":
        event.preventDefault();
        focusRailItem(pages.length - 1);
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

  return (
    <nav
      className="vela-rail"
      aria-label={t("nav.label")}
      ref={railRef}
      onContextMenu={(event) => {
        // Rail surface (gaps): suppress the native menu and fall back to
        // the desktop command menu.
        event.preventDefault();
        onOpenCommandMenu(event.clientX, event.clientY);
      }}
    >
      <div
        className="vela-rail__list"
        data-vd-scroll="y"
        ref={setListElement}
        onKeyDown={handleListKeyDown}
      >
        {/* One GSAP-owned marker glides to the active title (022); it is
            absolutely positioned and never affects the rows. */}
        <VdAnimatedIndicator
          container={listElement}
          activeKey={activePageId}
          resolveTarget={(key) => rowElementsRef.current.get(key) ?? null}
          remeasureToken={rowOrderToken}
          className="vela-rail__indicator"
        />
        {pages.map((page) => {
          const active = page.id === activePageId;
          return (
            <button
              key={page.id}
              ref={registerRow}
              type="button"
              className="vela-rail__item"
              data-page-id={page.id}
              data-active={active ? "true" : undefined}
              aria-current={active ? "page" : undefined}
              tabIndex={active ? 0 : -1}
              title={page.name}
              onClick={() => onSelectSection(page.id)}
              onContextMenu={(event) => handleItemContextMenu(event, page.id)}
              onKeyDown={(event) => handleItemKeyDown(event, page.id)}
            >
              <span className="vela-rail__item-label">{page.name}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
