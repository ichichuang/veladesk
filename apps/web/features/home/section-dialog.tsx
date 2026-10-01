"use client";

import { useState, type FormEvent } from "react";
import type { DesktopPage, WorkspaceSnapshot } from "@veladesk/domain";
import { addPage, renamePage } from "@veladesk/domain";
import type { WorkspaceEditFailureReason } from "@veladesk/domain";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useI18n } from "../i18n/use-i18n";
import type { TranslateFn } from "../i18n/use-i18n";
import { createBrowserId } from "./browser-id";
import { stageWorkspaceAndTrySync } from "./workspace-commit";
import { VdFormDialog } from "@components/vd/form-dialog";
import { Input } from "@components/ui/input";
import "./home-shell.css";

interface SectionDialogProps {
  readonly workspace: WorkspaceSnapshot;
  /** The section whose grid a new section copies (create mode). */
  readonly gridSourcePage: DesktopPage;
  /** Rename mode when a section is given; create mode otherwise. */
  readonly section?: DesktopPage | undefined;
  readonly onClose: () => void;
  /** Create success — the shell reveals the new section after the DOM lands. */
  readonly onCreated?: (pageId: string) => void;
}

/**
 * Section name dialog (task 015, 018 designed shell): create and rename
 * share one surface.
 *
 * A new section copies the CURRENT section's grid as its snap lattice,
 * starts as a placement-native v2 Grid page (empty canvas, empty legacy
 * item list, columns from the grid source page), and — once staged — is
 * revealed by switching the explicit active section. The stored name is
 * the user's verbatim string.
 */
export function SectionDialog({ workspace, gridSourcePage, section, onClose, onCreated }: SectionDialogProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const { t } = useI18n();
  // null = untouched: shows the locale default until typing wins.
  const [nameInput, setNameInput] = useState<string | null>(null);
  const name = nameInput ?? (section !== undefined ? section.name : t("dialog.section.defaultName"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const renaming = section !== undefined;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (name.trim().length === 0) {
      setError(t("dialog.section.error.enterName"));
      return;
    }
    setBusy(true);
    setError(null);
    const createdPageId = renaming ? null : createBrowserId("page");
    try {
      let result: ReturnType<typeof renamePage>;
      if (renaming) {
        result = renamePage(workspace, section.id, name);
      } else {
        result = addPage(workspace, {
          id: createdPageId!,
          name,
          layout: {
            id: createdPageId!,
            grid: { columns: gridSourcePage.layout.grid.columns, rows: gridSourcePage.layout.grid.rows },
            items: [],
          },
          canvas: {
            version: 2,
            mode: "grid",
            columns: gridSourcePage.layout.grid.columns,
            items: [],
          },
        });
      }
      if (!result.ok) {
        setError(describeSectionFailure(result.reason, t));
        setBusy(false);
        return;
      }
      const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
      if (!staged.ok) {
        setError(t("dialog.section.error.saveFailed"));
        setBusy(false);
        return;
      }
      if (createdPageId !== null && onCreated !== undefined) {
        onCreated(createdPageId);
      }
      onClose();
    } catch (dialogError: unknown) {
      setError(
        dialogError instanceof Error ? dialogError.message : t("dialog.section.error.exception")
      );
      setBusy(false);
    }
  }

  return (
    <VdFormDialog
      title={renaming ? t("dialog.section.renameTitle") : t("dialog.section.createTitle")}
      submitLabel={
        busy ? t("dialog.section.saving") : renaming ? t("dialog.section.rename") : t("dialog.section.create")
      }
      busy={busy}
      error={error}
      cancelLabel={t("common.cancel")}
      onCancel={onClose}
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-vdu-fg" htmlFor="vela-section-name">
          {t("dialog.section.nameLabel")}
        </label>
        <Input
          id="vela-section-name"
          type="text"
          value={name}
          maxLength={80}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setNameInput(event.target.value)}
          aria-describedby={error !== null ? "vela-section-error" : undefined}
        />
      </div>
    </VdFormDialog>
  );
}

function describeSectionFailure(reason: WorkspaceEditFailureReason, t: TranslateFn): string {
  switch (reason) {
    case "page-not-found":
      return t("dialog.section.error.pageGone");
    case "duplicate-page-id":
      return t("dialog.section.error.duplicate");
    case "invalid-page-name":
      return t("dialog.section.error.enterName");
    case "page-layout-id-mismatch":
    case "page-must-be-empty":
    case "invalid-page-layout":
      return t("dialog.section.error.invalid");
    default:
      return t("dialog.section.error.saveFailed");
  }
}
