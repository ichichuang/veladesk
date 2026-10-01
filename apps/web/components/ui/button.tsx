"use client";

import { forwardRef, useState } from "react";
import type { ButtonHTMLAttributes, PointerEvent as ReactPointerEvent } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./cn";
import { VdPressFeedback } from "@components/vd/press-feedback";

/**
 * Designed Button (task 018, GSAP press 022). Semantic HTML buttons with
 * the token surface system — primary/secondary/ghost/danger intents, 36px
 * default rows, 30px compact rows, 9px radius, token focus ring, explicit
 * disabled styling.
 *
 * 022 interaction ownership: hover color is an instant static state change
 * (the CSS color transition is removed — no tween engine animates it), and
 * the press scale lives on the INNER VdPressFeedback node so the button's
 * hit geometry stays stable. One owned retargetable tween per press state.
 */
const buttonVariants = cva(
  [
    "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap",
    "rounded-vdu text-sm font-medium",
    "disabled:pointer-events-none disabled:opacity-50",
    "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vdu-focus)]",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-vdu-accent text-vdu-accent-fg hover:bg-vdu-accent-hover disabled:bg-vdu-accent",
        secondary:
          "border border-vdu-border bg-vdu-bg-raised text-vdu-fg hover:bg-vdu-bg-hover hover:border-vdu-border-strong",
        ghost: "text-vdu-fg-muted hover:bg-vdu-bg-hover hover:text-vdu-fg",
        danger: "bg-vdu-danger text-vdu-danger-fg hover:bg-vdu-danger-hover",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-[30px] px-3 text-xs",
        icon: "h-9 w-9",
        "icon-sm": "h-[30px] w-[30px]",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = "button", onPointerDown, onPointerUp, onPointerCancel, onPointerLeave, children, ...props },
  ref,
) {
  const [pressed, setPressed] = useState(false);
  const pressStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(event);
    setPressed(true);
  };
  const pressEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    onPointerUp?.(event);
    setPressed(false);
  };
  const pressCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    onPointerCancel?.(event);
    setPressed(false);
  };
  const pressLeave = (event: ReactPointerEvent<HTMLButtonElement>) => {
    onPointerLeave?.(event);
    setPressed(false);
  };
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      onPointerDown={pressStart}
      onPointerUp={pressEnd}
      onPointerCancel={pressCancel}
      onPointerLeave={pressLeave}
      {...props}
    >
      <VdPressFeedback pressed={pressed}>{children}</VdPressFeedback>
    </button>
  );
});

export { buttonVariants };
