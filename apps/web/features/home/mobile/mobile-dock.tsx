"use client";

import { useMemo } from "react";
import { Folder } from "lucide-react";
import type {
  AppShortcut,
  EntityId,
  WorkspaceSnapshot,
} from "@veladesk/domain";

import { resolveDockEntities } from "../dock-model";
import { AppIconTile } from "../app-icon-renderer";
import { useI18n } from "../../i18n/use-i18n";
import "./mobile-shell.css";

/**
 * The mobile dock (task 026 §38–§42): the SAME `workspace.dock.items` the
 * desktop pins — membership is shared, only the presentation differs. A
 * pinned bottom bar; every item is an icon-only button with an aria-label
 * (no hover, so no tooltips); overflow scrolls horizontally without ever
 * truncating the data; an empty dock renders NO bar at all; the bottom
 * safe area keeps icons clear of the home-indicator gesture zone.
 */
export function MobileDock({
  workspace,
  onOpenApp,
  onOpenFolder,
}: {
  readonly workspace: WorkspaceSnapshot;
  readonly onOpenApp: (app: AppShortcut) => void;
  readonly onOpenFolder: (folderId: EntityId) => void;
}) {
  const { t } = useI18n();
  const entities = useMemo(() => resolveDockEntities(workspace), [workspace]);
  if (entities.length === 0) {
    return null;
  }
  return (
    <nav className="vela-mobile-dock" aria-label={t("mobile.dock.label")}>
      <div className="vela-mobile-dock__track">
        {entities.map((entity) =>
          entity.kind === "app" ? (
            <button
              key={entity.id}
              type="button"
              className="vela-mobile-dock__item"
              aria-label={entity.name}
              onClick={() => onOpenApp(entity)}
            >
              <AppIconTile app={entity} />
            </button>
          ) : (
            <button
              key={entity.id}
              type="button"
              className="vela-mobile-dock__item"
              aria-label={entity.name}
              onClick={() => onOpenFolder(entity.id)}
            >
              <span className="vela-mobile-tile__icon--folder" aria-hidden="true">
                <Folder size={24} />
              </span>
            </button>
          ),
        )}
      </div>
    </nav>
  );
}
