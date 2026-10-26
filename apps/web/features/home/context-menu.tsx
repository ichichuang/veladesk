"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { Pencil, Trash2 } from "lucide-react";
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
      if (!root.current?.contains(event.target as Node)) onClose();
    }
    function escape(event: KeyboardEvent) {
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

function MenuPanel({ entries, x, y, anchor, inline = false, focusOnOpen = true, onClose, onBack }: {
  readonly entries: readonly DesktopMenuEntry[];
  readonly x: number;
  readonly y: number;
  readonly anchor?: HTMLElement;
  readonly inline?: boolean;
  readonly focusOnOpen?: boolean;
  readonly onClose: () => void;
  readonly onBack?: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [child, setChild] = useState<{ id: string; anchor: HTMLButtonElement; keyboard: boolean } | null>(null);
  const reducedMotion = useVdReducedMotion();
  const inPlace = inline || (typeof window !== "undefined" && (window.innerWidth < 600 || window.matchMedia?.("(hover: none)").matches));
  const childEntry = entries.find(entry => entry.kind === "submenu" && entry.id === child?.id);
  function items() {
    const menu = menuRef.current;
    return Array.from(menu?.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR) ?? []).filter(item => item.closest('[role="menu"]') === menu);
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
    if (reducedMotion) { gsap.set(menu, { opacity: 1, scale: 1, y: 0 }); return; }
    gsap.fromTo(menu, { opacity: 0, scale: .98, y: -2 }, { opacity: 1, scale: 1, y: 0, duration: vdMotionDuration("popup"), ease: VD_MOTION_EASE });
    return () => { gsap.killTweensOf(menu); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position !== null, reducedMotion]);
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('[role="menu"]') !== menuRef.current) return;
    const rows = items();
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End", "Escape", "ArrowLeft"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Escape" || event.key === "ArrowLeft") {
        if (child !== null) { child.anchor.focus(); setChild(null); }
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
    setChild({ id, anchor: button, keyboard });
  }
  const panel = <div ref={menuRef} role="menu" aria-orientation="vertical"
    className={`vela-context-menu${anchor !== undefined ? " vela-workspace-submenu" : ""}${inline ? " vela-context-menu--inline" : ""}`}
    data-vd-wheel-scope="local" data-measured={position !== null ? "true" : undefined}
    style={inline ? undefined : position === null ? { visibility: "hidden", left: x, top: y } : { left: position.x, top: position.y }}
    onKeyDown={handleKeyDown} onContextMenu={(event: ReactMouseEvent) => { event.preventDefault(); event.stopPropagation(); }}>
    {entries.map((entry, index) => {
      if (entry.kind === "separator") return <div key={`separator-${index}`} role="separator" className="vela-context-menu__separator" />;
      if (entry.kind === "submenu") return <div key={entry.id}>
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={child?.id === entry.id} className="vela-context-menu__item"
          onMouseEnter={event => {
            const button = event.currentTarget;
            clearTimeout(hoverTimer.current);
            hoverTimer.current = setTimeout(() => openChild(entry.id, button, false), 150);
          }}
          onMouseLeave={() => clearTimeout(hoverTimer.current)}
          onKeyDown={event => { if (["ArrowRight", "Enter", " "].includes(event.key)) { event.preventDefault(); event.stopPropagation(); openChild(entry.id, event.currentTarget, true); } }}
          onClick={event => inPlace && child?.id === entry.id ? setChild(null) : openChild(entry.id, event.currentTarget, true)}>
          {entry.label}<span className="vela-context-menu__arrow" aria-hidden="true">›</span>
        </button>
        {inPlace && child?.id === entry.id ? renderChild(true) : null}
      </div>;
      return <div key={entry.id} className="vela-workspace-menu-row" onMouseEnter={() => { clearTimeout(hoverTimer.current); setChild(null); }}>
        <button type="button" role={entry.checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={entry.checked}
          className="vela-context-menu__item" disabled={entry.disabled} title={entry.reason}
          onClick={() => { onClose(); entry.onSelect(); }}>
          {entry.checked === undefined ? null : <span className="vela-context-menu__check" aria-hidden="true">{entry.checked ? "✓" : ""}</span>}
          <span className="vela-workspace-menu-name">{entry.label}</span>
        </button>
        {entry.tools === undefined ? null : <span className="vela-workspace-menu-tools">
          {entry.tools.map(tool => <span key={tool.icon} title={tool.reason ?? tool.label}>
            <button type="button" aria-label={tool.label} title={tool.reason ?? tool.label} disabled={tool.disabled}
              onClick={() => { onClose(); tool.onSelect(); }}>
              {tool.icon === "rename" ? <Pencil size={14} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
            </button>
          </span>)}
        </span>}
      </div>;
    })}
  </div>;
  function renderChild(asInline: boolean) {
    if (child === null || childEntry?.kind !== "submenu") return null;
    return <MenuPanel entries={childEntry.entries} x={x} y={y} anchor={child.anchor} inline={asInline} focusOnOpen={child.keyboard}
      onClose={onClose} onBack={() => { child.anchor.focus(); setChild(null); }} />;
  }
  return <>{panel}{!inPlace ? renderChild(false) : null}</>;
}
