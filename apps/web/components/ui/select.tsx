"use client";

import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "./cn";
import { useVdPortalContainer } from "./overlay-scope";
import { VdPopupSurface } from "@components/vd/animated-surface";

/**
 * Designed Select (task 018, GSAP surface 022): Radix Select with token
 * trigger/portal content. The menu portals into the shared themed portal
 * root so it never closes or escapes its parent dialog scope. Radix owns
 * the popper positioning and unmount-on-close; the GSAP VdPopupSurface is
 * the inner visual surface (replacing the CSS vdu-pop-in keyframe).
 */
export function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root {...props} />;
}

export function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value {...props} />;
}

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-9 w-full items-center justify-between gap-2 rounded-vdu border border-vdu-border",
        "bg-vdu-bg-raised px-3 text-sm text-vdu-fg hover:border-vdu-border-strong",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--vdu-focus)]",
        "data-[placeholder]:text-vdu-fg-muted disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown size={15} className="size-[15px] shrink-0 text-vdu-fg-muted" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const portalContainer = useVdPortalContainer();
  return (
    <SelectPrimitive.Portal container={portalContainer}>
      <SelectPrimitive.Content
        position={position}
        className={cn(
          "z-50 min-w-[var(--radix-select-trigger-width)]",
          className,
        )}
        {...props}
      >
        <VdPopupSurface
          variant="popup"
          className="overflow-hidden rounded-vdu border border-vdu-border bg-vdu-bg shadow-[var(--vdu-shadow-pop)]"
        >
          <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        </VdPopupSurface>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-[6px] py-1.5 pl-7 pr-3",
        "text-sm text-vdu-fg outline-none",
        "data-[highlighted]:bg-vdu-bg-hover",
        "data-[state=checked]:text-vdu-fg data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check size={14} className="text-vdu-accent" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
