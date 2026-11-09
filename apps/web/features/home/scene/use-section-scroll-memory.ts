"use client";

import { useCallback, useRef } from "react";

import type { DesktopPageId } from "@veladesk/domain";

import { SectionScrollMemory } from "../section-scroll-memory";
import type { SectionScrollMemory as SectionScrollMemoryInstance } from "../section-scroll-memory";
import type { WorkspaceViewStateV1 } from "../workspace-view-state";

/**
 * The scene's per-section scroll memory (P1-ENG-1), extracted verbatim
 * from the former desktop-shell.tsx: session state only, SEEDED at boot
 * from the persisted workspace view state (023-A). The remembered sections
 * restore through the EXISTING SectionView mount-restore mechanics — no
 * second scroll system, no animated scrolling, and no scroll-event
 * persistence (entries are captured on logical boundaries only).
 */
export function useSectionScrollMemory(
  bootPersisted: () => { readonly persisted: WorkspaceViewStateV1 | null }
): () => SectionScrollMemoryInstance {
  const scrollMemoryRef = useRef<SectionScrollMemoryInstance | null>(null);
  return useCallback((): SectionScrollMemoryInstance => {
    if (scrollMemoryRef.current === null) {
      const memory = new SectionScrollMemory();
      const persisted = bootPersisted().persisted;
      if (persisted !== null) {
        for (const [sectionId, scrollTop] of Object.entries(
          persisted.scrollTopBySectionId,
        )) {
          memory.save(sectionId as DesktopPageId, scrollTop);
        }
      }
      scrollMemoryRef.current = memory;
    }
    return scrollMemoryRef.current;
  }, [bootPersisted]);
}
