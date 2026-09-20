"use client";

import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { DesktopPage, DesktopPageId } from "@veladesk/domain";

import { useI18n } from "../i18n/use-i18n";
import {
  contextMenuAnchorFromElement,
  isContextMenuKeyEvent,
} from "./context-menu";
import "./home-shell.css";

interface SectionNavigationProps {
  readonly pages: readonly DesktopPage[];
  readonly activePageId: DesktopPageId | null;
  /** Click / keyboard activation — scrolls the real stack. */
  readonly onSelectSection: (pageId: DesktopPageId) => void;
  readonly onSectionContextMenu: (pageId: DesktopPageId, x: number, y: number) => void;
  /** The ⋯ fallback opens the shared desktop command menu. */
  readonly onOpenCommandMenu: (x: number, y: number) => void;
  /** Optional footer content (sync status); rendered above the ⋯ button. */
  readonly footer?: React.ReactNode;
}

/**
 * The floating left section navigation rail (task 015).
 *
 * A lightweight projection of `workspace.pages` floating on the wallpaper
 * — no sidebar card, no heavy chrome. The active item carries
 * `aria-current="page"` and an accent marker. The list scrolls locally
 * when many sections exist (`data-vd-wheel-scope="local"`); it is a
 * SIBLING of the section stack, so wheel input here can never page the
 * desktop. Right-click / Shift+F10 on an item opens the section menu; the
 * quiet ⋯ footer button opens the same command menu as the desktop
 * right-click (discoverability fallback).
 */
export function SectionNavigation({
  pages,
  activePageId,
  onSelectSection,
  onSectionContextMenu,
  onOpenCommandMenu,
  footer,
}: SectionNavigationProps) {
  const { t } = useI18n();

  function handleItemContextMenu(event: ReactMouseEvent, pageId: DesktopPageId) {
    event.preventDefault();
    event.stopPropagation();
    onSectionContextMenu(pageId, event.clientX, event.clientY);
  }

  function handleItemKeyDown(event: ReactKeyboardEvent<HTMLElement>, pageId: DesktopPageId) {
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
      className="vela-section-nav"
      aria-label={t("nav.label")}
      onContextMenu={(event) => {
        // Rail surface (gaps, footer): suppress the native menu and fall
        // back to the desktop command menu.
        event.preventDefault();
        onOpenCommandMenu(event.clientX, event.clientY);
      }}
    >
      <div className="vela-section-nav__list" data-vd-wheel-scope="local">
        {pages.map((page) => {
          const active = page.id === activePageId;
          return (
            <button
              key={page.id}
              type="button"
              className="vela-section-nav__item"
              data-active={active ? "true" : undefined}
              aria-current={active ? "page" : undefined}
              title={page.name}
              onClick={() => onSelectSection(page.id)}
              onContextMenu={(event) => handleItemContextMenu(event, page.id)}
              onKeyDown={(event) => handleItemKeyDown(event, page.id)}
            >
              {page.name}
            </button>
          );
        })}
      </div>
      <div className="vela-section-nav__footer">
        {footer}
        <button
          type="button"
          className="vela-section-nav__more"
          aria-label={t("nav.more")}
          aria-haspopup="menu"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const anchor = contextMenuAnchorFromElement(event.currentTarget);
            onOpenCommandMenu(anchor.x, anchor.y);
          }}
          onKeyDown={(event) => {
            if (!isContextMenuKeyEvent(event)) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            const anchor = contextMenuAnchorFromElement(event.currentTarget);
            onOpenCommandMenu(anchor.x, anchor.y);
          }}
        >
          ⋯
        </button>
      </div>
    </nav>
  );
}
