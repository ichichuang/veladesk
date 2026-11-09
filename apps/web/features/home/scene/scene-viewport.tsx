"use client";

import type { RefObject } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";

import type { SectionNavMachine } from "../section-transition-machine";

interface SceneViewportProps {
  /** The navigation machine — `data-section-transitioning` follows it. */
  readonly sectionNavMachine: SectionNavMachine;
  /** The viewport element ref (shared: scroll capture + tile queries). */
  readonly viewportRef: RefObject<HTMLDivElement | null>;
  /** The desktop-area context-menu entry (empty-area right-click). */
  readonly onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  /** The mounted section layers, composed by the shell. */
  readonly children: ReactNode;
}

/**
 * The one section viewport (018, warm-layered 020-A2) — the scene-owned
 * static clip box every mounted section layer lives in. Extracted
 * verbatim from the former desktop-shell render: a plain relative/clip
 * container (never a scroll or animated node) whose
 * `data-section-transitioning` attribute suspends the glass blur policy
 * for the whole machine gesture. The layers themselves are the tile
 * host's; this component never imports it — the shell composes the two.
 */
export function SceneViewport({
  sectionNavMachine,
  viewportRef,
  onContextMenu,
  children,
}: SceneViewportProps) {
  return (
    <div
      className="vela-section-viewport"
      ref={viewportRef}
      data-section-transitioning={
        sectionNavMachine.kind !== "idle" ? "true" : undefined
      }
      onContextMenu={onContextMenu}
    >
      {children}
    </div>
  );
}
