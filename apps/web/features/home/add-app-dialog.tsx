"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { AppShortcut, DesktopPageId, EntityId, WorkspaceSnapshot } from "@veladesk/domain";

import { addAppToFolder, addAppToPage } from "@veladesk/domain";
import type { WorkspaceEditFailureReason } from "@veladesk/domain";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { createBrowserId } from "./browser-id";
import { generatedIconText } from "./generated-icon";
import { stageWorkspaceAndTrySync } from "./workspace-commit";
import "./home-shell.css";

/** Where a newly created app lands: a page layout or directly in a folder. */
export type AddAppDestination =
  | { readonly kind: "page"; readonly pageId: DesktopPageId }
  | { readonly kind: "folder"; readonly folderId: EntityId };

interface AddAppDialogProps {
  readonly workspace: WorkspaceSnapshot;
  readonly destination: AddAppDestination;
  readonly onClose: () => void;
}

/**
 * Minimal Add App flow: name + URL, nothing else.
 *
 * Values are stored verbatim — no protocol rewriting, no URL() parsing, so
 * https://, obsidian://, steam:// and friends are all valid. With a page
 * destination the app is placed nearest-free 1x1 on that page; with a
 * folder destination it is created directly inside the folder (no desktop
 * layout item, no automatic dock pin). The app is staged locally-first and
 * the follow-up sync is fired without blocking.
 */
export function AddAppDialog({ workspace, destination, onClose }: AddAppDialogProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (name.trim().length === 0) {
      setError("Enter a name.");
      return;
    }
    if (url.trim().length === 0) {
      setError("Enter a URL.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const app: AppShortcut = {
        kind: "app",
        id: createBrowserId("app"),
        // Verbatim user input on purpose: no trimming, no protocol edits.
        name,
        url,
        icon: { kind: "generated", text: generatedIconText(name) },
        openMode: "new-tab",
        tags: [],
      };
      const added =
        destination.kind === "page"
          ? addAppToPage(workspace, destination.pageId, app)
          : addAppToFolder(workspace, destination.folderId, app);
      if (!added.ok) {
        setError(describeAddFailure(added.reason));
        setBusy(false);
        return;
      }
      const staged = await stageWorkspaceAndTrySync(runtime, added.workspace);
      if (!staged.ok) {
        setError("The app could not be added to this workspace.");
        setBusy(false);
        return;
      }
      // Icon is visible immediately (local stage); sync is follow-up.
      onClose();
    } catch (dialogError: unknown) {
      setError(
        dialogError instanceof Error ? dialogError.message : "Adding the app failed."
      );
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
      <div
        className="vela-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vela-add-app-title"
      >
        <h2 id="vela-add-app-title" className="vela-dialog__title">
          Add app
        </h2>
        <form className="vela-form" onSubmit={handleSubmit}>
          <label className="vela-form__label" htmlFor="vela-add-app-name">
            Name
          </label>
          <input
            id="vela-add-app-name"
            className="vela-input"
            type="text"
            value={name}
            maxLength={80}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setName(event.target.value)}
          />
          <label className="vela-form__label" htmlFor="vela-add-app-url">
            URL
          </label>
          <input
            id="vela-add-app-url"
            className="vela-input"
            type="text"
            inputMode="url"
            value={url}
            maxLength={2048}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://… or obsidian://…"
            onChange={(event) => setUrl(event.target.value)}
            aria-describedby={error !== null ? "vela-add-app-error" : undefined}
          />
          {error !== null ? (
            <p id="vela-add-app-error" className="vela-form__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="vela-dialog__actions">
            <button
              type="button"
              className="vela-button"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="submit" className="vela-button vela-button--primary" disabled={busy}>
              {busy ? "Adding…" : "Add app"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function describeAddFailure(reason: WorkspaceEditFailureReason): string {
  switch (reason) {
    case "page-not-found":
      return "The target page no longer exists.";
    case "folder-not-found":
      return "This folder no longer exists.";
    case "duplicate-entity-id":
      return "This app already exists in the workspace.";
    case "no-space":
      return "This page is full — remove something or switch pages first.";
    case "invalid-name":
      return "Enter a name.";
    case "invalid-url":
      return "Enter a URL.";
    default:
      return "The app could not be added.";
  }
}
