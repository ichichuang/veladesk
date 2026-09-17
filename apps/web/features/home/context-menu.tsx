"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";

import { clampContextMenuPosition } from "./context-menu-position";
import "./home-shell.css";

/** One selectable action in a context menu. */
export interface ContextMenuAction {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export interface ContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly actions: readonly ContextMenuAction[];
}

/** Whether a keyboard event asks for the context menu (Shift+F10 / Menu key). */
export function isContextMenuKeyEvent(event: {
  key: string;
  shiftKey: boolean;
}): boolean {
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}

/** Anchor coordinates from an element, for keyboard-opened menus. */
export function contextMenuAnchorFromElement(element: Element): {
  x: number;
  y: number;
} {
  const rect = element.getBoundingClientRect();
  return { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) };
}

interface ContextMenuProps {
  readonly state: ContextMenuState;
  readonly onClose: () => void;
}

/**
 * The shared context menu primitive: a small glass surface with
 * role="menu" semantics.
 *
 * Rendered unmeasured, then clamped against the real viewport with the
 * measured size. Keyboard: ArrowUp/Down/Home/End cycle enabled items,
 * Escape closes; the first enabled item receives focus on open; a click
 * outside closes.
 */
export function ContextMenu({ state, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  // Measure the real menu rect, then clamp once.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null) {
      return;
    }
    const rect = menu.getBoundingClientRect();
    setPosition(
      clampContextMenuPosition({
        x: state.x,
        y: state.y,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        menuWidth: rect.width,
        menuHeight: rect.height,
      })
    );
  }, [state]);

  // Focus can only land once the menu is visible (post-measurement).
  useEffect(() => {
    if (position === null) {
      return;
    }
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus();
  }, [position]);

  // Escape always closes, even when no menu item holds focus.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    window.addEventListener("mousedown", handleMouseDown);
    return () => window.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const menu = menuRef.current;
    if (menu === null) {
      return;
    }
    const items = Array.from(
      menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
    );
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        event.stopPropagation();
        items[(currentIndex + 1 + items.length) % items.length]?.focus();
        return;
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        items[(currentIndex - 1 + items.length) % items.length]?.focus();
        return;
      case "Home":
        event.preventDefault();
        event.stopPropagation();
        items[0]?.focus();
        return;
      case "End":
        event.preventDefault();
        event.stopPropagation();
        items[items.length - 1]?.focus();
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      default:
        return;
    }
  }

  return (
    <div
      ref={menuRef}
      className="vela-context-menu"
      role="menu"
      aria-orientation="vertical"
      data-measured={position !== null ? "true" : undefined}
      style={
        position === null
          ? { visibility: "hidden", left: state.x, top: state.y }
          : { left: position.x, top: position.y }
      }
      onKeyDown={handleKeyDown}
      onContextMenu={(event: ReactMouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {state.actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          className="vela-context-menu__item"
          disabled={action.disabled === true}
          onClick={() => {
            onClose();
            action.onSelect();
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
