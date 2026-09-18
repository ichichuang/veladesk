"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { AppShortcut, DesktopPageId, EntityId, WorkspaceSnapshot } from "@veladesk/domain";

import { addAppToFolder, addAppToPage } from "@veladesk/domain";
import type { WorkspaceEditFailureReason } from "@veladesk/domain";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useI18n } from "../i18n/use-i18n";
import type { TranslateFn } from "../i18n/use-i18n";
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
  const { t } = useI18n();
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
      setError(t("dialog.addApp.error.enterName"));
      return;
    }
    if (url.trim().length === 0) {
      setError(t("dialog.addApp.error.enterUrl"));
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
        setError(describeAddFailure(added.reason, t));
        setBusy(false);
        return;
      }
      const staged = await stageWorkspaceAndTrySync(runtime, added.workspace);
      if (!staged.ok) {
        setError(t("dialog.addApp.error.addFailed"));
        setBusy(false);
        return;
      }
      // Icon is visible immediately (local stage); sync is follow-up.
      onClose();
    } catch (dialogError: unknown) {
      setError(
        dialogError instanceof Error ? dialogError.message : t("dialog.addApp.error.exception")
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
          {t("dialog.addApp.title")}
        </h2>
        <form className="vela-form" onSubmit={handleSubmit}>
          <label className="vela-form__label" htmlFor="vela-add-app-name">
            {t("dialog.nameLabel")}
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
            {t("dialog.urlLabel")}
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
              {t("common.cancel")}
            </button>
            <button type="submit" className="vela-button vela-button--primary" disabled={busy}>
              {busy ? t("dialog.addApp.adding") : t("dialog.addApp.add")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function describeAddFailure(reason: WorkspaceEditFailureReason, t: TranslateFn): string {
  switch (reason) {
    case "page-not-found":
      return t("dialog.addApp.error.pageGone");
    case "folder-not-found":
      return t("dialog.addApp.error.folderGone");
    case "duplicate-entity-id":
      return t("dialog.addApp.error.duplicate");
    case "no-space":
      return t("dialog.addApp.error.noSpace");
    case "invalid-name":
      return t("dialog.addApp.error.enterName");
    case "invalid-url":
      return t("dialog.addApp.error.enterUrl");
    default:
      return t("dialog.addApp.error.addFailed");
  }
}
