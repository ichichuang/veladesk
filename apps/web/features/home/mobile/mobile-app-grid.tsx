"use client";

import { Folder } from "lucide-react";
import type {
  AppShortcut,
  EntityId,
  WorkspaceSnapshot,
} from "@veladesk/domain";

import { AppIconTile } from "../app-icon-renderer";
import { useI18n } from "../../i18n/use-i18n";
import type { MobileSectionItem } from "./mobile-section-items";
import "./mobile-shell.css";

/**
 * The mobile app grid (task 026 §23–§26): a regular CSS grid of
 * consumption tiles — icon + ALWAYS-visible name. Tap is the only gesture:
 * apps launch through the canonical helper, folders open the mobile sheet.
 * The desktop's labelVisible/iconScale preferences are deliberately NOT
 * consulted: a launcher UI identifies apps by name (§24).
 */
export function MobileAppGrid({
  items,
  workspace,
  onOpenApp,
  onOpenFolder,
}: {
  readonly items: readonly MobileSectionItem[];
  readonly workspace: WorkspaceSnapshot;
  readonly onOpenApp: (app: AppShortcut) => void;
  readonly onOpenFolder: (folderId: EntityId) => void;
}) {
  const { t } = useI18n();
  if (items.length === 0) {
    return <div className="vela-mobile-grid vela-mobile-grid--empty">{t("mobile.section.empty")}</div>;
  }
  return (
    <ul className="vela-mobile-grid" aria-label={t("mobile.section.label")}>
      {items.map((item) => {
        const entity = workspace.entities.find((candidate) => candidate.id === item.entityId);
        if (entity === undefined) {
          return null;
        }
        if (entity.kind === "app") {
          return (
            <li key={entity.id} className="vela-mobile-tile">
              <button type="button" className="vela-mobile-tile__button" onClick={() => onOpenApp(entity)}>
                <AppIconTile app={entity} />
                <span className="vela-mobile-tile__label">{entity.name}</span>
              </button>
            </li>
          );
        }
        if (entity.kind === "folder") {
          return (
            <li key={entity.id} className="vela-mobile-tile">
              <button
                type="button"
                className="vela-mobile-tile__button"
                aria-label={entity.name}
                onClick={() => onOpenFolder(entity.id)}
              >
                <span className="vela-mobile-tile__icon--folder" aria-hidden="true">
                  <Folder size={26} />
                </span>
                <span className="vela-mobile-tile__label">{entity.name}</span>
              </button>
            </li>
          );
        }
        // Widgets never reach the grid (filtered by the resolver); a stray
        // one renders nothing rather than a broken tile.
        return null;
      })}
    </ul>
  );
}
