"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { AppShortcut, DesktopPageId, WorkspaceSnapshot } from "@veladesk/domain";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { addAppToPage } from "./workspace-layout";
import { createBrowserId } from "./browser-id";
import { generatedIconText } from "./generated-icon";
import "./home-shell.css";

interface AddAppDialogProps {
  readonly workspace: WorkspaceSnapshot;
  readonly pageId: DesktopPageId;
  readonly onClose: () => void;
}

/**
 * Minimal Add App flow: name + URL, nothing else.
 *
 * Values are stored verbatim — no protocol rewriting, no URL() parsing, so
 * https://, obsidian://, steam:// and friends are all valid. The app is
 * placed on the active page with nearest-free 1x1 placement, staged
 * locally-first, and the follow-up sync is fired without blocking.
 */
export function AddAppDialog({ workspace, pageId, onClose }: AddAppDialogProps) {
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
      const added = addAppToPage(workspace, pageId, app);
      if (!added.ok) {
        setError(describeAddFailure(added.reason));
        setBusy(false);
        return;
      }
      const staged = await runtime.stageWorkspaceUpdate(added.workspace);
      if (!staged.ok) {
        setError("The app could not be added to this workspace.");
        setBusy(false);
        return;
      }
      // Icon is visible immediately (local stage); sync is follow-up.
      void runtime.syncCurrent().catch(() => {});
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

function describeAddFailure(reason: "page-not-found" | "duplicate-entity-id" | "no-space"): string {
  switch (reason) {
    case "page-not-found":
      return "The active page no longer exists.";
    case "duplicate-entity-id":
      return "This app already exists in the workspace.";
    case "no-space":
      return "This page is full — remove something or switch pages first.";
  }
}
