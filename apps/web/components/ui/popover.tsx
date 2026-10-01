"use client";

import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "./cn";
import { useVdPortalContainer } from "./overlay-scope";
import { VdPopupSurface } from "@components/vd/animated-surface";

/**
 * Designed Popover (task 018, GSAP surface 022): portalled into the shared
 * themed root so a popover opened inside a dialog stays inside that
 * dialog's interaction scope and never closes its parent. Radix owns the
 * positioning node and the open/close lifecycle (it unmounts on close);
 * the GSAP VdPopupSurface is the INNER visual surface (opacity + 4px
 * settle on the popup token) — the floating transform is never touched.
 */
export const Popover = PopoverPrimitive.Root;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const portalContainer = useVdPortalContainer();
  return (
    <PopoverPrimitive.Portal container={portalContainer}>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className="z-50 outline-none"
        {...props}
      >
        <VdPopupSurface
          variant="popup"
          className={cn(
            "rounded-vdu border border-vdu-border bg-[var(--vdu-window)] backdrop-blur-[var(--vdu-window-blur)] p-3",
            "shadow-[var(--vdu-shadow-pop)]",
            className,
          )}
        >
          {children}
        </VdPopupSurface>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
