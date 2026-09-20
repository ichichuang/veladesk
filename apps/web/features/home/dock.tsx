"use client";

import { useMemo } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { EntityId, WorkspaceSnapshot } from "@veladesk/domain";

import { useI18n } from "../i18n/use-i18n";
import { resolveDockEntities } from "./dock-model";
import {
  contextMenuAnchorFromElement,
  isContextMenuKeyEvent,
} from "./context-menu";
import { appIconDecorationProps, AppIconGlyph } from "./app-icon-renderer";
import { generatedIconText } from "./generated-icon";
import { launchApp } from "./launch-app";
import "./home-shell.css";

interface DockProps {
  readonly workspace: WorkspaceSnapshot;
  readonly onOpenFolder: (folderId: EntityId) => void;
  readonly onEntityContextMenu: (entityId: EntityId, x: number, y: number) => void;
  /** Empty-area command menu (native right-click is suppressed here). */
  readonly onDesktopContextMenu: (x: number, y: number) => void;
}

/**
 * Floating bottom dock — pinned entities ONLY (task 015).
 *
 * No utility cluster, no separator, no create/mode buttons: every desktop
 * command moved into the context menu surface. With zero resolvable pins
 * the dock does not exist in the DOM at all (`null` — never an empty
 * shell). Dock apps launch on click; legacy dock folders open their
 * overlay; right-click / Shift+F10 opens the entity context menu.
 */
export function Dock({ workspace, onOpenFolder, onEntityContextMenu, onDesktopContextMenu }: DockProps) {
  const { t } = useI18n();

  const dockEntities = useMemo(() => resolveDockEntities(workspace), [workspace]);

  if (dockEntities.length === 0) {
    return null;
  }

  function handleEntityContextMenu(event: ReactMouseEvent, entityId: EntityId) {
    event.preventDefault();
    event.stopPropagation();
    onEntityContextMenu(entityId, event.clientX, event.clientY);
  }

  function handleEntityKeyDown(event: ReactKeyboardEvent<HTMLElement>, entityId: EntityId) {
    if (!isContextMenuKeyEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const anchor = contextMenuAnchorFromElement(event.currentTarget);
    onEntityContextMenu(entityId, anchor.x, anchor.y);
  }

  return (
    <nav
      className="vela-dock"
      aria-label={t("dock.label")}
      onContextMenu={(event) => {
        // Dock surface: never the browser menu; empty dock chrome falls
        // through to the desktop command menu.
        event.preventDefault();
        onDesktopContextMenu(event.clientX, event.clientY);
      }}
    >
      {dockEntities.map((entity) =>
        entity.kind === "app" ? (
          <button
            key={entity.id}
            type="button"
            className="vela-dock__item"
            title={entity.name}
            aria-label={t("dock.openApp", { name: entity.name })}
            onClick={() => launchApp(entity)}
            onContextMenu={(event) => handleEntityContextMenu(event, entity.id)}
            onKeyDown={(event) => handleEntityKeyDown(event, entity.id)}
            {...appIconDecorationProps(entity)}
          >
            <AppIconGlyph app={entity} />
          </button>
        ) : (
          <button
            key={entity.id}
            type="button"
            className="vela-dock__item vela-dock__item--folder"
            title={entity.name}
            aria-label={t("dock.openFolder", { name: entity.name })}
            aria-haspopup="dialog"
            onClick={() => onOpenFolder(entity.id)}
            onContextMenu={(event) => handleEntityContextMenu(event, entity.id)}
            onKeyDown={(event) => handleEntityKeyDown(event, entity.id)}
          >
            <span className="vela-app-icon__text">{generatedIconText(entity.name)}</span>
          </button>
        )
      )}
    </nav>
  );
}
