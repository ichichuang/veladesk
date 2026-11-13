"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { UNSAFE_PortalProvider } from "react-aria";
import { X } from "lucide-react";

import { cn } from "./cn";
import { useVdPortalContainer } from "./overlay-scope";
import { useVdPresence } from "@components/vd/presence";
import { VdAnimatedSurface } from "@components/vd/animated-surface";
import type { VdSurfaceVariant } from "@components/vd/animated-surface";

/**
 * Designed Dialog (task 018, GSAP presence 022): Radix Dialog semantics
 * (focus containment, Escape, aria) with GSAP-owned entrance/exit on an
 * INNER visual surface. The Radix Content element is the OUTER positioning
 * node only — GSAP never writes its centered `translate(-50%,-50%)`.
 *
 * Ownership (022): the window enter/exit belongs to GSAP through
 * {@link VdAnimatedSurface}; durations come only from the canonical
 * preset module. No springs, no overshoot; the exit is slightly quicker
 * than the entrance.
 *
 * Usage is CONTROLLED: `<Dialog open onOpenChange>` — the open flag flows
 * to {@link DialogContent} through context. Presence is lifecycle-correct:
 * a close intent starts the exit timeline while the Radix primitive stays
 * mounted (forceMount) with its semantics coherent; only the current exit
 * completion releases presence (unmounts the portal subtree). Reopening
 * during an exit retargets the SAME surface — no remount, no lost state.
 * While exiting, the surface is pointer-inert. The portal targets the
 * shared themed overlay root; no CSS transitions/keyframes ride these
 * nodes.
 */

const DialogOpenContext = createContext<boolean>(true);

export function Dialog({
  open,
  onOpenChange,
  children,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Root>, "open" | "onOpenChange"> & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} {...props}>
      <DialogOpenContext.Provider value={open !== false}>{children}</DialogOpenContext.Provider>
    </DialogPrimitive.Root>
  );
}

/**
 * Panel variant (task 019-C): a fixed RIGHT-side inspector overlay for
 * surfaces whose subject must stay visible behind them (the live desktop
 * appearance inspector). Anchored to the viewport edge — it never
 * participates in workbench/grid layout — with a lighter scrim so the
 * inspected content stays readable, and an x-entrance instead of the
 * centered rise.
 */
export function DialogContent({
  className,
  children,
  onExitComplete,
  showCloseButton = true,
  variant = "center",
  motionPreset,
  sheet = false,
  surfaceTone = "glass",
  surfaceProps,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  readonly onExitComplete?: (() => void) | undefined;
  /** Renders the standard top-right close affordance. Default true. */
  readonly showCloseButton?: boolean;
  /** "center" modal (default) or "panel" — a right-anchored inspector. */
  readonly variant?: "center" | "panel";
  /**
   * Canonical motion timing (022): "picker" (the secondary icon-picker
   * windows) uses the quicker popup band; "editor" (t171) uses the
   * editing-window band — rise from scale 0.96 + 8px on the window-open
   * curve; otherwise panel/dialog by variant. Durations live in the
   * preset module.
   */
  readonly motionPreset?: "dialog" | "panel" | "picker" | "editor";
  /**
   * Small-screen placement (t171): instead of the centered window the
   * content becomes a full-screen bottom sheet — anchored to the viewport
   * edges, filled by the surface, sliding in/out with the sheet pose (no
   * scale). The caller owns the responsive decision (a media-query hook).
   */
  readonly sheet?: boolean;
  /**
   * Window material (t171 legibility spec): "glass" (default) rides the
   * interface-style alpha + backdrop blur; "solid" paints the OPAQUE
   * window token — the ground under long-form text in editing overlays,
   * where muted copy must keep its contrast over any wallpaper.
   */
  readonly surfaceTone?: "glass" | "solid";
  /**
   * Extra attributes for the INNER painted surface — NOT the outer
   * positioning node, where the rest of the props land. Settings
   * (023-R2) marks its window `data-settings-surface` so the canonical
   * stylesheet rule has exactly one size owner to key on; every other
   * dialog leaves this undefined and its surface is untouched.
   */
  readonly surfaceProps?: React.HTMLAttributes<HTMLDivElement> & {
    readonly [key: `data-${string}`]: string | undefined;
  };
}) {
  const portalContainer = useVdPortalContainer();
  const open = useContext(DialogOpenContext);
  const panel = variant === "panel";
  const surfaceVariant: VdSurfaceVariant = sheet
    ? "sheet"
    : motionPreset === "picker"
      ? "popup"
      : motionPreset === "editor"
        ? "editor"
        : panel
          ? "panel"
          : "dialog";
  const presence = useVdPresence(open);

  /**
   * The OUTER positioning node doubles as the HOST for React Aria / HeroUI
   * overlays opened from inside this dialog (021-R1 follow-up). While a
   * Radix modal is open, react-remove-scroll puts `pointer-events: none`
   * on `body` and only the dialog's own subtree re-enables it — a HeroUI
   * Select popup portalled to the global themed root rendered fine but
   * could never be clicked (and Radix would have treated its pointerdown
   * as outside-dismissal). A nested UNSAFE_PortalProvider (the installed
   * react-aria integration, composing over the shell's outer one) routes
   * those overlays INTO this element, where pointer events, outside-
   * dismissal, the focus scope and the scroll-lock shard all agree, and
   * the theme is inherited through the themed portal root that hosts the
   * dialog itself. react-aria's positioning measures the container with
   * getBoundingClientRect, so the outer node's resting centering
   * translate is accounted for — the GSAP surface inside never touches
   * positioning transforms.
   */
  const [overlayHost, setOverlayHost] = useState<HTMLDivElement | null>(null);
  const getOverlayHost = useCallback(() => overlayHost, [overlayHost]);

  if (!presence.mounted) {
    return null;
  }
  const completeExit = presence.completeExit;

  return (
    <DialogPrimitive.Portal forceMount container={portalContainer}>
      <DialogPrimitive.Overlay asChild forceMount>
        <VdAnimatedSurface
          variant="overlay"
          active={open}
          className={cn("fixed inset-0 z-50", panel ? "bg-black/15" : "bg-black/55")}
        />
      </DialogPrimitive.Overlay>
      <DialogPrimitive.Content
        asChild
        forceMount
        onEscapeKeyDown={(event) => {
          // A nested react-aria/HeroUI overlay opened INSIDE this dialog
          // (a Select listbox, a popover) owns the FIRST Escape — its own
          // handler closes it (and detaches it) BEFORE this Radix
          // callback runs, so the check cannot look for a live overlay in
          // the DOM. It rides the EVENT PATH instead: focus inside this
          // dialog's overlay HOST but outside the painted SURFACE means a
          // nested overlay had focus, and the modal must not be dismissed
          // underneath it.
          if (overlayHost === null) {
            return;
          }
          const path = event.composedPath();
          const surface = overlayHost.querySelector(":scope > [data-vd-dialog-surface]");
          // A LIVE (still-connected) node of this dialog's overlay host
          // that is not part of the painted surface = an open nested
          // overlay owning this Escape. Detached exit remnants (their
          // nodes leave the tree before this Radix callback runs) must NOT
          // block — the modal then closes normally on the next Escape.
          const liveOverlay = path.some(
            (node) =>
              node instanceof Node &&
              node !== overlayHost && // the host itself is not an overlay
              node.isConnected &&
              overlayHost.contains(node) &&
              (surface === null || !surface.contains(node)),
          );
          if (liveOverlay) {
            event.preventDefault();
          }
        }}
        {...props}
      >
        {/* OUTER positioning node (Radix-owned placement semantics; never
            animated). The centered variant shrinkwraps the inner surface so
            the -50%,-50% translate is exact. */}
        <div
          ref={setOverlayHost}
          // While the exit plays the whole window is non-interactive and
          // non-focusable (no hidden modal may keep focusable content).
          inert={open ? undefined : true}
          className={cn(
            "z-50 flex flex-col outline-none",
            panel
              ? "fixed right-0 top-0 h-dvh w-[calc(100vw_-_16px)] max-w-[400px]"
              : sheet
                ? "fixed inset-0"
                : // Centered window: the outer node shrinkwraps the surface
                  // (w-max, auto height) — the surface may carry an EXPLICIT
                  // h-[], so it must not be a flex-grow item (flex-basis 0
                  // would override the height and re-content-size the
                  // window, t171). Panel/sheet surfaces FILL their outer.
                  "fixed left-1/2 top-1/2 w-max -translate-x-1/2 -translate-y-1/2 max-w-[calc(100vw_-_32px)] max-h-[calc(100dvh_-_32px)]",
          )}
        >
          {/* INNER visual surface — the GSAP-owned window. The marker
              attributes the Escape-ownership check above. */}
          <VdAnimatedSurface
            data-vd-dialog-surface=""
            variant={surfaceVariant}
            active={open}
            onPresenceReleased={() => { completeExit(); onExitComplete?.(); }}
            {...surfaceProps}
            className={cn(
              "flex min-h-0 flex-col",
              panel || sheet ? "flex-1" : "flex-none",
              panel
                ? "rounded-l-vdu-dialog border-l border-vdu-border"
                : sheet
                  ? "rounded-t-vdu-dialog border-t border-vdu-border"
                  : "rounded-vdu-dialog border border-vdu-border",
              // The window surface follows the interface style (translucent
              // + backdrop blur while a style is active; solid fallback).
              // The SOLID tone (t171) paints the opaque window token with
              // no blur — the legible ground for editing overlays.
              surfaceTone === "solid"
                ? "bg-[var(--vdu-window-solid)]"
                : "bg-[var(--vdu-window)] backdrop-blur-[var(--vdu-window-blur)]",
              "shadow-[var(--vdu-shadow)]",
              className,
            )}
          >
            <UNSAFE_PortalProvider getContainer={getOverlayHost}>
              {children}
            </UNSAFE_PortalProvider>
            {showCloseButton ? (
              <DialogPrimitive.Close
                className={cn(
                  "absolute right-3.5 top-3.5 flex size-8 items-center justify-center",
                  "rounded-[6px] text-vdu-fg-muted",
                  "hover:bg-vdu-bg-hover hover:text-vdu-fg",
                  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vdu-focus)]",
                )}
              >
                <X size={16} />
              </DialogPrimitive.Close>
            ) : null}
          </VdAnimatedSurface>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-lg font-semibold text-vdu-fg", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-xs leading-relaxed text-vdu-fg-muted", className)}
      {...props}
    />
  );
}
