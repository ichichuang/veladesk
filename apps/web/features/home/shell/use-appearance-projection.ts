"use client";

import { useMemo } from "react";

import type { WorkspaceSnapshot } from "@veladesk/domain";

import {
  appearanceHandoffSettled,
  projectRenderedWorkspace,
} from "../app-appearance-session";
import type { AppAppearanceSession } from "../app-appearance-session";

/**
 * The appearance editing projection (task 019-C, extracted P1-ENG-1).
 * While the inspector is open, the desktop renders the persisted snapshot
 * + the session draft through ONE canonical projection — the real placed
 * app is the live preview, never a simulated tile. After a successful
 * Save the panel closes but the session may outlive it as an INERT
 * override: once the authoritative snapshot structurally carries the
 * projected app, projecting changes nothing (rendered === persisted), so
 * there is no bounce — the derivation simply stops using it.
 */
export function useAppearanceProjection({
  appearanceSession,
  inspectorOpen,
  snapshot,
}: {
  readonly appearanceSession: AppAppearanceSession | null;
  readonly inspectorOpen: boolean;
  readonly snapshot: WorkspaceSnapshot;
}) {
  const effectiveAppearanceSession = useMemo(() => {
    if (appearanceSession === null) {
      return null;
    }
    if (!inspectorOpen && appearanceHandoffSettled(snapshot, appearanceSession)) {
      return null; // Inert: the persisted app IS the projection.
    }
    return appearanceSession;
  }, [appearanceSession, inspectorOpen, snapshot]);
  const renderedSnapshot = useMemo(
    () => projectRenderedWorkspace(snapshot, effectiveAppearanceSession),
    [snapshot, effectiveAppearanceSession]
  );
  /** The app the inspector edits — drives the quiet desktop affordance. */
  const appearanceEditingId = inspectorOpen ? (appearanceSession?.appId ?? null) : null;

  return { renderedSnapshot, appearanceEditingId };
}
