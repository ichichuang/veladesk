"use client";

import { useEffect, useRef } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import type { DesktopPage, DesktopPageId } from "@veladesk/domain";

import { useI18n } from "../i18n/use-i18n";
import {
  contextMenuAnchorFromElement,
  isContextMenuKeyEvent,
} from "./context-menu";
import {
  advanceWheelNav,
  unlockWheelNav,
} from "./section-wheel-nav";
import type { WheelNavAction, WheelNavState } from "./section-wheel-nav";
import "./home-shell.css";

/** How long a gesture must stay quiet before the wheel lock releases. */
const WHEEL_NAV_SETTLE_MS = 320;

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
   * wheel navigation stands down entirely.
   */
  readonly navigationLocked: boolean;
}

/**
 * The left section rail (task 017): titles only, no footer, no ⋯ button,
 * no sync status.
 *
 * The rail is a fixed column of the two-column workspace — application
 * content never flows under it. Each item is a button showing only
 * `page.name` (ellipsis + title tooltip + aria-current). Right-click /
 * Shift+F10 on a title opens the section menu; clicking switches the
 * active section.
 *
 * WHEEL input over the rail means previous/next section: the native wheel
 * is suppressed (non-passive listener) and a pure accumulator turns one
 * intentional gesture into at most one section change. With focus inside
 * the rail, ArrowUp/ArrowDown move focus (roving tabindex), Home/End jump
 * to the ends, Enter/Space activates.
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
  const listRef = useRef<HTMLDivElement | null>(null);
  const wheelStateRef = useRef<WheelNavState>({ accumulated: 0, locked: false });
  const settleTimerRef = useRef<number | null>(null);
  const lockedRef = useRef(navigationLocked);

  useEffect(() => {
    lockedRef.current = navigationLocked;
  }, [navigationLocked]);

  // Keep the active title visible when it changes (rail scrolls itself only
  // programmatically — users never freely scroll it).
  useEffect(() => {
    const list = listRef.current;
    const activeButton = list?.querySelector<HTMLButtonElement>(
      `[data-page-id="${CSS.escape(activePageId ?? "")}"]`,
    );
    activeButton?.scrollIntoView({ block: "nearest" });
  }, [activePageId]);

  // Non-passive wheel listener: the rail must never scroll natively, and a
  // passive listener could not prevent it.
  useEffect(() => {
    const list = listRef.current;
    if (list === null) {
      return;
    }

    const fire = (action: WheelNavAction) => {
      if (action === null) {
        return;
      }
      const currentIndex = pages.findIndex((page) => page.id === activePageId);
      const nextIndex = action === "next" ? currentIndex + 1 : currentIndex - 1;
      const target = pages[nextIndex];
      if (target !== undefined) {
        onSelectSection(target.id);
      }
    };

    function onWheel(event: WheelEvent): void {
      // The rail never scrolls natively — not while navigating, not while
      // locked (a locked gesture is still ours to swallow).
      event.preventDefault();
      if (lockedRef.current) {
        return;
      }
      const { state, action } = advanceWheelNav(
        wheelStateRef.current,
        event.deltaY,
      );
      wheelStateRef.current = state;
      fire(action);

      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        wheelStateRef.current = unlockWheelNav(wheelStateRef.current);
      }, WHEEL_NAV_SETTLE_MS);
    }

    list.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      list.removeEventListener("wheel", onWheel);
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    };
  }, [pages, activePageId, onSelectSection]);

  function focusRailItem(index: number): void {
    const list = listRef.current;
    if (list === null) {
      return;
    }
    const clamped = Math.min(Math.max(index, 0), pages.length - 1);
    const button = list.querySelectorAll<HTMLButtonElement>(".vela-rail__item")[clamped];
    button?.focus();
  }

  function handleListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    // Arrows move FOCUS from the focused item (fallback: the active one);
    // Enter/Space stay native button activation.
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(".vela-rail__item") ?? [],
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
      onContextMenu={(event) => {
        // Rail surface (gaps): suppress the native menu and fall back to
        // the desktop command menu.
        event.preventDefault();
        onOpenCommandMenu(event.clientX, event.clientY);
      }}
    >
      <div
        className="vela-rail__list"
        ref={listRef}
        onKeyDown={handleListKeyDown}
      >
        {pages.map((page) => {
          const active = page.id === activePageId;
          return (
            <button
              key={page.id}
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
