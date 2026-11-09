"use client";

import { useRef, useState } from "react";
import type { DragEvent } from "react";
import type { WorkspaceSnapshot, WorkspaceWallpaperPreset } from "@veladesk/domain";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useI18n } from "../i18n/use-i18n";
import type { TranslationKey } from "../i18n/messages";
import { createBrowserId } from "../home/browser-id";
import { stageWorkspaceAndTrySync } from "../home/workspace-commit";

import type { ImportIssue, ImportIssueCode } from "./contract";
import { IMPORT_MAX_FILE_BYTES, IMPORT_MAX_JSON_TEXT_LENGTH } from "./contract";
import { applyImportPlan } from "./apply-import";
import { importPlanIsBlocked, importPlanIsNoOp, planImport, plansMateriallyEqual } from "./planner";
import type { ImportPlan } from "./planner";
import { parseImportDocument } from "./parser";
import type { ParseImportOptions } from "./parser";
import { recipeSpacePreviews } from "./recipe-adapter";
import type { RecipeImportExtras, RecipeSpacePreview, RecipeWallpaperPreview } from "./recipe-adapter";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@components/ui/dialog";
import { Button } from "@components/ui/button";
import { Checkbox } from "@components/ui/checkbox";
import { VdScrollArea } from "@components/vd/scroll-area";

interface ImportJsonDialogProps {
  /** Live snapshot prop — re-renders keep it current for the confirm-time check. */
  readonly workspace: WorkspaceSnapshot;
  readonly onClose: () => void;
}

/** Issue code → localized message key (total by construction). */
const ISSUE_MESSAGE_KEY: Readonly<Record<ImportIssueCode, TranslationKey>> = {
  INVALID_JSON: "import.issue.INVALID_JSON",
  FILE_TOO_LARGE: "import.issue.FILE_TOO_LARGE",
  INVALID_ROOT: "import.issue.INVALID_ROOT",
  INVALID_FORMAT: "import.issue.INVALID_FORMAT",
  UNSUPPORTED_VERSION: "import.issue.UNSUPPORTED_VERSION",
  RECIPE_MIGRATED: "import.issue.RECIPE_MIGRATED",
  RECIPE_THEME_IGNORED: "import.issue.RECIPE_THEME_IGNORED",
  MISSING_SECTIONS: "import.issue.MISSING_SECTIONS",
  INVALID_SECTIONS: "import.issue.INVALID_SECTIONS",
  TOO_MANY_SECTIONS: "import.issue.TOO_MANY_SECTIONS",
  MISSING_SECTION_NAME: "import.issue.MISSING_SECTION_NAME",
  INVALID_SECTION_NAME: "import.issue.INVALID_SECTION_NAME",
  INVALID_SECTION: "import.issue.INVALID_SECTION",
  MISSING_APPS: "import.issue.MISSING_APPS",
  INVALID_APPS: "import.issue.INVALID_APPS",
  TOO_MANY_APPS: "import.issue.TOO_MANY_APPS",
  MISSING_APP_NAME: "import.issue.MISSING_APP_NAME",
  INVALID_APP_NAME: "import.issue.INVALID_APP_NAME",
  INVALID_APP: "import.issue.INVALID_APP",
  MISSING_APP_URL: "import.issue.MISSING_APP_URL",
  INVALID_APP_URL: "import.issue.INVALID_APP_URL",
  INVALID_ICON: "import.issue.INVALID_ICON",
  UNSUPPORTED_FIELD_IGNORED: "import.issue.UNSUPPORTED_FIELD_IGNORED",
  DUPLICATE_IMPORT_SECTION: "import.issue.DUPLICATE_IMPORT_SECTION",
  DUPLICATE_IMPORT_APP: "import.issue.DUPLICATE_IMPORT_APP",
  DUPLICATE_WORKSPACE_APP: "import.issue.DUPLICATE_WORKSPACE_APP",
  AMBIGUOUS_EXISTING_SECTION: "import.issue.AMBIGUOUS_EXISTING_SECTION",
};

const MIB = 1024 * 1024;

/**
 * Import apps & sections (task 024): local-only parse → plan → preview →
 * ONE confirmed write. Every step before the confirmed Import performs
 * zero workspace writes; the confirm path re-derives the plan from the
 * CURRENT snapshot and, when the workspace changed materially since the
 * preview, asks for a second confirmation instead of writing.
 *
 * Recipe (.deck.json) documents ride the same pipeline and additionally
 * preview each space's structure (layout mode, grid, tiles, wallpapers)
 * with an opt-in "apply theme & motion" checkbox — unchecked by default.
 */
export function ImportJsonDialog({ workspace, onClose }: ImportJsonDialogProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const { t } = useI18n();
  const [mode, setMode] = useState<"upload" | "paste">("upload");
  const [phase, setPhase] = useState<"input" | "preview" | "done">("input");
  const [pasteText, setPasteText] = useState("");
  const [sourceText, setSourceText] = useState<string | null>(null);
  /** The size budget the CURRENT source was vetted under (paste 1 MiB / file 24 MiB). */
  const [sourceBudget, setSourceBudget] = useState<number>(IMPORT_MAX_JSON_TEXT_LENGTH);
  const [parseIssues, setParseIssues] = useState<readonly ImportIssue[] | null>(null);
  const [parseSectionNames, setParseSectionNames] = useState<readonly (string | undefined)[]>([]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [recipeExtras, setRecipeExtras] = useState<RecipeImportExtras | null>(null);
  const [applyTheme, setApplyTheme] = useState(false);
  const [workspaceChanged, setWorkspaceChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [doneSummary, setDoneSummary] = useState<ImportPlan["summary"] | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function requestClose(): void {
    // Never abandon a save in flight.
    if (busy) {
      return;
    }
    onClose();
  }

  function parseAndPreview(text: string, maxLength: number = IMPORT_MAX_JSON_TEXT_LENGTH): void {
    setSourceText(text);
    setSourceBudget(maxLength);
    const options: ParseImportOptions = { maxLength };
    const result = parseImportDocument(text, options);
    if (!result.ok) {
      setParseIssues(result.issues);
      setParseSectionNames(result.sectionNames);
      setPlan(null);
      setRecipeExtras(null);
      setWorkspaceChanged(false);
      setPhase("input");
      return;
    }
    setParseIssues(null);
    setParseSectionNames([]);
    setInputError(null);
    setPlan(planImport(workspace, result.parsed.document, result.parsed.issues));
    setRecipeExtras(result.parsed.recipe ?? null);
    setApplyTheme(false);
    setWorkspaceChanged(false);
    setPhase("preview");
  }

  async function handleFile(file: File): Promise<void> {
    if (file.size > IMPORT_MAX_FILE_BYTES) {
      setInputError(t("import.error.fileTooLarge", { limit: String(Math.round(IMPORT_MAX_FILE_BYTES / MIB)) }));
      return;
    }
    const text = await file.text();
    parseAndPreview(text, IMPORT_MAX_FILE_BYTES);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 1) {
      setInputError(t("import.error.multipleFiles"));
      return;
    }
    const file = files[0];
    if (file !== undefined) {
      void handleFile(file);
    }
  }

  async function handleImport(): Promise<void> {
    if (busy || phase !== "preview" || plan === null || sourceText === null) {
      return;
    }
    setBusy(true);
    setSaveError(null);
    try {
      // Re-derive from the CURRENT snapshot (task 024 §36): the live prop is
      // the latest staged snapshot — anything may have changed since preview.
      // The source keeps the budget it was vetted under at input time.
      const result = parseImportDocument(sourceText, { maxLength: sourceBudget });
      if (!result.ok) {
        setParseIssues(result.issues);
        setParseSectionNames(result.sectionNames);
        setPlan(null);
        setRecipeExtras(null);
        setPhase("input");
        return;
      }
      const current = workspace;
      const replanned = planImport(current, result.parsed.document, result.parsed.issues);
      if (current !== plan.baseWorkspace && !plansMateriallyEqual(plan, replanned)) {
        // Material change: update the preview and require a second confirm.
        setPlan(replanned);
        setRecipeExtras(result.parsed.recipe ?? null);
        setWorkspaceChanged(true);
        return;
      }
      if (importPlanIsBlocked(replanned) || importPlanIsNoOp(replanned)) {
        setPlan(replanned);
        setRecipeExtras(result.parsed.recipe ?? null);
        setWorkspaceChanged(false);
        return;
      }
      const applied = applyImportPlan(current, replanned, (kind) => createBrowserId(kind), {
        recipe: result.parsed.recipe,
        applyTheme,
      });
      if (!applied.ok) {
        setSaveError(t("import.error.saveFailed"));
        return;
      }
      // ONE workspace revision per confirmed import (task 024 §39).
      const staged = await stageWorkspaceAndTrySync(runtime, applied.workspace);
      if (!staged.ok) {
        setSaveError(t("import.error.saveFailed"));
        return;
      }
      setDoneSummary(replanned.summary);
      setWorkspaceChanged(false);
      setPhase("done");
    } catch (dialogError: unknown) {
      setSaveError(
        dialogError instanceof Error ? dialogError.message : t("import.error.saveFailed")
      );
    } finally {
      setBusy(false);
    }
  }

  const blocked = plan !== null && importPlanIsBlocked(plan);
  const noOp = plan !== null && importPlanIsNoOp(plan);
  const importDisabled = busy || blocked || noOp;
  const spacePreviews =
    plan !== null && recipeExtras !== null ? recipeSpacePreviews(plan.document, recipeExtras) : undefined;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : requestClose())}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        data-vd-wheel-scope="local"
        className="h-[600px] max-h-[calc(100dvh-32px)] w-[680px] max-w-[calc(100vw-32px)]"
      >
        <header className="shrink-0 px-5 pb-3 pt-5">
          <DialogTitle className="text-base">{t("import.title")}</DialogTitle>
          <DialogDescription className="mt-1">
            {phase === "done" ? t("import.doneHint") : t("settings.data.import.hint")}
          </DialogDescription>
        </header>

        <VdScrollArea axis="y" className="min-h-0 flex-1 px-5" data-vd-wheel-scope="local">
          {phase === "input" ? (
            <div className="flex flex-col gap-4 pb-2">
              <div className="flex items-center gap-2" role="group" aria-label={t("import.title")}>
                <Button
                  type="button"
                  variant={mode === "upload" ? "primary" : "secondary"}
                  autoFocus
                  onClick={() => {
                    setMode("upload");
                    setParseIssues(null);
                    setInputError(null);
                  }}
                >
                  {t("import.mode.upload")}
                </Button>
                <Button
                  type="button"
                  variant={mode === "paste" ? "primary" : "secondary"}
                  onClick={() => {
                    setMode("paste");
                    setParseIssues(null);
                    setInputError(null);
                  }}
                >
                  {t("import.mode.paste")}
                </Button>
              </div>

              {mode === "upload" ? (
                <div
                  className="flex flex-col items-center justify-center gap-3 rounded-vdu border border-dashed border-vdu-border-strong px-6 py-10"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDrop}
                  data-import-dropzone=""
                >
                  <p className="text-sm text-vdu-fg-muted">{t("import.dropHint")}</p>
                  <p className="text-xs text-vdu-fg-muted">{t("import.dropSizeHint")}</p>
                  <p className="text-xs text-vdu-fg-muted">{t("import.dropOr")}</p>
                  <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                    {t("import.chooseFile")}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".json,application/json"
                    aria-label={t("import.fileLabel")}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file !== undefined) {
                        void handleFile(file);
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-vdu-fg" htmlFor="vela-import-paste">
                    {t("import.pasteLabel")}
                  </label>
                  <span className="text-xs text-vdu-fg-muted">{t("import.pasteSizeHint")}</span>
                  <textarea
                    id="vela-import-paste"
                    className="min-h-[240px] w-full resize-none rounded-vdu border border-vdu-border bg-vdu-bg-raised px-3 py-2 font-mono text-xs text-vdu-fg placeholder:text-vdu-fg-disabled hover:border-vdu-border-strong outline-none focus-visible:border-vdu-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--vdu-focus)]"
                    spellCheck={false}
                    value={pasteText}
                    onChange={(event) => setPasteText(event.target.value)}
                  />
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="primary"
                      disabled={pasteText.trim().length === 0}
                      onClick={() => parseAndPreview(pasteText)}
                    >
                      {t("import.parseAndPreview")}
                    </Button>
                  </div>
                </div>
              )}

              {inputError !== null ? (
                <p className="text-xs text-vdu-danger" role="alert">
                  {inputError}
                </p>
              ) : null}
              {parseIssues !== null ? (
                <div className="flex flex-col gap-1.5" role="alert" data-import-errors="">
                  <p className="text-xs font-medium text-vdu-danger">{t("import.errors")}</p>
                  {parseIssues
                    .filter((issue) => issue.severity === "error")
                    .map((issue, index) => (
                      <p key={index} className="text-xs text-vdu-danger">
                        {describeIssue(issue, parseSectionNames, t)}
                      </p>
                    ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {phase === "preview" && plan !== null ? (
            <div className="flex flex-col gap-4 pb-2" aria-live="polite">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-vdu-fg">{t("import.readyTitle")}</p>
                {recipeExtras === null ? (
                  <>
                    <p className="text-xs text-vdu-fg-muted">
                      {t("import.summaryLine", { sections: plan.summary.inputSections, apps: plan.summary.inputApps })}
                    </p>
                    <p className="text-xs text-vdu-fg-muted">
                      {t("import.createLine", { sections: plan.summary.createSections, apps: plan.summary.createApps })}
                    </p>
                    <p className="text-xs text-vdu-fg-muted">
                      {t("import.mergeLine", { sections: plan.summary.mergeSections })}
                    </p>
                    <p className="text-xs text-vdu-fg-muted">
                      {t("import.skipLine", { apps: plan.summary.duplicateApps })}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-vdu-fg-muted">
                      {t("import.recipe.summaryLine", { spaces: plan.summary.inputSections, tiles: plan.summary.inputApps })}
                    </p>
                    <p className="text-xs text-vdu-fg-muted">
                      {t("import.recipe.createLine", { spaces: plan.summary.createSections, tiles: plan.summary.createApps })}
                    </p>
                    {plan.summary.mergeSections > 0 ? (
                      <p className="text-xs text-vdu-fg-muted">
                        {t("import.recipe.mergeLine", { spaces: plan.summary.mergeSections })}
                      </p>
                    ) : null}
                    {plan.summary.duplicateApps > 0 ? (
                      <p className="text-xs text-vdu-fg-muted">
                        {t("import.recipe.skipLine", { tiles: plan.summary.duplicateApps })}
                      </p>
                    ) : null}
                  </>
                )}
                {noOp ? <p className="text-xs text-vdu-fg-muted">{t("import.noChanges")}</p> : null}
              </div>

              {recipeExtras !== null && (recipeExtras.theme !== undefined || recipeExtras.motion !== undefined) ? (
                <div
                  className="flex flex-col gap-1.5 rounded-vdu border border-vdu-border bg-vdu-bg-raised px-3 py-2.5"
                  data-import-theme-offer=""
                >
                  <p className="text-xs text-vdu-fg-muted">
                    {recipeExtras.theme !== undefined && recipeExtras.motion !== undefined
                      ? t("import.recipe.hasThemeAndMotion")
                      : recipeExtras.theme !== undefined
                        ? t("import.recipe.hasTheme")
                        : t("import.recipe.hasMotion")}
                  </p>
                  <label className="flex cursor-pointer items-center gap-2" htmlFor="vela-import-apply-theme">
                    <Checkbox
                      id="vela-import-apply-theme"
                      checked={applyTheme}
                      disabled={busy}
                      onCheckedChange={(checked) => setApplyTheme(checked === true)}
                    />
                    <span className="text-sm text-vdu-fg">{t("import.recipe.applyTheme")}</span>
                  </label>
                  <p className="text-xs text-vdu-fg-muted">{t("import.recipe.applyThemeHint")}</p>
                </div>
              ) : null}

              {workspaceChanged ? (
                <p className="rounded-vdu border border-vdu-border bg-vdu-bg-raised px-3 py-2 text-xs text-vdu-fg" role="status">
                  {t("import.workspaceChanged")}
                </p>
              ) : null}

              {plan.errors.length > 0 ? (
                <div className="flex flex-col gap-1.5" role="alert" data-import-errors="">
                  <p className="text-xs font-medium text-vdu-danger">{t("import.errors")}</p>
                  {plan.errors.map((issue, index) => (
                    <p key={index} className="text-xs text-vdu-danger">
                      {describeIssue(issue, plan.document.sections.map((section) => section.name), t)}
                    </p>
                  ))}
                </div>
              ) : null}

              {plan.warnings.length > 0 ? (
                <details className="text-xs text-vdu-fg-muted" data-import-warnings="">
                  <summary className="cursor-pointer">
                    {t("import.noticeCount", { count: plan.warnings.length })}
                  </summary>
                  <ul className="mt-1.5 flex flex-col gap-1 pl-4">
                    {plan.warnings.map((issue, index) => (
                      <li key={index} className="list-disc">
                        {describeIssue(issue, plan.document.sections.map((section) => section.name), t)}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              <div className="flex flex-col divide-y divide-vdu-border" data-import-sections="">
                {plan.sections.map((section, index) => {
                  const creates = section.apps.filter((app) => app.action === "create").length;
                  const duplicates = section.apps.length - creates;
                  const space = spacePreviews?.get(section.nameKey);
                  return (
                    <div key={index} className="flex flex-col gap-0.5 py-2">
                      <span className="text-sm font-medium text-vdu-fg">{section.displayName}</span>
                      <span className="text-xs text-vdu-fg-muted">
                        {section.action === "merge"
                          ? t(space === undefined ? "import.section.merge" : "import.recipe.section.merge")
                          : t(space === undefined ? "import.section.create" : "import.recipe.section.create")}
                        {section.apps.length === 0
                          ? ` · ${t("import.section.empty")}`
                          : ` · ${t("import.section.newApps", { count: creates })}`}
                        {duplicates > 0 ? ` · ${t("import.section.duplicateApps", { count: duplicates })}` : ""}
                      </span>
                      {space !== undefined && section.action === "merge" ? (
                        <span className="text-xs text-vdu-fg-muted">{t("import.recipe.section.mergeNote")}</span>
                      ) : null}
                      {space !== undefined && section.action === "create" ? (
                        <span className="text-xs text-vdu-fg-muted" data-import-space-structure="">
                          {spaceStructureLine(space, t)}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {saveError !== null ? (
                <p className="text-xs text-vdu-danger" role="alert">
                  {saveError}
                </p>
              ) : null}
            </div>
          ) : null}

          {phase === "done" && doneSummary !== null ? (
            <div className="flex flex-col gap-1.5 pb-2" aria-live="polite">
              <p className="text-sm font-medium text-vdu-fg">{t("import.doneTitle")}</p>
              <p className="text-xs text-vdu-fg-muted">
                {t("import.doneSections", { count: doneSummary.createSections })}
              </p>
              <p className="text-xs text-vdu-fg-muted">{t("import.doneApps", { count: doneSummary.createApps })}</p>
              <p className="text-xs text-vdu-fg-muted">
                {t("import.doneDuplicates", { count: doneSummary.duplicateApps })}
              </p>
            </div>
          ) : null}
        </VdScrollArea>

        <footer className="flex shrink-0 items-center justify-end gap-2.5 px-5 pb-5 pt-3">
          {phase === "preview" ? (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setPhase("input")}>
              {t("import.back")}
            </Button>
          ) : phase === "done" ? null : (
            <Button type="button" variant="ghost" disabled={busy} onClick={requestClose}>
              {t("common.cancel")}
            </Button>
          )}
          {phase === "preview" ? (
            <Button type="button" variant="primary" disabled={importDisabled} onClick={() => void handleImport()}>
              {busy ? t("import.importing") : t("import.import")}
            </Button>
          ) : phase === "done" ? (
            <Button type="button" variant="primary" onClick={requestClose}>
              {t("import.done")}
            </Button>
          ) : null}
        </footer>
      </DialogContent>
    </Dialog>
  );
}

// --- recipe preview rendering ---------------------------------------------------

/** The wallpaper preset's localized display name (total over the whitelist). */
const PRESET_NAME_KEY: Readonly<Record<WorkspaceWallpaperPreset, TranslationKey>> = {
  aurora: "settings.wallpaper.aurora",
  midnight: "settings.wallpaper.midnight",
  dawn: "settings.wallpaper.dawn",
  mist: "settings.wallpaper.mist",
};

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** `Snap · 8×5 grid · 2 tiles · Light wallpaper: Aurora · Dark wallpaper: custom image`. */
function spaceStructureLine(space: RecipeSpacePreview, t: Translate): string {
  const wallpaperName = (wallpaper: RecipeWallpaperPreview): string =>
    wallpaper.kind === "preset" ? t(PRESET_NAME_KEY[wallpaper.presetId]) : t("import.recipe.wallpaper.asset");
  const parts = [
    space.layoutMode === "free" ? t("import.recipe.layout.free") : t("import.recipe.layout.snap"),
    space.grid === undefined
      ? t("import.recipe.gridDefault")
      : t("import.recipe.grid", { columns: space.grid.columns, rows: space.grid.rows }),
    t("import.recipe.tiles", { count: space.tileCount }),
  ];
  if (space.light !== undefined) {
    parts.push(t("import.recipe.wallpaper.light", { name: wallpaperName(space.light) }));
  }
  if (space.dark !== undefined) {
    parts.push(t("import.recipe.wallpaper.dark", { name: wallpaperName(space.dark) }));
  }
  return parts.join(" · ");
}

/** Renders `AI → app 3 · Invalid url`-style context + message pairs. */
function describeIssue(
  issue: ImportIssue,
  sectionNames: readonly (string | undefined)[],
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): string {
  const location = issueLocation(issue.path, sectionNames, t);
  const params: Record<string, string | number> = {};
  if (typeof issue.value === "string") {
    params.value = issue.value;
  } else if (typeof issue.value === "number") {
    params.value = issue.value;
  }
  if (issue.code === "INVALID_JSON" && typeof issue.value === "string") {
    params.detail = issue.value;
  }
  if (issue.code === "UNSUPPORTED_FIELD_IGNORED") {
    params.path = issue.path;
  }
  const message = t(ISSUE_MESSAGE_KEY[issue.code], params);
  return location === "" ? message : `${location} · ${message}`;
}

function issueLocation(
  path: string,
  sectionNames: readonly (string | undefined)[],
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): string {
  const match = /^sections\[(\d+)\](?:\.apps\[(\d+)\])?/.exec(path);
  if (match === null) {
    return "";
  }
  const sectionIndex = Number(match[1]);
  const sectionName = sectionNames[sectionIndex];
  const appPart =
    match[2] === undefined ? "" : ` · ${t("import.path.sectionApp", { index: Number(match[2]) + 1 })}`;
  const sectionPart =
    sectionName === undefined || sectionName === ""
      ? t("import.path.section", { index: sectionIndex + 1 })
      : sectionName;
  return `${sectionPart}${appPart}`;
}
