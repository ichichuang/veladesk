"use client";

/**
 * Dawn opening mount point (P1-ENG-1, spec: docs/redesign/motion-spec-p1.md
 * §2) — an EMPTY HOOK STUB by mandate. The hook exists so the scene layer
 * carries the integration seam, but it owns no animation, no timeline, no
 * state and no observer: the Dawn implementation is its own task and fills
 * this in behind the `experimental.helmMotion` switch. Reduced-motion and
 * interruptibility rules from the spec apply to that future
 * implementation, not to this stub.
 */
export function useDawnIntro(): void {
  // Intentionally empty — see the module doc.
}
