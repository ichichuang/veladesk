"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { gsap } from "@components/vd/gsap";
import { VD_MOTION_EASE, vdMotionDuration } from "@components/vd/motion-tokens";
import { useVdReducedMotion } from "@components/vd/reduced-motion";

const SETTLED = "vd-workspace-settled";
/** Waits for the visible switch, without holding input or a runtime lock. */
export function waitForWorkspaceTransition(id: string): Promise<void> {
  const stage = document.querySelector<HTMLElement>("[data-workspace-stage]");
  if (stage === null || stage.dataset.settled === id) return Promise.resolve();
  return new Promise(resolve => {
    const done = (event: Event) => {
      if ((event as CustomEvent).detail === stage || stage.dataset.settled === id || !stage.isConnected) {
        window.removeEventListener(SETTLED, done); resolve();
      }
    };
    window.addEventListener(SETTLED, done);
  });
}

const SAMPLE_READY = "vd-workspace-sample-ready";
/** The local write succeeded: finish the departing button before the card hands off. */
export function markSampleDepartureReady(message: string) {
  window.dispatchEvent(new CustomEvent(SAMPLE_READY, { detail: message }));
}

const CAPTURE = "vd-workspace-capture";
/** Capture before the runtime publishes a new workspace, without retaining old runtimes. */
export function captureWorkspaceDeparture() {
  window.dispatchEvent(new Event(CAPTURE));
}

export function clearMotion(element: HTMLElement) {
  gsap.set(element, { clearProps: "transform,opacity,willChange" });
}

/** One timeline, latest destination wins. The outgoing DOM is inert paint only. */
export function animateWorkspace(incoming: HTMLElement, outgoing: HTMLElement | null, reduced: boolean, complete: () => void) {
  let cancelled = false;
  const onboarding = outgoing?.querySelector<HTMLElement>(".vela-onboarding__panel");
  const targets = outgoing === null ? [incoming] : [incoming, outgoing, ...(onboarding ? [onboarding] : [])];
  if (reduced) {
    targets.forEach(clearMotion);
    complete();
    return () => {};
  }
  targets.forEach(element => { element.style.willChange = "transform,opacity"; });
  const timeline = gsap.timeline({ onComplete: () => { if (cancelled) return; targets.forEach(clearMotion); complete(); } });
  if (onboarding) timeline.to(onboarding, { opacity: 0, y: -6, duration: vdMotionDuration("hoverPress"), ease: VD_MOTION_EASE }, 0);
  timeline.fromTo(incoming, { opacity: 0, scale: 1.01 }, { opacity: 1, scale: 1, duration: vdMotionDuration("inspector"), ease: VD_MOTION_EASE }, onboarding ? vdMotionDuration("hoverPress") : 0);
  if (outgoing !== null) timeline.to(outgoing, { opacity: 0, scale: .985, duration: vdMotionDuration("inspector"), ease: VD_MOTION_EASE }, 0);
  return () => { cancelled = true; timeline.kill(); targets.forEach(clearMotion); };
}

/** First-visit entrance uses inner wrappers: item positioning/drag transforms stay untouched. */
export function animateWorkspaceEntrance(root: HTMLElement, reduced: boolean) {
  if (reduced) return () => {};
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(".vela-item__body, .vela-mobile-tile__button, .vela-rail__item, .vela-mobile-tabs__tab"));
  const visible = candidates.map(element => ({ element, rect: element.getBoundingClientRect() })).filter(({ element, rect }) =>
    rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth &&
    !element.closest('[inert], [aria-hidden="true"], [data-phase="warm"]') && getComputedStyle(element).visibility !== "hidden",
  ).sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left).map(({ element }) => element);
  if (visible.length === 0) return () => {};
  const tween = gsap.fromTo(visible, { opacity: 0, y: 8 }, {
    opacity: 1, y: 0, duration: vdMotionDuration("dialog"), ease: VD_MOTION_EASE,
    stagger: { amount: vdMotionDuration("hoverPress") },
    onComplete: () => visible.forEach(clearMotion),
  });
  return () => { tween.kill(); visible.forEach(clearMotion); };
}

export function preserveDepartureWallpaper(incoming: HTMLElement, outgoing: HTMLElement | null, reduced: boolean) {
  const host = incoming.querySelector<HTMLElement>(".vela-desktop__wallpaper, .vela-mobile-shell__wallpaper");
  const source = outgoing?.querySelector<HTMLElement>(".vela-desktop__wallpaper, .vela-mobile-shell__wallpaper");
  if (reduced || host === null || !source || !host.querySelector(".vela-wallpaper-surface__pending")) return () => {};
  const cover = source.cloneNode(true) as HTMLElement;
  cover.className = "vela-workspace-wallpaper-cover";
  const sourceTheme = source.closest<HTMLElement>("[data-vd-color-mode]");
  if (sourceTheme) {
    cover.dataset.vdColorMode = sourceTheme.dataset.vdColorMode;
    for (const property of Array.from(sourceTheme.style)) {
      if (property.startsWith("--vd-") || property.startsWith("--vdu-")) cover.style.setProperty(property, sourceTheme.style.getPropertyValue(property));
    }
  }
  cover.inert = true; cover.setAttribute("aria-hidden", "true");
  host.append(cover);
  let tween: gsap.core.Tween | null = null;
  const observer = new MutationObserver(() => {
    if (host.querySelector(":scope > .vela-desktop__wallpaper-incoming .vela-wallpaper-surface__pending")) return;
    observer.disconnect();
    tween = gsap.to(cover, { opacity: 0, duration: vdMotionDuration("popup"), ease: VD_MOTION_EASE, onComplete: () => cover.remove() });
  });
  observer.observe(host, { subtree: true, childList: true });
  return () => { observer.disconnect(); tween?.kill(); cover.remove(); };
}

export function WorkspaceTransition({ identity, ready, awaitingPaint = false, children }: { readonly identity: string; readonly ready: boolean; readonly awaitingPaint?: boolean; readonly children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const ghostHost = useRef<HTMLDivElement>(null);
  const snapshot = useRef<HTMLElement | null>(null);
  const visited = useRef(new Set<string>());
  const cleanup = useRef<() => void>(() => {});
  const sampleLabel = useRef<HTMLElement | null>(null);
  const sampleLabelTween = useRef<gsap.core.Tween | null>(null);
  const reducedRef = useRef(false);
  const captureRef = useRef<() => void>(() => {});
  const lastIdentity = useRef(identity);
  const reduced = useVdReducedMotion();
  function stopSampleLabel() {
    sampleLabelTween.current?.kill(); sampleLabelTween.current = null;
    if (sampleLabel.current) clearMotion(sampleLabel.current);
    sampleLabel.current = null;
  }
  useLayoutEffect(() => { reducedRef.current = reduced; if (reduced) stopSampleLabel(); });
  useLayoutEffect(() => {
    function capture() {
      if (root.current === null) return;
      const source = root.current.parentElement?.dataset.awaitingPaint === "true"
        ? ghostHost.current?.firstElementChild ?? root.current
        : root.current;
      snapshot.current = source.cloneNode(true) as HTMLElement;
      // Visual copies never contribute duplicate ids, live regions or focus targets.
      snapshot.current.querySelectorAll('[data-vd-portal-root], [role="menu"], [role="dialog"], [role="alertdialog"], .vela-onboarding-success').forEach(node => node.remove());
      snapshot.current.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"));
      snapshot.current.querySelectorAll("[aria-live], [role='status'], [role='alert']").forEach(node => { node.removeAttribute("aria-live"); node.removeAttribute("role"); });
      snapshot.current.inert = true;
      snapshot.current.setAttribute("aria-hidden", "true");
    }
    function sampleReady(event: Event) {
      const label = ghostHost.current?.querySelector<HTMLElement>("[data-onboarding-label]") ?? snapshot.current?.querySelector<HTMLElement>("[data-onboarding-label]");
      if (!label) return;
      sampleLabel.current = label;
      label.textContent = (event as CustomEvent<string>).detail;
      label.parentElement?.setAttribute("data-state", "success");
      label.parentElement?.querySelector(".vela-onboarding__spinner")?.remove();
      sampleLabelTween.current?.kill();
      if (reducedRef.current) clearMotion(label);
      else sampleLabelTween.current = gsap.fromTo(label, { opacity: .65 }, { opacity: 1, duration: vdMotionDuration("hoverPress"), ease: VD_MOTION_EASE, onComplete: () => clearMotion(label) });
    }
    captureRef.current = capture;
    window.addEventListener(CAPTURE, capture);
    window.addEventListener(SAMPLE_READY, sampleReady);
    return () => { window.removeEventListener(CAPTURE, capture); window.removeEventListener(SAMPLE_READY, sampleReady); stopSampleLabel(); cleanup.current(); snapshot.current = null; window.dispatchEvent(new CustomEvent(SETTLED, { detail: root.current?.parentElement })); };
  }, []);
  useLayoutEffect(() => {
    const element = root.current;
    const host = ghostHost.current;
    if (element === null || host === null) return;
    if (lastIdentity.current !== identity) {
      cleanup.current();
      host.replaceChildren();
      if (!reduced && snapshot.current !== null) host.append(snapshot.current);
      snapshot.current = null;
      lastIdentity.current = identity;
    }
    if (reduced) host.replaceChildren();
    if (!ready) {
      // Non-workspace screens (boot → picker/onboarding/recovery) never become
      // "ready", so cross-fade the departing paint now instead of leaving the
      // ghost stacked over them. A workspace still awaiting its first paint
      // keeps the ghost until it is ready.
      if (awaitingPaint) return;
      cleanup.current();
      const departing = host.firstElementChild as HTMLElement | null;
      if (departing === null) return;
      const stopScreen = animateWorkspace(element, departing, reduced, () => { host.replaceChildren(); });
      cleanup.current = () => { stopScreen(); };
      return () => cleanup.current();
    }
    cleanup.current();
    const ghost = host.firstElementChild as HTMLElement | null;
    const stopWallpaper = preserveDepartureWallpaper(element, ghost, reduced);
    const stopEntrance = visited.current.has(identity) ? () => {} : animateWorkspaceEntrance(element, reduced);
    const stop = animateWorkspace(element, ghost, reduced, () => {
      host.replaceChildren();
      element.parentElement!.dataset.settled = identity;
      window.dispatchEvent(new Event(SETTLED));
    });
    visited.current.add(identity);
    cleanup.current = () => { stop(); stopEntrance(); stopWallpaper(); stopSampleLabel(); };
    return () => cleanup.current();
  }, [identity, ready, reduced, awaitingPaint]);
  useLayoutEffect(() => { captureRef.current(); });
  return <div className="vela-workspace-stage" data-workspace-stage="" data-awaiting-paint={awaitingPaint || undefined}>
    <div ref={root} className="vela-workspace-transition">{children}</div>
    <div ref={ghostHost} className="vela-workspace-ghost" aria-hidden="true" inert />
  </div>;
}
