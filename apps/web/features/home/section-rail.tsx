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

/**
 * Below this viewport width the rail becomes the horizontal section bar
 * (the mobile shell's tab language): one scrollable strip of pills above
 * the tiles instead of a right-side column beside them.
 */
const RAIL_HORIZONTAL_QUERY = "(max-width: 899px)";

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
 * The section rail (Helm r3): the always-visible section switcher as a
 * REAL column of the workbench — every section is a labelled waypoint row,
 * clickable and keyboard-reachable without any hover (the r2 orbit ring
 * hid labels behind hover and floated over the tile grid; this occupies
 * its own layout space, so it can never cover a tile).
 *
 * Inputs, all hover-free:
 *  - CLICK / Enter / Space on any row switches sections;
 *  - WHEEL over the rail pages through sections (the 018 intent model);
 *    when the row list overflows (many sections) the wheel scrolls the
 *    list natively instead, and the active row scrolls into view;
 *  - ArrowUp/ArrowDown (and Left/Right on the horizontal bar),
 *    Home/End roving-tabindex focus, Tab reaches the active row first;
 *  - per-section context menu (right-click / Menu key).
 *
 * Below 900px the same component renders as a horizontal bar — the workbench
 * flips to a column and the rail's list becomes the pill strip. The GSAP
 * waypoint indicator (the comet's glow bar) follows the active row on
 * whichever axis is live. Reduced motion: instant indicator placement,
 * everything else is already state, not animation.
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
   * ACTIVE row element itself. ONE stable callback derives the page id from
   * the node's own attribute in the commit phase; vanished rows are pruned
   * after each structural change.
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
  /** Row-set identity for the indicator's geometry re-validation. */
  const rowOrderToken = pages.map((page) => page.id).join(" ");
  // Latest-value mirrors: the wheel listener is stable across renders.
  const pagesRef = useRef(pages);
  const activePageIdRef = useRef(activePageId);
  const onSelectSectionRef = useRef(onSelectSection);
  const lockedRef = useRef(navigationLocked);
  /** The live orientation, read by the wheel handler (post-hydration only). */
  const orientationQueryRef = useRef<MediaQueryList | null>(null);

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

  // The horizontal-bar orientation flips via CSS at 900px; the indicator's
  // axis follows the SAME query so the comet never glides the wrong way.
  const [horizontal, setHorizontal] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(RAIL_HORIZONTAL_QUERY);
    orientationQueryRef.current = query;
    const sync = () => setHorizontal(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Keep the active title visible when it changes (the rail's own list
  // scrolls just enough to reveal it — never a parent/body scroll).
  useEffect(() => {
    if (listElement === null) {
      return;
    }
    const activeButton = listElement.querySelector<HTMLButtonElement>(
      `[data-page-id="${CSS.escape(activePageId ?? "")}"]`,
    );
    activeButton?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [listElement, activePageId, horizontal]);

  // One stable, non-passive wheel listener on the FULL rail (the 018
  // contract: deliberate wheel input pages through spaces). When the row
  // list itself overflows — many sections — the wheel belongs to the list's
  // native scrolling instead, on either axis.
  useEffect(() => {
    const rail = railRef.current;
    if (rail === null) {
      return;
    }

    function onWheel(event: WheelEvent): void {
      // Browser zoom stays native; cross-axis intent is not navigation.
      if (event.ctrlKey) {
        return;
      }
      const horizontalBar = orientationQueryRef.current?.matches === true;
      const along =
        horizontalBar ? Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY
          : Math.abs(event.deltaY) > Math.abs(event.deltaX)
            ? event.deltaY
            : event.deltaX;
      if (along === 0) {
        return;
      }
      // A local wheel scope (interactive overlay) over the rail keeps its
      // own scrolling — examine the actual event path, not assumptions.
      for (const node of event.composedPath()) {
        if (node instanceof Element && node.hasAttribute("data-vd-wheel-scope")) {
          return;
        }
      }
      const list = railRef.current?.querySelector<HTMLElement>(".vela-rail__list") ?? null;
      if (
        list !== null &&
        ((horizontalBar && list.scrollWidth > list.clientWidth + 1) ||
          (!horizontalBar && list.scrollHeight > list.clientHeight + 1))
      ) {
        // The list has its own scrolling to do — never hijack it.
        return;
      }
      event.preventDefault();
      if (lockedRef.current) {
        return;
      }
      // The intent model is axis-agnostic: feed whichever axis the rail
      // currently lives on as the "vertical" input.
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
    // Enter/Space stay native button activation. Both axis pairs work in
    // both orientations — the bar and the column share one contract.
    const buttons = Array.from(
      listElement?.querySelectorAll<HTMLButtonElement>(".vela-rail__item") ?? [],
    );
    const focusedIndex = buttons.findIndex((button) => button === document.activeElement);
    const activeIndex = Math.max(0, pages.findIndex((page) => page.id === activePageId));
    const base = focusedIndex >= 0 ? focusedIndex : activeIndex;
    switch (event.key) {
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        focusRailItem(base - 1);
        return;
      case "ArrowDown":
      case "ArrowRight":
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
      data-orientation={horizontal ? "horizontal" : "vertical"}
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
        {/* One GSAP-owned marker glides to the active title on the live
            axis — the comet's resting glow; never affects the rows. */}
        <VdAnimatedIndicator
          container={listElement}
          activeKey={activePageId}
          axis={horizontal ? "horizontal" : "vertical"}
          resolveTarget={(key) => rowElementsRef.current.get(key) ?? null}
          remeasureToken={`${rowOrderToken}|${horizontal ? "h" : "v"}`}
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
              <span className="vela-rail__waypoint" aria-hidden="true" />
              <span className="vela-rail__item-label">{page.name}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
