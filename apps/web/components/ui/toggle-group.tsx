"use client";

import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";

import { cn } from "./cn";

/**
 * Designed single-selection ToggleGroup (task 018): the segmented-choice
 * control for short option sets (theme mode, language). `type="single"` with
 * Radix keyboard roving and an accent wash selected state.
 */
export function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      className={cn(
        "inline-flex h-9 items-center gap-0.5 rounded-vdu bg-vdu-bg-raised p-1",
        className,
      )}
      {...props}
    />
  );
}

export function ToggleGroupItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        "inline-flex h-[28px] min-w-[52px] items-center justify-center rounded-[6px] px-2.5",
        "text-sm font-medium text-vdu-fg-muted",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vdu-focus)]",
        "hover:text-vdu-fg data-[state=on]:bg-vdu-accent-wash-strong data-[state=on]:text-vdu-fg",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
}
