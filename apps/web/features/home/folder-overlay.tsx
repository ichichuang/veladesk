"use client";

import { useEffect } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { AppShortcut, EntityId, Folder, WorkspaceSnapshot } from "@veladesk/domain";

import { useI18n } from "../i18n/use-i18n";
import { AppIconTile } from "./app-icon-renderer";
import {
  contextMenuAnchorFromElement,
  isContextMenuKeyEvent,
} from "./context-menu";
import "./home-shell.css";

interface FolderOverlayProps {
  readonly folder: Folder;
  readonly workspace: WorkspaceSnapshot;
  /** Presentation-only action error (e.g. no-space on dissolve). */
  readonly error?: string | undefined;
  readonly onClose: () => void;
  readonly onLaunchApp: (app: AppShortcut) => void;
  readonly onChildContextMenu: (entityId: EntityId, x: number, y: number) => void;
}

/**
 * Spatial glass overlay for a legacy folder (task 015).
 *
 * Folders are compatibility-only in the primary UI now: children render in
 * `folder.children` order (launch on click), the overlay scrolls locally,
 * and there is NO "Add App" entry anymore — apps move into sections via
 * their context menu. Escape or a backdrop click closes.
 */
export function FolderOverlay({
  folder,
  workspace,
  error,
  onClose,
  onLaunchApp,
  onChildContextMenu,
}: FolderOverlayProps) {
  const { t } = useI18n();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function childContextMenu(event: ReactMouseEvent, entityId: EntityId) {
    event.preventDefault();
    event.stopPropagation();
    onChildContextMenu(entityId, event.clientX, event.clientY);
  }

  function childKeyDown(event: ReactKeyboardEvent<HTMLElement>, entityId: EntityId) {
    if (!isContextMenuKeyEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const anchor = contextMenuAnchorFromElement(event.currentTarget);
    onChildContextMenu(entityId, anchor.x, anchor.y);
  }

  const children = folder.children.map((childId) => ({
    childId,
    entity: workspace.entities.find((candidate) => candidate.id === childId),
  }));

  return (
    <div
      className="vela-folder-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={folder.name}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="vela-folder-overlay__panel">
        <header className="vela-folder-overlay__header">
          <h2 className="vela-folder-overlay__title">{folder.name}</h2>
          <span className="vela-folder-overlay__spacer" />
          <button
            type="button"
            className="vela-button vela-folder-overlay__close"
            aria-label={t("overlay.close")}
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        {error !== undefined && error.length > 0 ? (
          <p className="vela-folder-overlay__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="vela-folder-overlay__grid" data-vd-wheel-scope="local">
          {children.map(({ childId, entity }) => {
            if (entity === undefined) {
              return (
                <div key={childId} className="vela-item vela-item--missing" title={t("overlay.missingApp")}>
                  <span className="vela-item__label">{t("overlay.missingApp")}</span>
                </div>
              );
            }
            if (entity.kind !== "app") {
              // V1 folders contain apps only — render defensively.
              return (
                <div key={childId} className="vela-item vela-item--missing" title={t("overlay.unsupported")}>
                  <span className="vela-item__label">{t("overlay.unsupported")}</span>
                </div>
              );
            }
            return (
              <button
                key={childId}
                type="button"
                className="vela-item"
                data-kind="app"
                title={entity.name}
                onClick={() => onLaunchApp(entity)}
                onContextMenu={(event) => childContextMenu(event, childId)}
                onKeyDown={(event) => childKeyDown(event, childId)}
              >
                <AppIconTile app={entity} />
                <span className="vela-item__label">{entity.name}</span>
              </button>
            );
          })}
          {children.length === 0 ? (
            <p className="vela-folder-overlay__empty">{t("overlay.empty")}</p>
          ) : null}
        </div>
        <p className="vela-folder-overlay__hint">{t("overlay.dissolveHint")}</p>
      </section>
    </div>
  );
}
