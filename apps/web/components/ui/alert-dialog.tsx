"use client";

import { createContext, useContext } from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";

import { cn } from "./cn";
import { Button, type ButtonProps } from "./button";
import { useVdPortalContainer } from "./overlay-scope";
import { useVdPresence } from "@components/vd/presence";
import { VdAnimatedSurface } from "@components/vd/animated-surface";

/**
 * Designed AlertDialog (task 018, GSAP presence 022): Radix AlertDialog
 * (explicit confirmation semantics — no accidental dismiss on backdrop
 * click) with the same GSAP presence lifecycle as Dialog. Radix owns the
 * semantics; GSAP animates the INNER visual surface inside an OUTER
 * positioning node; the exit releases presence exactly once and the
 * surface is inert while it plays.
 */

const AlertDialogOpenContext = createContext<boolean>(true);

export function AlertDialog({
  open,
  onOpenChange,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof AlertDialogPrimitive.Root>,
  "open" | "onOpenChange"
> & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange} {...props}>
      <AlertDialogOpenContext.Provider value={open !== false}>
        {children}
      </AlertDialogOpenContext.Provider>
    </AlertDialogPrimitive.Root>
  );
}

export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

export function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  const portalContainer = useVdPortalContainer();
  const open = useContext(AlertDialogOpenContext);
  const presence = useVdPresence(open);
  if (!presence.mounted) {
    return null;
  }
  return (
    <AlertDialogPrimitive.Portal forceMount container={portalContainer}>
      <AlertDialogPrimitive.Overlay asChild forceMount>
        <VdAnimatedSurface
          variant="overlay"
          active={open}
          onPresenceReleased={presence.completeExit}
          className="fixed inset-0 z-50 bg-black/55"
        />
      </AlertDialogPrimitive.Overlay>
      <AlertDialogPrimitive.Content asChild forceMount {...props}>
        <div
          inert={open ? undefined : true}
          className="fixed left-1/2 top-1/2 z-50 flex w-max max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col outline-none"
        >
          <VdAnimatedSurface
            variant="dialog"
            active={open}
            onPresenceReleased={presence.completeExit}
            className={cn(
              "flex min-h-0 w-[calc(100vw-48px)] max-w-[400px] flex-col gap-4 p-5",
              "rounded-vdu-dialog border border-vdu-border bg-vdu-bg",
              "shadow-[var(--vdu-shadow)]",
              className,
            )}
          >
            {children}
          </VdAnimatedSurface>
        </div>
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      className={cn("text-base font-semibold text-vdu-fg", className)}
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      className={cn("text-sm leading-relaxed text-vdu-fg-muted", className)}
      {...props}
    />
  );
}

export function AlertDialogAction({
  className,
  variant = "danger",
  ...props
}: ButtonProps) {
  return (
    <AlertDialogPrimitive.Action asChild>
      <Button className={className} variant={variant} {...props} />
    </AlertDialogPrimitive.Action>
  );
}

export function AlertDialogCancel({ className, ...props }: ButtonProps) {
  return (
    <AlertDialogPrimitive.Cancel asChild>
      <Button className={className} {...props} />
    </AlertDialogPrimitive.Cancel>
  );
}
