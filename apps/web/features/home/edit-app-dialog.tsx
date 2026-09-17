"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { AppOpenMode, AppShortcut, WorkspaceSnapshot } from "@veladesk/domain";

import { replaceApp } from "@veladesk/domain";
import type { WorkspaceEditFailureReason } from "@veladesk/domain";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { generatedIconText } from "./generated-icon";
import { stageWorkspaceAndTrySync } from "./workspace-commit";
import "./home-shell.css";

const OPEN_MODES: readonly AppOpenMode[] = ["new-tab", "same-tab", "new-window", "popup"];

interface EditAppDialogProps {
  readonly workspace: WorkspaceSnapshot;
  readonly appId: AppShortcut["id"];
  readonly onClose: () => void;
}

/**
 * Edit App dialog: name, URL and open mode.
 *
 * Values are stored verbatim (custom protocols stay valid). Identity,
 * description, category, tags and container/dock placement are preserved;
 * only a generated icon is recalculated from the new name — every other
 * icon kind is kept as-is.
 */
export function EditAppDialog({ workspace, appId, onClose }: EditAppDialogProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const existing = workspace.entities.find(
    (entity): entity is AppShortcut => entity.kind === "app" && entity.id === appId
  );
  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [openMode, setOpenMode] = useState<AppOpenMode>(existing?.openMode ?? "new-tab");
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

  if (existing === undefined) {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || existing === undefined) {
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
      const nextApp: AppShortcut = {
        ...existing,
        // Verbatim user input: no trimming, no protocol rewriting.
        name,
        url,
        openMode,
        icon:
          existing.icon.kind === "generated"
            ? { kind: "generated", text: generatedIconText(name) }
            : existing.icon,
      };
      const result = replaceApp(workspace, nextApp);
      if (!result.ok) {
        setError(describeEditFailure(result.reason));
        setBusy(false);
        return;
      }
      const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
      if (!staged.ok) {
        setError("The changes could not be saved.");
        setBusy(false);
        return;
      }
      onClose();
    } catch (dialogError: unknown) {
      setError(dialogError instanceof Error ? dialogError.message : "Saving the app failed.");
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
      <div className="vela-dialog" role="dialog" aria-modal="true" aria-labelledby="vela-edit-app-title">
        <h2 id="vela-edit-app-title" className="vela-dialog__title">
          Edit app
        </h2>
        <form className="vela-form" onSubmit={handleSubmit}>
          <label className="vela-form__label" htmlFor="vela-edit-app-name">
            Name
          </label>
          <input
            id="vela-edit-app-name"
            className="vela-input"
            type="text"
            value={name}
            maxLength={80}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setName(event.target.value)}
          />
          <label className="vela-form__label" htmlFor="vela-edit-app-url">
            URL
          </label>
          <input
            id="vela-edit-app-url"
            className="vela-input"
            type="text"
            inputMode="url"
            value={url}
            maxLength={2048}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://… or obsidian://…"
            onChange={(event) => setUrl(event.target.value)}
            aria-describedby={error !== null ? "vela-edit-app-error" : undefined}
          />
          <label className="vela-form__label" htmlFor="vela-edit-app-mode">
            Open mode
          </label>
          <select
            id="vela-edit-app-mode"
            className="vela-input"
            value={openMode}
            onChange={(event) => setOpenMode(event.target.value as AppOpenMode)}
          >
            {OPEN_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {describeOpenMode(mode)}
              </option>
            ))}
          </select>
          {error !== null ? (
            <p id="vela-edit-app-error" className="vela-form__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="vela-dialog__actions">
            <button type="button" className="vela-button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="vela-button vela-button--primary" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function describeOpenMode(mode: AppOpenMode): string {
  switch (mode) {
    case "new-tab":
      return "New tab";
    case "same-tab":
      return "Same tab";
    case "new-window":
      return "New window";
    case "popup":
      return "Popup window";
  }
}

function describeEditFailure(reason: WorkspaceEditFailureReason): string {
  switch (reason) {
    case "app-not-found":
      return "This app no longer exists.";
    case "invalid-name":
      return "Enter a name.";
    case "invalid-url":
      return "Enter a URL.";
    default:
      return "The changes could not be saved.";
  }
}
