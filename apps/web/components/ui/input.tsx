"use client";

import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

import { cn } from "./cn";

/**
 * Designed text Input (task 018): token field surface, 36px row, 9px radius,
 * token focus ring and explicit disabled styling. Native semantics (form
 * submission, context menus, IME) are untouched.
 */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-9 w-full rounded-vdu border border-vdu-border bg-vdu-bg-raised px-3",
          "text-sm text-vdu-fg placeholder:text-vdu-fg-disabled",
          
          "hover:border-vdu-border-strong",
          "outline-none focus-visible:border-vdu-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--vdu-focus)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
