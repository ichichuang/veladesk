"use client";

import { Label as LabelPrimitive } from "radix-ui";

import { cn } from "./cn";

/** Designed Label: 14px control text with token muted color. */
export function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn("text-sm font-medium text-vdu-fg", className)}
      {...props}
    />
  );
}
