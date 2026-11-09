"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

import type { GridItemGeometry } from "../../canvas/canvas-resize";
import { gridSpanExtentPx } from "../../canvas/square-grid-metrics";
import type { PagePlacement } from "@veladesk/domain";
import { VD_MOTION_EASES_BEZIER, VD_MOTION_FLIP } from "@components/vd/motion-tokens";
import { useVdReducedMotion } from "@components/vd/reduced-motion";

/**
 * The snap-drop ripple (P1, motion-spec-p1 §3): when a Grid drag commits,
 * one 220ms ring stroke plays at each landing cell — opacity 0.35→0,
 * scale 0.9→1.15 — and disappears. Motion owns it (the FLIP moment's
 * engine); reduced motion never plays it; freeform drops have no ripple
 * (there is no lattice to land on).
 */

/**
 * The ring's easing: the canonical standard curve as its Motion bezier twin
 * (`VD_MOTION_EASES_BEZIER.standard` ≙ GSAP `power2.out`; no literals).
 * Exported for tests.
 */
export const DROP_RIPPLE_EASE = VD_MOTION_EASES_BEZIER.standard;

/** One played ripple: the target geometry plus its session nonce. */
export interface DropRipple {
  readonly id: number;
  readonly box: GridItemGeometry;
}

/**
 * Derives the landing cells from the committed placement: every moved
 * item whose cell geometry CHANGED between the drag's start and its
 * committed result (group drags produce several rings at once).
 */
export function snapDropBoxes(
  moved: PagePlacement,
  placementAtStart: PagePlacement,
): readonly GridItemGeometry[] {
  if (moved.mode !== "grid" || placementAtStart.mode !== "grid") {
    return [];
  }
  const startById = new Map(
    placementAtStart.items.map((item) => [item.id, item] as const),
  );
  const boxes: GridItemGeometry[] = [];
  for (const item of moved.items) {
    const before = startById.get(item.id);
    if (
      before !== undefined &&
      before.column === item.column &&
      before.row === item.row &&
      before.columnSpan === item.columnSpan &&
      before.rowSpan === item.rowSpan
    ) {
      continue;
    }
    boxes.push({
      column: item.column,
      row: item.row,
      columnSpan: item.columnSpan,
      rowSpan: item.rowSpan,
    });
  }
  return boxes;
}

/**
 * The ripple session: `playSnapDrop` records the landing cells (deduped
 * by geometry), each ring retiring itself after the dropRipple token.
 */
export function useSnapDropRipples(): {
  readonly ripples: readonly DropRipple[];
  readonly playSnapDrop: (moved: PagePlacement, placementAtStart: PagePlacement) => void;
} {
  const reducedMotion = useVdReducedMotion();
  const [ripples, setRipples] = useState<readonly DropRipple[]>([]);
  const nonceRef = useRef(0);
  /** Live retire timers — swept wholesale on unmount. */
  const timersRef = useRef(new Set<number>());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const playSnapDrop = useCallback(
    (moved: PagePlacement, placementAtStart: PagePlacement) => {
      if (reducedMotion) {
        return;
      }
      const boxes = snapDropBoxes(moved, placementAtStart);
      if (boxes.length === 0) {
        return;
      }
      const played = boxes.map((box) => {
        nonceRef.current += 1;
        return { id: nonceRef.current, box };
      });
      setRipples((current) => [...current, ...played]);
      // Retire each ring once its stroke has fully faded (plus the
      // dropRippleTail slack so the exit paint always lands).
      for (const ripple of played) {
        const timer = window.setTimeout(() => {
          timersRef.current.delete(timer);
          setRipples((current) => current.filter((entry) => entry.id !== ripple.id));
        }, (VD_MOTION_FLIP.dropRipple + VD_MOTION_FLIP.dropRippleTail) * 1000);
        timersRef.current.add(timer);
      }
    },
    [reducedMotion],
  );

  return { ripples, playSnapDrop };
}

/**
 * The ripple layer: absolutely positioned rings inside the grid stage,
 * placed from the shared square-grid metrics exactly like the target
 * feedback (`column * pitch` origin, span extent including internal
 * gaps). Pointer-transparent, aria-hidden, Motion-owned
 * (data-motion-owner="motion").
 */
export function SnapDropRipples({
  ripples,
  cellPx,
  gapPx,
}: {
  readonly ripples: readonly DropRipple[];
  readonly cellPx: number;
  readonly gapPx: number;
}) {
  if (ripples.length === 0) {
    return null;
  }
  const pitch = cellPx + gapPx;
  return (
    <div className="vela-drop-ripple-layer" aria-hidden="true">
      {ripples.map((ripple) => (
        <motion.span
          key={ripple.id}
          className="vela-drop-ripple"
          data-motion-owner="motion"
          style={{
            left: `${ripple.box.column * pitch}px`,
            top: `${ripple.box.row * pitch}px`,
            width: `${gridSpanExtentPx(ripple.box.columnSpan, cellPx, gapPx)}px`,
            height: `${gridSpanExtentPx(ripple.box.rowSpan, cellPx, gapPx)}px`,
          }}
          initial={{ opacity: 0.35, scale: 0.9 }}
          animate={{ opacity: 0, scale: 1.15 }}
          transition={{ duration: VD_MOTION_FLIP.dropRipple, ease: DROP_RIPPLE_EASE }}
        />
      ))}
    </div>
  );
}
