"use client";

import { Slider as SliderPrimitive } from "radix-ui";

import { cn } from "./cn";

/**
 * Designed Slider (task 018): the continuous-value control. Compact width is
 * caller's choice — the control never expands full-width on its own. Radix
 * owns arrow-key increments and pointer dragging; the readout (current value
 * + units) is rendered by the caller next to it.
 */
export function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn(
        "relative flex h-9 w-full touch-none select-none items-center",
        "data-[disabled]:opacity-50 data-[disabled]:pointer-events-none",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-[5px] w-full grow overflow-hidden rounded-full bg-vdu-bg-active">
        <SliderPrimitive.Range className="absolute h-full bg-vdu-accent" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={cn(
          "block size-[16px] rounded-full bg-vdu-fg shadow-sm border-2 border-vdu-bg",
          "hover:scale-110 active:scale-95 cursor-grab",
          "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vdu-focus)]",
          "data-[disabled]:cursor-not-allowed",
        )}
      />
    </SliderPrimitive.Root>
  );
}
