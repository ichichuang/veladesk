"use client";

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { Circle } from "lucide-react";

import { cn } from "./cn";

/** Designed RadioGroup: token indicator dot, Radix arrow-key roving. */
export function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root className={cn("grid gap-2", className)} {...props} />;
}

export function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        "aspect-square size-[18px] shrink-0 rounded-full border border-vdu-border-strong",
        "outline-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vdu-focus)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:border-vdu-accent",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <Circle size={8} className="fill-vdu-accent text-vdu-accent" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}
