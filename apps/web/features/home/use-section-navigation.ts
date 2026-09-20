"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DesktopPageId } from "@veladesk/domain";

/**
 * Section navigation for the scroll-snap workspace (task 015).
 *
 * The REAL scroll position of the section stack is the single source of
 * truth: an IntersectionObserver watches every section and the observed
 * "most visible" section becomes `activePageId` — a React reflection of
 * the scroll position, never a command that drives it. Navigation
 * (`scrollToSection`) only ever scrolls the real container; the active
 * state then follows through the observer.
 *
 * Responsibilities kept deliberately narrow: stack ref, section element
 * registration, activePageId, observer wiring, initial default-page
 * positioning (instant — no entry animation) and page-order reconciliation.
 * No domain mutations, runtime access, dialogs or menus live here.
 */

/** A section counts as "the" viewport once this ratio is visible. */
const ACTIVE_THRESHOLD = 0.6;

export interface UseSectionNavigationArgs {
  /** Current page order (the `workspace.pages` projection). */
  readonly pageIds: readonly DesktopPageId[];
  /** Boot positioning target; null falls back to the first page. */
  readonly defaultPageId: DesktopPageId | null;
}

export interface SectionNavigationApi {
  /** Attach to the scroll container (`.vela-section-stack`). */
  readonly stackRef: (node: HTMLDivElement | null) => void;
  /** Per-page ref callback factory for the `<section>` elements. */
  readonly registerSection: (pageId: DesktopPageId) => (node: HTMLElement | null) => void;
  /** Scroll-position reflection; null before the first layout pass. */
  readonly activePageId: DesktopPageId | null;
  /** Scrolls the real container to a section (instant, no animation). */
  readonly scrollToSection: (pageId: DesktopPageId) => void;
}

export function useSectionNavigation(args: UseSectionNavigationArgs): SectionNavigationApi {
  const { pageIds, defaultPageId } = args;

  // Raw observation result; the EFFECTIVE active id is derived below so a
  // deleted active page resolves during render, never via effect setState.
  const [observedPageId, setObservedPageId] = useState<DesktopPageId | null>(null);
  const activeRef = useRef<DesktopPageId | null>(null);
  const stackNodeRef = useRef<HTMLDivElement | null>(null);
  const sectionsRef = useRef(new Map<DesktopPageId, HTMLElement>());
  const registrarsRef = useRef(new Map<DesktopPageId, (node: HTMLElement | null) => void>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const initializedRef = useRef(false);

  /**
   * The active section as data: the observer's pick while it still exists,
   * otherwise the default section, otherwise the first — derived, not
   * written, so structural changes reconcile within the same render.
   */
  const activePageId = useMemo(() => {
    if (observedPageId !== null && pageIds.includes(observedPageId)) {
      return observedPageId;
    }
    if (defaultPageId !== null && pageIds.includes(defaultPageId)) {
      return defaultPageId;
    }
    return pageIds[0] ?? null;
  }, [observedPageId, pageIds, defaultPageId]);

  // Mirror ref for imperative callbacks (observer compares against it).
  useEffect(() => {
    activeRef.current = activePageId;
  }, [activePageId]);

  const setActiveFromObserver = useCallback((next: DesktopPageId) => {
    if (activeRef.current !== next) {
      activeRef.current = next;
      setObservedPageId(next);
    }
  }, []);

  /**
   * Recomputes the most visible section from live rects and only updates
   * React state when the dominant section clearly changed — never per
   * scroll pixel. With `scroll-snap-stop: always` the container settles
   * exactly on one section, so ≥0.6 visibility picks it deterministically.
   */
  const pickMostVisible = useCallback(() => {
    const stack = stackNodeRef.current;
    if (stack === null) {
      return;
    }
    const stackRect = stack.getBoundingClientRect();
    if (stackRect.height <= 0) {
      return;
    }
    let bestId: DesktopPageId | null = null;
    let bestRatio = 0;
    for (const [id, node] of sectionsRef.current) {
      const rect = node.getBoundingClientRect();
      const visible =
        Math.min(rect.bottom, stackRect.bottom) - Math.max(rect.top, stackRect.top);
      const ratio = Math.max(0, visible) / stackRect.height;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestId = id;
      }
    }
    if (bestId !== null && bestRatio >= ACTIVE_THRESHOLD) {
      setActiveFromObserver(bestId);
    }
  }, [setActiveFromObserver]);

  const stackRef = useCallback(
    (node: HTMLDivElement | null) => {
      stackNodeRef.current = node;
      if (node !== null && observerRef.current === null) {
        const observer = new IntersectionObserver(() => pickMostVisible(), {
          root: node,
          threshold: [0, 0.2, 0.4, 0.6, 0.8, 1],
        });
        observerRef.current = observer;
        for (const section of sectionsRef.current.values()) {
          observer.observe(section);
        }
      }
    },
    [pickMostVisible]
  );

  const registerSection = useCallback((pageId: DesktopPageId) => {
    // Stable per page id: re-rendering must not detach/reattach refs (and
    // re-observe sections) on every render.
    let registrar = registrarsRef.current.get(pageId);
    if (registrar === undefined) {
      registrar = (node: HTMLElement | null) => {
        if (node !== null) {
          sectionsRef.current.set(pageId, node);
          observerRef.current?.observe(node);
        } else {
          const existing = sectionsRef.current.get(pageId);
          if (existing !== undefined) {
            observerRef.current?.unobserve(existing);
            sectionsRef.current.delete(pageId);
          }
        }
      };
      registrarsRef.current.set(pageId, registrar);
    }
    return registrar;
  }, []);

  // Drop registrars (and their nodes) of pages that no longer exist.
  useEffect(() => {
    const alive = new Set(pageIds);
    for (const pageId of [...registrarsRef.current.keys()]) {
      if (!alive.has(pageId)) {
        const node = sectionsRef.current.get(pageId);
        if (node !== undefined) {
          observerRef.current?.unobserve(node);
          sectionsRef.current.delete(pageId);
        }
        registrarsRef.current.delete(pageId);
      }
    }
  }, [pageIds]);

  /**
   * First visible paint: jump straight to the default section (or the
   * first). Instant, never smooth — the workspace must not glide from
   * page one to the default after boot. The observer's initial callbacks
   * then reflect this position as `activePageId` (state updates arrive
   * from the observer callback, an external system, not this effect).
   */
  useLayoutEffect(() => {
    if (initializedRef.current || pageIds.length === 0 || stackNodeRef.current === null) {
      return;
    }
    initializedRef.current = true;
    const targetId =
      defaultPageId !== null && sectionsRef.current.has(defaultPageId)
        ? defaultPageId
        : pageIds[0]!;
    const node = sectionsRef.current.get(targetId);
    if (node !== undefined) {
      stackNodeRef.current.scrollTo({ top: node.offsetTop, behavior: "instant" });
    }
    activeRef.current = targetId;
  }, [pageIds, defaultPageId]);

  useEffect(() => {
    const observer = observerRef;
    const sections = sectionsRef;
    const registrars = registrarsRef;
    return () => {
      observer.current?.disconnect();
      observer.current = null;
      sections.current.clear();
      registrars.current.clear();
      initializedRef.current = false;
      activeRef.current = null;
    };
  }, []);

  const scrollToSection = useCallback((pageId: DesktopPageId) => {
    const stack = stackNodeRef.current;
    const node = sectionsRef.current.get(pageId);
    if (stack === null || node === undefined) {
      return;
    }
    // Sections are exactly one viewport tall and stacked, so the section's
    // offsetTop (relative to the positioned stack) IS the snap offset.
    stack.scrollTo({ top: node.offsetTop, behavior: "instant" });
  }, []);

  return { stackRef, registerSection, activePageId, scrollToSection };
}
