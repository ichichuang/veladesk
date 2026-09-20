"use client";

import { useEffect, useState } from "react";
import type { DesktopPageId, EntityId, WorkspaceSnapshot } from "@veladesk/domain";
import { relocateAppToPage } from "@veladesk/domain";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useI18n } from "../i18n/use-i18n";
import { stageWorkspaceAndTrySync } from "./workspace-commit";
import "./home-shell.css";

interface MoveToSectionDialogProps {
  readonly workspace: WorkspaceSnapshot;
  readonly appId: EntityId;
  /** The app's current page, when it lives on one — excluded from the list. */
  readonly currentPageId: DesktopPageId | null;
  readonly onClose: () => void;
}

/**
 * Move-to-Section picker (task 015): lists `workspace.pages` minus the
 * app's current page, and relocates the app through the atomic domain
 * operation. A full target section keeps the dialog open with an inline
 * 该分区空间不足 / Not enough room message — the workspace is untouched.
 */
export function MoveToSectionDialog({
  workspace,
  appId,
  currentPageId,
  onClose,
}: MoveToSectionDialogProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const { t } = useI18n();
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

  const targets = workspace.pages.filter((page) => page.id !== currentPageId);

  async function handleSelect(targetPageId: DesktopPageId) {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = relocateAppToPage(workspace, appId, targetPageId);
    if (!result.ok) {
      setError(
        result.reason === "no-space"
          ? t("dialog.moveToSection.error.noSpace")
          : result.reason === "app-not-found"
            ? t("dialog.moveToSection.error.appGone")
            : t("dialog.moveToSection.error.failed")
      );
      setBusy(false);
      return;
    }
    const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
    if (!staged.ok) {
      setError(t("dialog.moveToSection.error.failed"));
      setBusy(false);
      return;
    }
    onClose();
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
      <div className="vela-dialog" role="dialog" aria-modal="true" aria-labelledby="vela-move-section-title">
        <h2 id="vela-move-section-title" className="vela-dialog__title">
          {t("dialog.moveToSection.title")}
        </h2>
        {targets.length === 0 ? (
          <p className="vela-dialog__message">{t("dialog.moveToSection.empty")}</p>
        ) : (
          <div className="vela-move-section__list" data-vd-wheel-scope="local">
            {targets.map((page) => (
              <button
                key={page.id}
                type="button"
                className="vela-button vela-move-section__option"
                disabled={busy}
                onClick={() => void handleSelect(page.id)}
              >
                {page.name}
              </button>
            ))}
          </div>
        )}
        {error !== null ? (
          <p className="vela-form__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="vela-dialog__actions">
          <button type="button" className="vela-button" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
