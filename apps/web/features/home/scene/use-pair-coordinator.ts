"use client";

import { useCallback, useEffect, useRef } from "react";
// (useCallback keeps the coordinator getter referentially stable — the
// scene's switchSection/settle-effect dependency arrays stay quiet.)

import type { DesktopPageId } from "@veladesk/domain";

import { createSectionPairCoordinator } from "../section-pair-animator";
import type { SectionPairCoordinator } from "../section-pair-animator";

/**
 * The scene's GSAP page-pair coordinator handle (task 022, extracted
 * P1-ENG-1): ONE timeline owns the visible page pair for each category
 * transition. Created lazily (the scene only renders client-side);
 * disposed on unmount — the coordinator's GSAP objects die with the shell.
 * The scene feeds it machine commands from a layout effect and receives
 * exactly one generation-guarded settle per transition.
 */
export function usePairCoordinator() {
  const pairCoordinatorRef = useRef<SectionPairCoordinator | null>(null);
  const pairCoordinator = useCallback((): SectionPairCoordinator => {
    pairCoordinatorRef.current ??= createSectionPairCoordinator();
    return pairCoordinatorRef.current;
  }, []);
  /** Stable registration identity for the layers' ref callbacks. */
  const registerSectionLayer = useCallback(
    (pageId: DesktopPageId, node: HTMLElement | null) => {
      pairCoordinator().registerLayer(pageId, node);
    },
    [pairCoordinator],
  );
  // Unmount: the coordinator's GSAP objects die with the shell.
  useEffect(() => {
    return () => {
      pairCoordinatorRef.current?.dispose();
      pairCoordinatorRef.current = null;
    };
  }, []);
  return { pairCoordinator, registerSectionLayer };
}
