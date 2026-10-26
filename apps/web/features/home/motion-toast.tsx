"use client";
import { Children, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { gsap } from "@components/vd/gsap";
import { VD_MOTION_EASE, vdMotionDuration } from "@components/vd/motion-tokens";
import { useVdReducedMotion } from "@components/vd/reduced-motion";
import { useI18n } from "../i18n/use-i18n";
import { clearMotion } from "./workspace-motion";

export function MotionToast({ children, onDismiss, error = false, lifetime = 7000, slot = "sample" }: {
  readonly children: ReactNode; readonly onDismiss: () => void; readonly error?: boolean; readonly lifetime?: number; readonly slot?: "sample" | "workspace";
}) {
  const { t } = useI18n();
  const [exiting, setExiting] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  const reduced = useVdReducedMotion();
  useLayoutEffect(() => { dismiss.current = onDismiss; });
  useEffect(() => { const timer = setTimeout(() => setExiting(true), lifetime); return () => clearTimeout(timer); }, [lifetime]);
  useLayoutEffect(() => {
    const element = root.current;
    if (element === null) return;
    if (reduced) { clearMotion(element); if (exiting) dismiss.current(); return; }
    const tween = exiting
      ? gsap.to(element, { opacity: 0, y: -4, duration: vdMotionDuration("hoverPress"), ease: VD_MOTION_EASE, onComplete: () => dismiss.current() })
      : gsap.fromTo(element, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: vdMotionDuration("popup"), ease: VD_MOTION_EASE, onComplete: () => clearMotion(element) });
    return () => { tween.kill(); clearMotion(element); };
  }, [exiting, reduced]);
  return <div ref={root} className="vela-onboarding-success" role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"} data-toast-slot={slot} data-exiting={exiting}>
    <span>{children}</span><button type="button" className="vela-button" aria-label={t("common.close")} onClick={() => setExiting(true)}>×</button>
  </div>;
}


/** Separate positioning slots let a toast exit while its neighbours retain their own entrance pose. */
export function MotionToastStack({ children }: { readonly children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  const reduced = useVdReducedMotion();
  useLayoutEffect(() => {
    const slots = Array.from(root.current?.children ?? []) as HTMLElement[];
    const tweens: gsap.core.Tween[] = [];
    const nextPositions = new Map<string, number>();
    // Batch reads before any animation writes.
    const measured = slots.map(element => ({ element, key: element.dataset.toastKey!, top: element.getBoundingClientRect().top }));
    for (const { element, key, top } of measured) {
      nextPositions.set(key, top);
      const previous = positions.current.get(key);
      if (!reduced && previous !== undefined && previous !== top) {
        tweens.push(gsap.fromTo(element, { y: previous - top }, { y: 0, duration: vdMotionDuration("popup"), ease: VD_MOTION_EASE, onComplete: () => clearMotion(element) }));
      }
    }
    positions.current = nextPositions;
    return () => {
      // Cache visual coordinates from the known layout origin + GSAP transform.
      // This preserves a half-completed move when another toast arrives, without a layout read.
      for (const { element, key, top } of measured) positions.current.set(key, top + Number(gsap.getProperty(element, "y")));
      tweens.forEach(tween => tween.kill()); slots.forEach(clearMotion);
    };
  }, [children, reduced]);
  return <div ref={root} className="vela-toast-stack">
    {Children.toArray(children).map((child, index) => {
      const key = String(isValidElement(child) ? child.key : index);
      return <div key={key} data-toast-key={key}>{child}</div>;
    })}
  </div>;
}
