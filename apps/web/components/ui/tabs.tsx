"use client";

import { Tabs as TabsPrimitive } from "radix-ui";

import { cn } from "./cn";

/**
 * Designed Tabs (task 018): compact tab list with an accent underline
 * indicator. The shared-layout animated indicator is layered by the owner
 * (Motion `layoutId`) — these are the presentational primitives.
 */
export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex h-9 items-center gap-1 rounded-vdu bg-vdu-bg-raised p-1",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-[28px] items-center justify-center gap-1.5 rounded-[6px] px-3",
        "text-sm font-medium text-vdu-fg-muted",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vdu-focus)]",
        "hover:text-vdu-fg",
        "data-[state=active]:bg-vdu-accent-wash-strong data-[state=active]:text-vdu-fg",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("outline-none", className)}
      {...props}
    />
  );
}
