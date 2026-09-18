"use client";

import { useEffect } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { AppShortcut, EntityId, Folder, WorkspaceSnapshot } from "@veladesk/domain";

import { generatedIconText } from "./generated-icon";
import {
  contextMenuAnchorFromElement,
  isContextMenuKeyEvent,
} from "./context-menu";
import "./home-shell.css";

interface FolderOverlayProps {
  readonly folder: Folder;
  readonly workspace: WorkspaceSnapshot;
  /** Presentation-only action error (e.g. no-space on Move to Desktop). */
  readonly error?: string | undefined;
  readonly onClose: () => void;
  readonly onAddApp: () => void;
  readonly onLaunchApp: (app: AppShortcut) => void;
  readonly onChildContextMenu: (entityId: EntityId, x: number, y: number) => void;
}

/**
 * Spatial glass overlay for an open folder.
 *
 * Children render strictly in `folder.children` order as icon + label
 * buttons (launch on click and Enter/Space). The overlay itself may scroll
 * locally; the body never does. Escape or a backdrop click closes.
 */
export function FolderOverlay({
  folder,
  workspace,
  error,
  onClose,
  onAddApp,
  onLaunchApp,
  onChildContextMenu,
}: FolderOverlayProps) {
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
          <button type="button" className="vela-button" onClick={onAddApp}>
            Add App
          </button>
          <button
            type="button"
            className="vela-button vela-folder-overlay__close"
            aria-label="Close folder"
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
        <div className="vela-folder-overlay__grid">
          {children.map(({ childId, entity }) => {
            if (entity === undefined) {
              return (
                <div key={childId} className="vela-item vela-item--missing" title="Missing app">
                  <span className="vela-item__label">Missing app</span>
                </div>
              );
            }
            if (entity.kind !== "app") {
              // V1 folders contain apps only — render defensively.
              return (
                <div key={childId} className="vela-item vela-item--missing" title="Unsupported item">
                  <span className="vela-item__label">Unsupported item</span>
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
                <span className="vela-item__icon" aria-hidden="true">
                  {generatedIconText(entity.name)}
                </span>
                <span className="vela-item__label">{entity.name}</span>
              </button>
            );
          })}
          {children.length === 0 ? (
            <p className="vela-folder-overlay__empty">This folder is empty.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
