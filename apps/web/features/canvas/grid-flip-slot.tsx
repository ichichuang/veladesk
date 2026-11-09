"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { MotionStyle } from "motion/react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import type { GridCanvasItem } from "@veladesk/canvas-engine";

import { gridPlacementStyle } from "./square-grid-metrics";
import { VD_MOTION_FLIP } from "@components/vd/motion-tokens";
import { vdPrefersReducedMotion } from "@components/vd/reduced-motion";

/**
 * The snap-mode FLIP slot (P1, motion-spec-p1 §3): ONE Motion-owned layout
 * wrapper around every Grid tile. When the tile's committed geometry
 * changes between renders (a resize to the next size step, a keyboard
 * nudge, an undo/redo), Motion animates the slot from its previous visual
 * box with the flip.reorder spring — critically damped, no overshoot.
 *
 * Freeform NEVER animates: its tiles stay 1:1 with the pointer (no spring,
 * no overshoot, no layout animation) — that model renders the plain
 * button, no slot. The slot is also inert while its tile is being DRAGGED:
 * dnd-kit owns that element's transform, and the drop already lands where
 * the snapped preview showed, so a layout animation there could only jump
 * the tile back to its pre-drag cell. Reduced motion renders a plain div
 * (instant repositioning, the animator's downgrade).
 *
 * `data-motion-owner="motion"` marks the engine split (motion-spec §0):
 * GSAP never touches this node, Motion never touches anything else.
 */

/** The flip.reorder spring from the shared token — one source, no literals. */
export const GRID_FLIP_TRANSITION = {
  type: "spring",
  stiffness: VD_MOTION_FLIP.reorder.stiffness,
  damping: VD_MOTION_FLIP.reorder.damping,
  mass: VD_MOTION_FLIP.reorder.mass,
} as const;

/*
 * Reduced motion for MANY slots: one module-scoped media subscription
 * shared by every mounted slot, instead of one matchMedia listener per
 * tile. Falls back to the shared direct read until the first subscriber
 * attaches (and on servers).
 */
let sharedReducedMotion = vdPrefersReducedMotion();
const reducedMotionListeners = new Set<(reduced: boolean) => void>();
let reducedMotionQuery: MediaQueryList | null = null;

function attachReducedMotionQuery(): void {
  if (reducedMotionQuery !== null || typeof window.matchMedia !== "function") {
    return;
  }
  reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  reducedMotionQuery.addEventListener("change", (event) => {
    sharedReducedMotion = event.matches;
    for (const listener of reducedMotionListeners) {
      listener(sharedReducedMotion);
    }
  });
}

function useSharedReducedMotion(): boolean {
  const [reduced, setReduced] = useState(sharedReducedMotion);
  useEffect(() => {
    reducedMotionListeners.add(setReduced);
    attachReducedMotionQuery();
    return () => {
      reducedMotionListeners.delete(setReduced);
    };
  }, []);
  return reduced;
}

export function GridFlipSlot({
  item,
  flip,
  dragging,
  slotRef,
  children,
}: {
  /** The Grid item whose cell geometry the slot occupies. */
  readonly item: GridCanvasItem;
  /** False while reduced motion (or any future opt-out) forbids FLIP. */
  readonly flip: boolean;
  /** True while this tile's drag is live: the slot goes inert. */
  readonly dragging: boolean;
  /** The element the resize preview writes its live cell geometry to. */
  readonly slotRef: RefObject<HTMLDivElement | null>;
  readonly children: ReactNode;
}) {
  const reducedMotion = useSharedReducedMotion();
  // Both branches keep the SAME class/DOM shape so a flip toggle (a drag
  // starting mid-session) never remounts the tile. MotionStyle widens
  // CSSProperties; gridColumn/gridRow ride along as plain styles.
  const style = {
    ...gridPlacementStyle(item),
    ...(dragging ? { zIndex: 30 } : undefined),
  };
  if (!flip || reducedMotion) {
    return (
      <div
        className="vela-item-slot"
        ref={slotRef}
        style={style as CSSProperties}
        data-motion-owner="motion"
      >
        {children}
      </div>
    );
  }
  return (
    <motion.div
      className="vela-item-slot"
      ref={slotRef}
      style={style as MotionStyle}
      layout
      transition={GRID_FLIP_TRANSITION}
      data-motion-owner="motion"
    >
      {children}
    </motion.div>
  );
}
