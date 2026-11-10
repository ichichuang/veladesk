"use client";

import { useEffect, useRef } from "react";

import { useVdReducedMotion } from "@components/vd/reduced-motion";
import { VD_MOTION_WAKE } from "@components/vd/motion-tokens";

/*
 * The Wake light trail (Helm first picture; motion-spec §6 promoted from
 * the helmMotion experiment for the tile-drag moment): one full-viewport
 * canvas overlay that follows the pointer WHILE A TILE DRAG IS LIVE — the
 * apricot wake a dragged card leaves behind, fading over wake.fade.
 *
 * Frame budget: the trail keeps at most wake.maxPoints points, redraws only
 * while points are alive, and stops its rAF the moment the trail empties
 * (or the tab hides). Colors come from the themed roots' own custom
 * properties — no literals; if the tokens cannot be read the trail simply
 * does not paint. Reduced motion: nothing renders at all.
 */

interface WakePoint {
  readonly x: number;
  readonly y: number;
  readonly time: number;
}

/** Reads one color token off the nearest themed root (oklch is fine for canvas). */
function themedColor(variable: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const themed = document.querySelector("[data-vd-ui]");
  if (themed === null) {
    return null;
  }
  const value = getComputedStyle(themed).getPropertyValue(variable).trim();
  return value === "" ? null : value;
}

export function WakeTrail({
  active,
}: {
  /** True while a tile drag is live — the only moment the wake exists. */
  readonly active: boolean;
}) {
  const reducedMotion = useVdReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active || reducedMotion) {
      return;
    }
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const context = canvas.getContext("2d");
    if (context === null) {
      return;
    }
    const accent = themedColor("--vd-color-accent");
    if (accent === null) {
      return;
    }
    const fadeMs = VD_MOTION_WAKE.fade * 1000;
    const points: WakePoint[] = [];
    let frame = 0;
    let running = false;

    const resizeToViewport = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resizeToViewport();

    const draw = () => {
      const now = performance.now();
      while (points.length > 0 && now - points[0]!.time > fadeMs) {
        points.shift();
      }
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      if (points.length >= 2) {
        // Three passes: a wide soft glow, the bright core, and a glowing
        // head at the newest point — cheaper and steadier than shadowBlur.
        context.lineCap = "round";
        context.lineJoin = "round";
        for (const pass of [0, 1] as const) {
          for (let index = 1; index < points.length; index += 1) {
            const previous = points[index - 1]!;
            const point = points[index]!;
            const age = (now - point.time) / fadeMs;
            const life = 1 - age;
            const width = (pass === 0 ? 9 : 2.6) * (0.35 + 0.65 * life);
            context.strokeStyle = accent;
            context.globalAlpha = (pass === 0 ? 0.22 : 0.78) * life;
            context.lineWidth = width;
            context.beginPath();
            context.moveTo(previous.x, previous.y);
            context.lineTo(point.x, point.y);
            context.stroke();
          }
        }
        const head = points[points.length - 1]!;
        const headLife = 1 - (now - head.time) / fadeMs;
        context.globalAlpha = 0.85 * headLife;
        context.fillStyle = accent;
        context.beginPath();
        context.arc(head.x, head.y, 3.2, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 0.28 * headLife;
        context.beginPath();
        context.arc(head.x, head.y, 9, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;
      }
      if (points.length > 0) {
        frame = requestAnimationFrame(draw);
      } else {
        running = false;
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const now = performance.now();
      const last = points[points.length - 1];
      if (last !== undefined && now - last.time < 8) {
        // Coalesce sub-frame moves — the trail needs cadence, not density.
        points[points.length - 1] = { x: event.clientX, y: event.clientY, time: now };
      } else {
        points.push({ x: event.clientX, y: event.clientY, time: now });
        if (points.length > VD_MOTION_WAKE.maxPoints) {
          points.shift();
        }
      }
      if (!running) {
        running = true;
        frame = requestAnimationFrame(draw);
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        running = false;
        points.length = 0;
      }
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("resize", resizeToViewport);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", resizeToViewport);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, reducedMotion]);

  if (!active || reducedMotion) {
    return null;
  }
  return (
    <canvas className="vela-wake-trail" ref={canvasRef} aria-hidden="true" />
  );
}
