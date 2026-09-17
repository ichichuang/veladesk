"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { EntityId, Folder, WorkspaceSnapshot } from "@veladesk/domain";

import {
  addFolderToPage,
  renameFolder,
} from "@veladesk/domain";
import type { WorkspaceEditFailureReason } from "@veladesk/domain";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { createBrowserId } from "./browser-id";
import { stageWorkspaceAndTrySync } from "./workspace-commit";
import "./home-shell.css";

const DEFAULT_FOLDER_NAME = "New Folder";

interface FolderDialogProps {
  readonly workspace: WorkspaceSnapshot;
  readonly pageId: EntityId;
  /** Rename mode when a folder is given; create mode otherwise. */
  readonly folder?: Folder | undefined;
  readonly onClose: () => void;
}

/**
 * Folder name dialog — create (adds an empty folder to the page) and
 * rename share one surface. The stored name is the user's verbatim string.
 */
export function FolderDialog({ workspace, pageId, folder, onClose }: FolderDialogProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const [name, setName] = useState(folder !== undefined ? folder.name : DEFAULT_FOLDER_NAME);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const renaming = folder !== undefined;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (name.trim().length === 0) {
      setError("Enter a folder name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = renaming
        ? renameFolder(workspace, folder.id, name)
        : addFolderToPage(workspace, pageId, {
            kind: "folder",
            id: createBrowserId("folder"),
            name,
            children: [],
          });
      if (!result.ok) {
        setError(describeFolderFailure(result.reason));
        setBusy(false);
        return;
      }
      const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
      if (!staged.ok) {
        setError("The folder could not be saved.");
        setBusy(false);
        return;
      }
      onClose();
    } catch (dialogError: unknown) {
      setError(dialogError instanceof Error ? dialogError.message : "Saving the folder failed.");
      setBusy(false);
    }
  }

  return (
    <div
      className="vela-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="vela-dialog" role="dialog" aria-modal="true" aria-labelledby="vela-folder-title">
        <h2 id="vela-folder-title" className="vela-dialog__title">
          {renaming ? "Rename folder" : "New folder"}
        </h2>
        <form className="vela-form" onSubmit={handleSubmit}>
          <label className="vela-form__label" htmlFor="vela-folder-name">
            Folder name
          </label>
          <input
            id="vela-folder-name"
            className="vela-input"
            type="text"
            value={name}
            maxLength={80}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setName(event.target.value)}
            aria-describedby={error !== null ? "vela-folder-error" : undefined}
          />
          {error !== null ? (
            <p id="vela-folder-error" className="vela-form__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="vela-dialog__actions">
            <button type="button" className="vela-button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="vela-button vela-button--primary" disabled={busy}>
              {busy ? "Saving…" : renaming ? "Rename" : "Create folder"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function describeFolderFailure(reason: WorkspaceEditFailureReason): string {
  switch (reason) {
    case "page-not-found":
      return "The active page no longer exists.";
    case "folder-not-found":
      return "This folder no longer exists.";
    case "duplicate-entity-id":
      return "This folder already exists in the workspace.";
    case "folder-must-be-empty":
      return "New folders must start empty.";
    case "invalid-name":
      return "Enter a folder name.";
    case "no-space":
      return "This page is full — remove something first.";
    default:
      return "The folder could not be saved.";
  }
}
