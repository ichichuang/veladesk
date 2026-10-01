"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Controlled animated presence (task 022): separates the REQUESTED open
 * state from MOUNTED presence so an exit animation can play while the
 * semantic primitive (a Radix Dialog, say) has already reported closed.
 *
 * Contract:
 *  - `mounted` starts as `open` and turns false ONLY through
 *    `completeExit()` — never on its own while `open` is false. The
 *    surface component owns the exit tween and calls `completeExit()` from
 *    the tween's completion (an animation callback, never render).
 *  - Reopening during an exit never unmounts: a `completeExit()` after a
 *    reopen is ignored (the surface re-targets its enter tween instead),
 *    so drafts, focus and modal locks survive an open/close/open round
 *    trip without a remount.
 *  - Exactly one release per exit: repeated completions are dropped.
 *
 * The rising open edge mounts through the sanctioned render-phase state
 * adjustment (React docs, "adjusting state when a prop changes") — no
 * setState inside an effect, no cascading render.
 */
export interface VdPresence {
  /** Render the subtree while true; the exit tween reports release. */
  readonly mounted: boolean;
  /** Called by the exit animation when it completes. */
  readonly completeExit: () => void;
}

export function useVdPresence(open: boolean): VdPresence {
  // exitDone: "no subtree should be mounted". Initially true only when the
  // surface never opened; the rising open edge clears it during render.
  const [exitDone, setExitDone] = useState(!open);
  const [previousOpen, setPreviousOpen] = useState(open);
  if (previousOpen !== open) {
    setPreviousOpen(open);
    if (open) {
      setExitDone(false);
    }
  }

  /** Latest-value mirrors for the completion callback (never read in render). */
  const openRef = useRef(open);
  const exitDoneRef = useRef(exitDone);
  useEffect(() => {
    openRef.current = open;
    exitDoneRef.current = exitDone;
  });

  const completeExit = useCallback(() => {
    if (openRef.current || exitDoneRef.current) {
      return; // reopened before completion, or already released
    }
    exitDoneRef.current = true;
    setExitDone(true);
  }, []);

  return { mounted: !exitDone, completeExit };
}
