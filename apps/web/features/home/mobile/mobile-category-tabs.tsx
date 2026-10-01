"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { DesktopPage, DesktopPageId } from "@veladesk/domain";

import { VdAnimatedIndicator } from "@components/vd/animated-indicator";
import { useI18n } from "../../i18n/use-i18n";
import "./mobile-shell.css";

/**
 * The mobile category tabs (task 026 §14–§16): the desktop's left section
 * rail as a horizontal tab strip.
 *
 *  - role=tablist/tab with aria-selected; tap switches (no drag reorder,
 *    no long-press, no context menus — §14).
 *  - The strip scrolls naturally when categories overflow; the ACTIVE tab
 *    is kept visible by a direct scrollLeft write (§15 — never native
 *    smooth scrolling).
 *  - One shared GSAP indicator pill glides to the active tab (§16); the
 *    first placement is a gsap.set (restored section never sweeps from the
 *    first tab) and reduced motion pins it instantly — all owned by the
 *    shared VdAnimatedIndicator.
 */
export function MobileCategoryTabs({
  pages,
  activePageId,
  onSelect,
}: {
  readonly pages: readonly DesktopPage[];
  readonly activePageId: DesktopPageId | null;
  readonly onSelect: (pageId: DesktopPageId) => void;
}) {
  const { t } = useI18n();
  /**
   * The strip element in TWO shapes (022-R2's container-as-prop lesson):
   * the STATE copy feeds the shared indicator (its placement effect re-runs
   * with the real element once the ref attach re-renders); the REF copy is
   * what effects write through — state-held elements must never be mutated.
   */
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const setList = useCallback((node: HTMLDivElement | null) => {
    listRef.current = node;
    setListElement(node);
  }, []);
  const tabElementsRef = useRef(new Map<string, HTMLButtonElement>());
  /** Stable registration identity (an inline arrow would empty the map mid-commit). */
  const registerTab = useCallback((pageId: string, node: HTMLButtonElement | null) => {
    if (node === null) {
      tabElementsRef.current.delete(pageId);
    } else {
      tabElementsRef.current.set(pageId, node);
    }
  }, []);

  // Keep the active tab visible (§15): direct scrollLeft write, no smooth
  // behavior, no scrollIntoView — programmatic repositioning belongs to a
  // single layout write, GSAP or plain, never the native smooth scroller.
  useLayoutEffect(() => {
    const list = listRef.current;
    const tab = activePageId === null ? undefined : tabElementsRef.current.get(activePageId);
    if (list === null || tab === undefined) {
      return;
    }
    const target = tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2;
    list.scrollLeft = Math.max(0, target);
  }, [activePageId]);

  const resolveTarget = useCallback(
    (key: string, container: HTMLElement): HTMLElement | null => {
      return container.querySelector(`[data-page-id="${CSS.escape(key)}"]`);
    },
    [],
  );

  return (
    <nav className="vela-mobile-tabs" aria-label={t("mobile.tabs.label")}>
      <div className="vela-mobile-tabs__list" role="tablist" aria-label={t("mobile.tabs.label")} ref={setList}>
        <VdAnimatedIndicator
          container={listElement}
          activeKey={activePageId}
          resolveTarget={resolveTarget}
          remeasureToken={pages.map((page) => page.id).join("|")}
          axis="horizontal"
          className="vela-mobile-tabs__indicator"
        />
        {pages.map((page) => (
          <button
            key={page.id}
            type="button"
            role="tab"
            data-page-id={page.id}
            ref={(node) => registerTab(page.id, node)}
            className="vela-mobile-tabs__tab"
            aria-selected={page.id === activePageId ? "true" : "false"}
            aria-controls={MOBILE_SECTION_PANEL_ID}
            onClick={() => onSelect(page.id)}
          >
            {page.name}
          </button>
        ))}
      </div>
    </nav>
  );
}

/** The tablist points here; the shell's content main carries the matching id. */
export const MOBILE_SECTION_PANEL_ID = "vela-mobile-section-panel";
