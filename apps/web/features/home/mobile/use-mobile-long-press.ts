"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useVdReducedMotion } from "@components/vd/reduced-motion";

/**
 * The mobile tile long-press (UX-12): hold 450ms with ≤8px travel to open
 * the tile action menu; anything that turns into a scroll, a section swipe
 * or a lift before the threshold cancels it — the shell's existing
 * gestures keep exactly their behavior.
 *
 * Scope, deliberately narrow:
 *  - TOUCH ONLY (`pointerType === "touch"`); a mouse press never triggers.
 *  - The slop matches the section swipe's lock threshold, so a hold that
 *    starts to pan hands the gesture back BEFORE any menu appears.
 *  - After the menu opens (finger still down), slop travel closes the menu
 *    again — the finger became a scroll/swipe, not a menu pick.
 *  - The tap path is untouched: a quick press-release still clicks the
 *    tile. Only the ONE synthesized click right after a completed hold is
 *    swallowed (the same disarm pattern the swipe hook uses).
 *
 * Motion: while the hold is armed the tile carries `data-hold` (CSS scales
 * it 0.97 on the canonical fast/ease tokens); the attribute clears when
 * the menu opens — the tile restores its size as the sheet rises. Under
 * reduced motion the attribute never lands (no scale, instant sheet).
 */

/** Hold duration before the tile menu opens (UX-12 spec: 450ms). */
export const MOBILE_LONG_PRESS_MS = 450;
/** Pointer travel that cancels a hold (matches the swipe lock threshold). */
export const MOBILE_LONG_PRESS_SLOP_PX = 8;
/** How long the post-hold click suppression stays armed. */
const SUPPRESS_CLICK_MS = 400;

interface HoldState<T> {
  readonly pointerId: number;
  readonly target: T;
  readonly x: number;
  readonly y: number;
  timer: number | null;
  triggered: boolean;
}

export interface UseMobileLongPressOptions<T> {
  /** The hold completed without slop travel — open the menu. */
  readonly onTrigger: (target: T) => void;
  /**
   * The pointer travelled beyond the slop AFTER the menu opened — close it
   * again (the gesture became a scroll/swipe).
   */
  readonly onCancelAfterTrigger?: ((target: T) => void) | undefined;
}

export interface MobileLongPressHandlers<T> {
  /** The key currently mid-hold (drives the `data-hold` scale), or null. */
  readonly holdingKey: string | null;
  readonly keyOf: (target: T) => string;
  onPointerDown: (event: React.PointerEvent<HTMLElement>, target: T) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  /** Spread on the SAME element — swallows the click after a completed hold. */
  onClickCapture: (event: React.MouseEvent<HTMLElement>) => void;
}

export function useMobileLongPress<T>(
  options: UseMobileLongPressOptions<T>,
  keyOf: (target: T) => string,
): MobileLongPressHandlers<T> {
  const { onTrigger, onCancelAfterTrigger } = options;
  const reducedMotion = useVdReducedMotion();

  /** Latest callbacks for the element-attached handlers (never re-bound). */
  const latest = useRef({ onTrigger, onCancelAfterTrigger, reducedMotion });
  useEffect(() => {
    latest.current = { onTrigger, onCancelAfterTrigger, reducedMotion };
  });

  const hold = useRef<HoldState<T> | null>(null);
  const [holdingKey, setHoldingKey] = useState<string | null>(null);
  const suppressClickUntil = useRef(0);

  useEffect(
    () => () => {
      const state = hold.current;
      if (state !== null && state.timer !== null) {
        window.clearTimeout(state.timer);
      }
    },
    [],
  );

  const cancelTimer = useCallback((state: HoldState<T>) => {
    if (state.timer !== null) {
      window.clearTimeout(state.timer);
      state.timer = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>, target: T) => {
      if (event.pointerType !== "touch" || hold.current !== null) {
        return; // mouse/pen stay native; a second finger never retargets
      }
      const state: HoldState<T> = {
        pointerId: event.pointerId,
        target,
        x: event.clientX,
        y: event.clientY,
        timer: null,
        triggered: false,
      };
      state.timer = window.setTimeout(() => {
        state.timer = null;
        state.triggered = true;
        suppressClickUntil.current = Date.now() + SUPPRESS_CLICK_MS;
        setHoldingKey(null); // the tile restores size as the menu opens
        latest.current.onTrigger(target);
      }, MOBILE_LONG_PRESS_MS);
      hold.current = state;
      if (!latest.current.reducedMotion) {
        setHoldingKey(keyOf(target));
      }
    },
    [keyOf],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const state = hold.current;
      if (state === null || event.pointerId !== state.pointerId) {
        return;
      }
      const travel = Math.hypot(event.clientX - state.x, event.clientY - state.y);
      if (travel <= MOBILE_LONG_PRESS_SLOP_PX) {
        return;
      }
      if (state.triggered) {
        // The finger moved after the menu opened: it is a scroll/swipe —
        // close the menu and let the gesture own the screen.
        cancelTimer(state);
        hold.current = null;
        setHoldingKey(null);
        latest.current.onCancelAfterTrigger?.(state.target);
        return;
      }
      // Still arming: the pan wins, the hold quietly stands down.
      cancelTimer(state);
      hold.current = null;
      setHoldingKey(null);
    },
    [cancelTimer],
  );

  const release = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const state = hold.current;
      if (state === null || event.pointerId !== state.pointerId) {
        return;
      }
      cancelTimer(state);
      hold.current = null;
      setHoldingKey(null);
    },
    [cancelTimer],
  );

  const onClickCapture = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (Date.now() > suppressClickUntil.current) {
      return;
    }
    // The hold already opened the menu — this synthesized click must not
    // also launch the app.
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    holdingKey,
    keyOf,
    onPointerDown,
    onPointerMove,
    onPointerUp: release,
    onPointerCancel: release,
    onClickCapture,
  };
}
