"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";

import { useVdPortalContainer } from "@components/ui/overlay-scope";
import { useVdPresence } from "@components/vd/presence";
import { VdAnimatedSurface } from "@components/vd/animated-surface";

/**
 * The shared mobile sheet surface (task 026 §30/§34/§47; sizing split in
 * 026-R1): Radix Dialog SEMANTICS (focus containment, Escape, aria) with
 * the GSAP-owned visual layer — the same ownership model as the desktop
 * Dialog (022), shaped for phones:
 *
 *  - "menu" — a content-sized bottom sheet (the tiny mobile menu): the
 *    block follows its content with a capped max, never a tall fixed slab.
 *  - "folder" — a tall bottom sheet (folder contents), max-height
 *    min(82dvh, 640px), internal scroll.
 *  - "fullscreen" — a near-fullscreen surface (search) filling the viewport.
 *
 * Presence is lifecycle-correct: a close intent plays the exit while the
 * Radix primitive stays mounted (forceMount); the completion releases the
 * subtree exactly once. While exiting, the surface is pointer-inert. The
 * portal targets the mobile shell's themed overlay root.
 */
export function MobileSheet({
  open,
  onOpenChange,
  variant,
  label,
  children,
  showCloseButton = true,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly variant: "menu" | "folder" | "fullscreen";
  /** Accessible name of the dialog surface. */
  readonly label: string;
  readonly children: ReactNode;
  readonly showCloseButton?: boolean;
}) {
  const portalContainer = useVdPortalContainer();
  const presence = useVdPresence(open);
  const completeExit = presence.completeExit;

  // Deterministic focus return (§37/§77): capture the opener at mount (a
  // child effect runs before the Radix focus trap moves focus) and restore
  // it after the subtree is gone — one macrotask after unmount, past the
  // presence release and any library cleanup ordering.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener !== null && opener.isConnected) {
        window.setTimeout(() => {
          opener.focus();
        }, 0);
      }
    };
  }, []);

  if (!presence.mounted) {
    return null;
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal forceMount container={portalContainer}>
        <DialogPrimitive.Overlay asChild forceMount>
          <VdAnimatedSurface
            variant="overlay"
            active={open}
            onPresenceReleased={completeExit}
            className="vela-mobile-sheet__scrim"
          />
        </DialogPrimitive.Overlay>
        <DialogPrimitive.Content asChild forceMount aria-label={label}>
          <div
            className={
              variant === "fullscreen"
                ? "vela-mobile-sheet--fullscreen-host"
                : "vela-mobile-sheet--bottom-host"
            }
            // Pointer-inert while the exit plays; no hidden modal keeps
            // focusable content.
            inert={open ? undefined : true}
          >
            <VdAnimatedSurface
              variant="popup"
              active={open}
              onPresenceReleased={completeExit}
              className={`vela-mobile-sheet__surface--${variant}`}
            >
              {children}
              {showCloseButton ? (
                <DialogPrimitive.Close
                  aria-label={label}
                  className="vela-mobile-icon-button vela-mobile-sheet__close"
                >
                  <X size={18} />
                </DialogPrimitive.Close>
              ) : null}
            </VdAnimatedSurface>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
