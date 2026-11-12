"use client";

import { Folder, Plus } from "lucide-react";
import type {
  AppShortcut,
  EntityId,
  WorkspaceSnapshot,
} from "@veladesk/domain";

import { AppIconTile } from "../app-icon-renderer";
import { useI18n } from "../../i18n/use-i18n";
import { useMobileLongPress } from "./use-mobile-long-press";
import type { MobileSectionItem } from "./mobile-section-items";
import "./mobile-shell.css";

/**
 * The mobile app grid (task 026 §23–§26): a regular CSS grid of
 * consumption tiles — icon + ALWAYS-visible name. Apps launch through the
 * canonical helper, folders open the mobile sheet. The desktop's
 * labelVisible/iconScale preferences are deliberately NOT consulted: a
 * launcher UI identifies apps by name (§24).
 *
 * UX-12 adds the minimal EDIT path: a 450ms hold on an APP tile opens the
 * tile action menu (编辑 / 移到分区 / 删除) without disturbing taps,
 * swipes or the native vertical scroll. An empty section shows the quiet
 * hint plus an 添加应用 button (active pane only) — the drawer's entry
 * is two gestures away otherwise.
 */
export function MobileAppGrid({
  items,
  workspace,
  onOpenApp,
  onOpenFolder,
  onOpenAppMenu,
  onDismissAppMenu,
  onAddApp,
}: {
  readonly items: readonly MobileSectionItem[];
  readonly workspace: WorkspaceSnapshot;
  readonly onOpenApp: (app: AppShortcut) => void;
  readonly onOpenFolder: (folderId: EntityId) => void;
  /** Long-press entry (UX-12): opens the tile action menu. */
  readonly onOpenAppMenu: (app: AppShortcut) => void;
  /** The hold became a scroll/swipe after the menu opened — close it. */
  readonly onDismissAppMenu: () => void;
  /** The empty section's 添加应用 button; absent on inert neighbour panes. */
  readonly onAddApp?: (() => void) | undefined;
}) {
  const { t } = useI18n();
  const longPress = useMobileLongPress<AppShortcut>(
    {
      onTrigger: (app) => onOpenAppMenu(app),
      onCancelAfterTrigger: () => onDismissAppMenu(),
    },
    (app) => app.id,
  );
  if (items.length === 0) {
    return (
      <div className="vela-mobile-grid vela-mobile-grid--empty">
        <p className="vela-mobile-grid__empty-text">{t("mobile.section.empty")}</p>
        {onAddApp !== undefined ? (
          <button type="button" className="vela-mobile-grid__empty-add" onClick={onAddApp}>
            <Plus size={18} aria-hidden="true" />
            <span>{t("dialog.addApp.title")}</span>
          </button>
        ) : null}
      </div>
    );
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
              <button
                type="button"
                className="vela-mobile-tile__button"
                data-hold={longPress.holdingKey === entity.id ? "true" : undefined}
                onClick={() => onOpenApp(entity)}
                onClickCapture={longPress.onClickCapture}
                onPointerDown={(event) => longPress.onPointerDown(event, entity)}
                onPointerMove={longPress.onPointerMove}
                onPointerUp={longPress.onPointerUp}
                onPointerCancel={longPress.onPointerCancel}
              >
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
