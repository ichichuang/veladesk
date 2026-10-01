"use client";

import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { Check } from "lucide-react";

import { cn } from "./cn";
import { gsap } from "@components/vd/gsap";
import { VD_MOTION_EASE, vdMotionDuration } from "@components/vd/motion-tokens";
import { useVdReducedMotion } from "@components/vd/reduced-motion";

/**
 * The check glyph pops in once per mount (Radix mounts the Indicator only
 * while checked/indeterminate): one owned GSAP scale+fade tween on the
 * hoverPress token; the CSS color transition is removed — state colors are
 * instant static changes. Reduced motion renders the glyph statically.
 */
function CheckGlyph({ children }: { readonly children: ReactNode }) {
  const reducedMotion = useVdReducedMotion();
  const ref = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    if (reducedMotion) {
      gsap.set(element, { scale: 1, opacity: 1 });
      return;
    }
    const tween = gsap.fromTo(
      element,
      { scale: 0.6, opacity: 0 },
      { scale: 1, opacity: 1, duration: vdMotionDuration("hoverPress"), ease: VD_MOTION_EASE },
    );
    return () => {
      tween.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only entrance
  }, []);

  return (
    <span ref={ref} className="flex items-center justify-center">
      {children}
    </span>
  );
}

/** Designed Checkbox: token check indicator, keyboard toggling via Radix. */
export function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer size-[18px] shrink-0 rounded-[5px] border border-vdu-border-strong",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vdu-focus)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:border-transparent data-[state=checked]:bg-vdu-accent",
        "data-[state=indeterminate]:border-transparent data-[state=indeterminate]:bg-vdu-accent",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-vdu-accent-fg">
        {props.checked === "indeterminate" ? (
          <CheckGlyph>
            <span className="block h-[2px] w-[10px] rounded-full bg-vdu-accent-fg" />
          </CheckGlyph>
        ) : (
          <CheckGlyph>
            <Check size={13} strokeWidth={3} />
          </CheckGlyph>
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
