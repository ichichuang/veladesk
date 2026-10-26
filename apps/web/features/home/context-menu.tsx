"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { MotionMenuEntries, WorkspaceMenuRow } from "./workspace-menu-row";
import { clearMotion } from "./workspace-motion";
import type { DesktopMenuEntry } from "./desktop-command-menu";
import { clampContextMenuPosition } from "./context-menu-position";
import { gsap } from "@components/vd/gsap";
import { VD_MOTION_EASE, vdMotionDuration } from "@components/vd/motion-tokens";
import { useVdReducedMotion } from "@components/vd/reduced-motion";
import "./home-shell.css";

const ITEM_SELECTOR = '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)';
export interface ContextMenuAction {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}
export type ContextMenuEntry = DesktopMenuEntry;
export interface ContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly entries: readonly ContextMenuEntry[];
}
export function isContextMenuKeyEvent(event: { key: string; shiftKey: boolean }): boolean {
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}
export function contextMenuAnchorFromElement(element: Element): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) };
}

export function ContextMenu({ state, onClose }: { readonly state: ContextMenuState; readonly onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function outside(event: MouseEvent) {
      if ((event.target as HTMLElement).closest?.('[role="dialog"], [role="alertdialog"]')) return;
      if (!root.current?.contains(event.target as Node)) onClose();
    }
    function escape(event: KeyboardEvent) {
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    }
    window.addEventListener("mousedown", outside);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("mousedown", outside); window.removeEventListener("keydown", escape); };
  }, [onClose]);
  return <div ref={root} style={{ display: "contents" }}>
    <MenuPanel entries={state.entries} x={state.x} y={state.y} onClose={onClose} />
  </div>;
}

function MenuPanel({ entries, x, y, anchor, inline = false, focusOnOpen = true, active = true, onReleased, onClose, onBack }: {
  readonly entries: readonly DesktopMenuEntry[];
  readonly x: number;
  readonly y: number;
  readonly anchor?: HTMLElement;
  readonly inline?: boolean;
  readonly focusOnOpen?: boolean;
  readonly onClose: () => void;
  readonly onBack?: () => void;
  readonly active?: boolean;
  readonly onReleased?: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [child, setChild] = useState<{ id: string; anchor: HTMLButtonElement; keyboard: boolean; open: boolean } | null>(null);
  const releaseRef = useRef(onReleased);
  useLayoutEffect(() => { releaseRef.current = onReleased; });
  function closeChild() { setChild(current => current === null ? null : { ...current, open: false }); }
  const reducedMotion = useVdReducedMotion();
  const inPlace = inline || (typeof window !== "undefined" && (window.innerWidth < 600 || window.matchMedia?.("(hover: none)").matches));
  const childEntry = entries.find(entry => entry.kind === "submenu" && entry.id === child?.id);
  function items() {
    const menu = menuRef.current;
    return Array.from(menu?.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR) ?? []).filter(item => item.closest('[role="menu"]') === menu && item.closest("[inert]") === null);
  }
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  useLayoutEffect(() => {
    function measure() {
      const menu = menuRef.current;
      if (menu === null) return;
      const rect = menu.getBoundingClientRect();
      const origin = anchor?.getBoundingClientRect();
      const desiredX = origin === undefined ? x : origin.right + 4 + rect.width <= window.innerWidth - 8 ? origin.right + 4 : origin.left - rect.width - 4;
      setPosition(clampContextMenuPosition({ x: desiredX, y: origin?.top ?? y, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, menuWidth: rect.width, menuHeight: rect.height }));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [x, y, anchor, entries]);
  useEffect(() => {
    if (position !== null && focusOnOpen) items()[0]?.focus();
    // The initial focus belongs to this panel, never its descendant menu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position !== null, focusOnOpen]);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null || position === null) return;
    const rows = anchor === undefined ? [] : Array.from(menu.querySelectorAll<HTMLElement>(":scope > .vela-workspace-menu-row"));
    if (reducedMotion) { clearMotion(menu); rows.forEach(clearMotion); if (!active) releaseRef.current?.(); return; }
    const origin = anchor?.getBoundingClientRect();
    const direction = origin !== undefined && position.x < origin.left ? 1 : -1;
    const timeline = gsap.timeline({ onComplete: () => { clearMotion(menu); rows.forEach(row => { if (row.dataset.exiting !== "true") clearMotion(row); }); if (!active) releaseRef.current?.(); } });
    if (active) {
      timeline.fromTo(menu, { opacity: 0, x: anchor === undefined ? 0 : direction * 5, y: anchor === undefined ? -2 : 0 },
        { opacity: 1, x: 0, y: 0, duration: vdMotionDuration("popup"), ease: VD_MOTION_EASE }, 0);
      if (rows.length > 0 && rows.length <= 8) timeline.fromTo(rows, { opacity: 0, x: direction * 4 },
        { opacity: 1, x: 0, duration: vdMotionDuration("hoverPress"), stagger: { amount: Math.min(vdMotionDuration("popup") / 2, (rows.length - 1) * vdMotionDuration("hoverPress") / 8) }, ease: VD_MOTION_EASE }, 0);
    } else timeline.to(menu, { opacity: 0, duration: vdMotionDuration("hoverPress"), ease: VD_MOTION_EASE }, 0);
    return () => { timeline.kill(); clearMotion(menu); rows.forEach(clearMotion); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position !== null, reducedMotion, active]);
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('[role="menu"]') !== menuRef.current) return;
    const rows = items();
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End", "Escape", "ArrowLeft"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Escape" || event.key === "ArrowLeft") {
        if (child !== null) { child.anchor.focus(); closeChild(); }
        else if (onBack !== undefined) onBack();
        else if (event.key === "Escape") onClose();
      } else {
        const index = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
        rows[index]?.focus();
      }
    }
  }
  function openChild(id: string, button: HTMLButtonElement, keyboard: boolean) {
    clearTimeout(hoverTimer.current);
    setChild({ id, anchor: button, keyboard, open: true });
  }
  const panel = <div ref={menuRef} role="menu" inert={!active || undefined} aria-hidden={!active || undefined} aria-orientation="vertical"
    className={`vela-context-menu${anchor !== undefined ? " vela-workspace-submenu" : ""}${inline ? " vela-context-menu--inline" : ""}`}
    data-vd-wheel-scope="local" data-measured={position !== null ? "true" : undefined}
    style={inline ? undefined : position === null ? { visibility: "hidden", left: x, top: y } : { left: position.x, top: position.y }}
    onMouseOver={event => { const target = event.target as HTMLElement; if (target.closest('[role="menu"]') === menuRef.current && target.closest(".vela-workspace-menu-row")) closeChild(); }}
    onKeyDown={handleKeyDown} onContextMenu={(event: ReactMouseEvent) => { event.preventDefault(); event.stopPropagation(); }}>
    {<MotionMenuEntries entries={entries} renderEntry={(entry, index, exiting, release) => {
      if (entry.kind === "separator") return <div key={`separator-${index}`} role="separator" className="vela-context-menu__separator" />;
      if (entry.kind === "submenu") return <div key={entry.id}>
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={child?.id === entry.id && child.open} className="vela-context-menu__item"
          onMouseEnter={event => {
            const button = event.currentTarget;
            clearTimeout(hoverTimer.current);
            hoverTimer.current = setTimeout(() => openChild(entry.id, button, false), 150);
          }}
          onMouseLeave={() => clearTimeout(hoverTimer.current)}
          onKeyDown={event => { if (["ArrowRight", "Enter", " "].includes(event.key)) { event.preventDefault(); event.stopPropagation(); openChild(entry.id, event.currentTarget, true); } }}
          onClick={event => inPlace && child?.id === entry.id && child.open ? closeChild() : openChild(entry.id, event.currentTarget, true)}>
          {entry.label}<span className="vela-context-menu__arrow" aria-hidden="true">›</span>
        </button>
        {inPlace && child?.id === entry.id ? renderChild(true) : null}
      </div>;
      return <WorkspaceMenuRow key={entry.id} entry={entry} exiting={exiting} release={release}
        onSelect={() => { if (!entry.keepOpen) onClose(); entry.onSelect(); }} onTool={action => { if (entry.onRename === undefined) onClose(); action(); }} />;
    }} />}

  </div>;
  function renderChild(asInline: boolean) {
    if (child === null || childEntry?.kind !== "submenu") return null;
    return <MenuPanel entries={childEntry.entries} x={x} y={y} anchor={child.anchor} inline={asInline} focusOnOpen={child.keyboard}
      active={child.open} onReleased={() => setChild(current => current?.open === false ? null : current)}
      onClose={onClose} onBack={() => { child.anchor.focus(); closeChild(); }} />;
  }
  return <>{panel}{!inPlace ? renderChild(false) : null}</>;
}
