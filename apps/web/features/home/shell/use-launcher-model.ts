"use client";

import { useMemo } from "react";

import type {
  AppShortcut,
  DesktopPageId,
  EntityId,
  WorkspaceSnapshot,
} from "@veladesk/domain";
import type { LocalWorkspaceSyncState } from "@veladesk/local-store";

import { resolveDockEntities } from "../dock-model";
import { buildLauncherEntries } from "../launcher-index";
import type { UiLocale } from "../../i18n/locale";
import type { DesktopMode } from "./shell-context";

/**
 * The shell's launcher + dock model (P1-ENG-1), extracted verbatim from
 * the former desktop-shell.tsx: the launcher index (follows the live
 * snapshot), the shared-renderer app map and the dock-presence flag.
 */
export function useLauncherModel({
  snapshot,
  effectiveActivePageId,
  mode,
  syncState,
  locale,
  engineering,
  workspaceCandidates,
}: {
  readonly snapshot: WorkspaceSnapshot;
  readonly effectiveActivePageId: DesktopPageId | null;
  readonly mode: DesktopMode;
  readonly syncState: LocalWorkspaceSyncState;
  readonly locale: UiLocale;
  /** t181: false keeps management commands out of the launcher (Use mode). */
  readonly engineering: boolean;
  readonly workspaceCandidates: readonly { readonly id: string; readonly name: string }[] | null;
}) {
  // The launcher index follows the live snapshot: a sync or edit landing
  // while the launcher is open recomputes the entries on the next render.
  const launcherEntries = useMemo(
    () =>
      buildLauncherEntries({
        workspace: snapshot,
        activePageId: effectiveActivePageId,
        mode,
        syncState,
        locale,
        engineering,
        ...(workspaceCandidates === null ? {} : { workspaceCandidates }),
      }),
    [snapshot, effectiveActivePageId, mode, syncState, locale, engineering, workspaceCandidates],
  );

  // The launcher renders app icons through the SHARED renderer, so it needs
  // the live entities — same lifecycle as the entries above.
  const launcherAppsById = useMemo(() => {
    const apps = new Map<EntityId, AppShortcut>();
    for (const entity of snapshot.entities) {
      if (entity.kind === "app") {
        apps.set(entity.id, entity);
      }
    }
    return apps;
  }, [snapshot.entities]);

  const hasDock = useMemo(() => resolveDockEntities(snapshot).length > 0, [snapshot]);

  return { launcherEntries, launcherAppsById, hasDock };
}
