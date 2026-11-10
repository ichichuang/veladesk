"use client";

import { useEffect, useMemo, useRef } from "react";
import type {
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
  RefObject,
} from "react";
import type { EntityId, WorkspaceSnapshot } from "@veladesk/domain";

import { gsap } from "@components/vd/gsap";
import { VD_MOTION_EASE, vdMotionDuration } from "@components/vd/motion-tokens";
import { useVdReducedMotion } from "@components/vd/reduced-motion";
import { VdTooltip, VdTooltipProvider } from "@components/vd/tooltip";
import { useVdHoverLift } from "@components/vd/hover-lift";

import { useI18n } from "../i18n/use-i18n";
import { resolveDockEntities } from "./dock-model";
import {
  contextMenuAnchorFromElement,
  isContextMenuKeyEvent,
} from "./context-menu";
import { appIconDecorationProps, AppIconGlyph } from "./app-icon-renderer";
import { generatedIconText } from "./generated-icon";
import { IconText } from "./icon-text";
import { launchApp } from "./launch-app";
import "./home-shell.css";

/*
 * The magnetic dock (Helm first picture): restrained proximity
 * magnification — each icon's VISUAL node scales by how close the pointer
 * is (never the button, so hit geometry and the dock's spacing stay exact),
 * interpolated by GSAP quickTo on the hover-press token. The transform
 * shares the visual node with the hover lift (y), different properties —
 * the two engines-in-one-rule never fight. Reduced motion: no magnification.
 */
const DOCK_MAGNIFY_REACH_PX = 130;
const DOCK_MAGNIFY_MAX_SCALE_ADD = 0.22;

function useDockMagnetism(dockRef: RefObject<HTMLElement | null>): void {
  const reducedMotion = useVdReducedMotion();
  useEffect(() => {
    const dock = dockRef.current;
    if (dock === null || reducedMotion) {
      return;
    }
    /** One quickTo scaler per visual node, built lazily on first pass. */
    const scalers = new Map<HTMLElement, (value: number) => void>();
    let frame = 0;
    const scalerFor = (node: HTMLElement) => {
      let scaler = scalers.get(node);
      if (scaler === undefined) {
        scaler = gsap.quickTo(node, "scale", {
          duration: vdMotionDuration("hoverPress"),
          ease: VD_MOTION_EASE,
        });
        scalers.set(node, scaler);
      }
      return scaler;
    };
    const visuals = () =>
      Array.from(dock.querySelectorAll<HTMLElement>(".vela-dock__item-visual"));
    const applyAt = (clientX: number) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        for (const node of visuals()) {
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0) {
            continue;
          }
          const distance = Math.abs(clientX - (rect.left + rect.width / 2));
          const proximity = Math.max(0, 1 - distance / DOCK_MAGNIFY_REACH_PX);
          scalerFor(node)(1 + DOCK_MAGNIFY_MAX_SCALE_ADD * proximity);
        }
      });
    };
    const settle = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        for (const node of visuals()) {
          scalerFor(node)(1);
        }
      });
    };
    const onPointerMove = (event: PointerEvent) => {
      applyAt(event.clientX);
    };
    dock.addEventListener("pointermove", onPointerMove);
    dock.addEventListener("pointerleave", settle);
    dock.addEventListener("pointercancel", settle);
    return () => {
      cancelAnimationFrame(frame);
      dock.removeEventListener("pointermove", onPointerMove);
      dock.removeEventListener("pointerleave", settle);
      dock.removeEventListener("pointercancel", settle);
      for (const node of visuals()) {
        gsap.set(node, { clearProps: "scale" });
      }
    };
  }, [dockRef, reducedMotion]);
}

/** Runs injected and own handlers in order; a handler may be absent. */
function composed<P extends { defaultPrevented?: boolean }>(
  ...handlers: (((payload: P) => void) | undefined)[]
): (payload: P) => void {
  return (payload) => {
    for (const handler of handlers) {
      handler?.(payload);
    }
  };
}

interface DockProps {
  readonly workspace: WorkspaceSnapshot;
  readonly onOpenFolder: (folderId: EntityId) => void;
  readonly onEntityContextMenu: (entityId: EntityId, x: number, y: number) => void;
  /** Empty-area command menu (native right-click is suppressed here). */
  readonly onDesktopContextMenu: (x: number, y: number) => void;
}

/**
 * Floating bottom dock — pinned entities ONLY (task 015).
 *
 * No utility cluster, no separator, no create/mode buttons: every desktop
 * command moved into the context menu surface. With zero resolvable pins
 * the dock does not exist in the DOM at all (`null` — never an empty
 * shell). Dock apps launch on click; legacy dock folders open their
 * overlay; right-click / Shift+F10 opens the entity context menu.
 *
 * Identity (task 021-C): every dock button carries a VdTooltip whose text
 * is the entity's own name — portalled, so it never moves or resizes the
 * dock. The tooltip is supplemental: the accessible name stays the
 * localized open-label, and no desktop label preference can suppress it.
 * One provider wraps the whole dock so moving between icons re-opens
 * immediately instead of flickering.
 */
interface DockEntityButtonProps {
  readonly className: string;
  readonly ariaLabel: string;
  readonly ariaHasPopup?: "dialog" | undefined;
  readonly decoration?: Record<string, unknown> | undefined;
  readonly onClick: () => void;
  readonly onItemContextMenu: (event: ReactMouseEvent, entityId: EntityId) => void;
  readonly onItemKeyDown: (event: ReactKeyboardEvent<HTMLElement>, entityId: EntityId) => void;
  readonly entityId: EntityId;
  /** The icon surface (an inner visual node the lift applies around). */
  readonly children: React.ReactNode;
}

/**
 * One dock button (022): the GSAP hover lift wraps the INNER visual node
 * (a flex-centered span), so the button's hit geometry and the dock's
 * spacing never change. The tooltip above stays independent of the lift.
 *
 * 023-B.1: the button sits inside a Radix Trigger `asChild` chain, so it
 * MUST forward the injected ref and spread the trigger's injected props
 * (hover/focus handlers, data-state) onto the real focusable button —
 * dropping them left the tooltip without any open signal. Pointer and key
 * handlers are COMPOSED with the injected ones (both run; neither
 * replaces the other), and the click/context handlers stay the dock's own.
 */
/**
 * What the surrounding Radix Trigger `asChild` injects onto this button:
 * the open/close signals (composed below — never replaced) plus state
 * attributes. Described explicitly so the composition is type-checked;
 * any further injected attributes ride along through the spread.
 */
interface DockTriggerInjectionProps {
  readonly onPointerEnter?: ((event: ReactPointerEvent<HTMLButtonElement>) => void) | undefined;
  readonly onPointerLeave?: ((event: ReactPointerEvent<HTMLButtonElement>) => void) | undefined;
  readonly onPointerCancel?: ((event: ReactPointerEvent<HTMLButtonElement>) => void) | undefined;
  readonly onKeyDown?: ((event: ReactKeyboardEvent<HTMLButtonElement>) => void) | undefined;
  readonly onFocus?: ((event: ReactFocusEvent<HTMLButtonElement>) => void) | undefined;
  readonly onBlur?: ((event: ReactFocusEvent<HTMLButtonElement>) => void) | undefined;
}

function DockEntityButton({
  className,
  ariaLabel,
  ariaHasPopup,
  decoration,
  onClick,
  onItemContextMenu,
  onItemKeyDown,
  entityId,
  children,
  ref,
  ...triggerProps
}: DockEntityButtonProps & { readonly ref?: Ref<HTMLButtonElement> } & DockTriggerInjectionProps) {
  const { innerRef, onPointerEnter, onPointerLeave, onPointerCancel, onPointerDown, onPointerUp } = useVdHoverLift(-2);
  return (
    <button
      ref={ref}
      type="button"
      className={className}
      aria-label={ariaLabel}
      aria-haspopup={ariaHasPopup}
      {...triggerProps}
      {...decoration}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerEnter={composed<ReactPointerEvent<HTMLButtonElement>>(
        onPointerEnter,
        triggerProps.onPointerEnter,
      )}
      onPointerLeave={composed<ReactPointerEvent<HTMLButtonElement>>(
        onPointerLeave,
        triggerProps.onPointerLeave,
      )}
      onPointerCancel={composed<ReactPointerEvent<HTMLButtonElement>>(
        onPointerCancel,
        triggerProps.onPointerCancel,
      )}
      onContextMenu={(event: ReactMouseEvent) => onItemContextMenu(event, entityId)}
      onKeyDown={composed<ReactKeyboardEvent<HTMLButtonElement>>(
        (event) => onItemKeyDown(event, entityId),
        triggerProps.onKeyDown,
      )}
    >
      <span
        ref={innerRef}
        className="vela-dock__item-visual"
        style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        {children}
      </span>
    </button>
  );
}

export function Dock({ workspace, onOpenFolder, onEntityContextMenu, onDesktopContextMenu }: DockProps) {
  const { t } = useI18n();
  const dockRef = useRef<HTMLElement | null>(null);
  useDockMagnetism(dockRef);

  const dockEntities = useMemo(() => resolveDockEntities(workspace), [workspace]);

  if (dockEntities.length === 0) {
    return null;
  }

  function handleEntityContextMenu(event: ReactMouseEvent, entityId: EntityId) {
    event.preventDefault();
    event.stopPropagation();
    onEntityContextMenu(entityId, event.clientX, event.clientY);
  }

  function handleEntityKeyDown(event: ReactKeyboardEvent<HTMLElement>, entityId: EntityId) {
    if (!isContextMenuKeyEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const anchor = contextMenuAnchorFromElement(event.currentTarget);
    onEntityContextMenu(entityId, anchor.x, anchor.y);
  }

  return (
    <VdTooltipProvider skipDelayDuration={120}>
      <nav
        className="vela-dock"
        data-vd-scroll="x"
        aria-label={t("dock.label")}
        ref={dockRef}
        onContextMenu={(event) => {
          // Dock surface: never the browser menu; empty dock chrome falls
          // through to the desktop command menu.
          event.preventDefault();
          onDesktopContextMenu(event.clientX, event.clientY);
        }}
      >
        {dockEntities.map((entity) =>
          entity.kind === "app" ? (
            <VdTooltip key={entity.id} content={entity.name}>
              <DockEntityButton
                className="vela-dock__item"
                ariaLabel={t("dock.openApp", { name: entity.name })}
                decoration={appIconDecorationProps(entity)}
                data-appearance-app-id={entity.id}
                onClick={() => launchApp(entity)}
                onItemContextMenu={handleEntityContextMenu}
                onItemKeyDown={handleEntityKeyDown}
                entityId={entity.id}
              >
                <AppIconGlyph app={entity} />
              </DockEntityButton>
            </VdTooltip>
          ) : (
            <VdTooltip key={entity.id} content={entity.name}>
              <DockEntityButton
                className="vela-dock__item vela-dock__item--folder"
                ariaLabel={t("dock.openFolder", { name: entity.name })}
                ariaHasPopup="dialog"
                onClick={() => onOpenFolder(entity.id)}
                onItemContextMenu={handleEntityContextMenu}
                onItemKeyDown={handleEntityKeyDown}
                entityId={entity.id}
              >
                <IconText text={generatedIconText(entity.name)} />
              </DockEntityButton>
            </VdTooltip>
          )
        )}
      </nav>
    </VdTooltipProvider>
  );
}
