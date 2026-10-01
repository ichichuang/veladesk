"use client";

import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "./cn";

/**
 * Designed Switch (task 018): the boolean control for settings like "show
 * application names" and "start in View mode". 36px row hit area, token
 * track/knob colors, animated knob that MotionConfig never needs to own.
 */
export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center",
        "rounded-full border border-transparent",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vdu-focus)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-vdu-accent data-[state=unchecked]:bg-vdu-bg-active",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-[16px] rounded-full bg-vdu-bg shadow-sm",
          
          "translate-x-[3px] data-[state=checked]:translate-x-[19px]",
          "data-[state=checked]:bg-vdu-accent-fg",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
