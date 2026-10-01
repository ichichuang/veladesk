"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "../ui/cn";
import { useVdPortalContainer } from "../ui/overlay-scope";
import { VdPopupSurface } from "./animated-surface";

/**
 * VdTooltip (task 021-C) — the ONE canonical tooltip.
 *
 * Radix Tooltip underneath (hover AND keyboard-focus semantics, portal
 * positioning, no layout impact on the trigger), themed through the
 * `--vdu-*` token layer and portalled to the shared themed portal root, so
 * a tooltip never changes its trigger's geometry and obeys the established
 * overlay stacking.
 *
 * Timing contract (§26): open ~220ms INTENT delay, move-between smoothing
 * via the provider's 120ms skip delay. The entrance interpolation is
 * GSAP-owned (opacity + a 4px y settle on the tooltip token) — no spring,
 * no overshoot, no CSS keyframes.
 *
 * Mount {@link VdTooltipProvider} ONCE per overlay group (the dock mounts
 * it): the skip delay only smooths consecutive triggers that share a
 * provider. Content is plain text — supplemental identity; the trigger
 * keeps its own accessible label (the tooltip is not the accessible name).
 */

/** Canonical open delay (§26: 180–250ms band). */
export const VD_TOOLTIP_OPEN_DELAY_MS = 220;
/** Canonical skip delay: moving between triggers re-opens immediately. */
export const VD_TOOLTIP_SKIP_DELAY_MS = 120;

export const VdTooltipProvider = TooltipPrimitive.Provider;

export interface VdTooltipProps {
  /** Supplemental text. Never a substitute for the trigger's own label. */
  readonly content: string;
  /** The single trigger element (a button, typically). */
  readonly children: React.ReactNode;
  readonly side?: "top" | "right" | "bottom" | "left";
}

export function VdTooltip({ content, children, side = "top" }: VdTooltipProps) {
  const portalContainer = useVdPortalContainer();
  return (
    <TooltipPrimitive.Root delayDuration={VD_TOOLTIP_OPEN_DELAY_MS}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal container={portalContainer}>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          data-vd-tooltip=""
          className="z-50 outline-none"
        >
          {/* 022: the GSAP surface owns the entrance (opacity + 4px rise on
              the tooltip token); the CSS vd-tooltip-in keyframe is gone. */}
          <VdPopupSurface
            variant="tooltip"
            className={cn(
              "max-w-[280px] rounded-[6px] border border-vdu-border bg-vdu-bg-active px-2.5 py-1.5",
              "text-xs leading-relaxed text-vdu-fg shadow-[var(--vdu-shadow-pop)]",
            )}
          >
            {content}
          </VdPopupSurface>
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
