import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Static source contracts for the JSON import (task 024 §35, §50, §55–§56,
 * §71): the parse/plan/apply pipeline stays PURE (no persistence, no
 * network, no asset staging), the dialog owns exactly ONE staging call
 * inside its confirmed-Import handler, nothing before that handler can
 * write, and imported names never render as HTML.
 */

const PURE_MODULES = [
  "contract.ts",
  "normalization.ts",
  "parser.ts",
  "planner.ts",
  "apply-import.ts",
  "template.ts",
  "ai-prompt.ts",
  "clipboard.ts",
]
  .map((name) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8"))
  .join("\n");

const DIALOG_SOURCE = readFileSync(
  fileURLToPath(new URL("./import-json-dialog.tsx", import.meta.url)),
  "utf8"
);

const SETTINGS_SOURCE = readFileSync(
  fileURLToPath(new URL("../home/settings-center.tsx", import.meta.url)),
  "utf8"
);

describe("import pipeline purity (§35, §71)", () => {
  it("pure modules never import persistence, sync, assets or network", () => {
    for (const forbidden of [
      /from\s+"[^"]*workspace-commit/,
      /from\s+"[^"]*client-runtime/,
      /from\s+"[^"]*local-store/,
      /from\s+"@veladesk\/sync/,
      /from\s+"[^"]*browser-assets/,
      /from\s+"@veladesk\/assets/,
      /\bfetch\(/,
      /\beval\(/,
      /new Function\(/,
    ]) {
      expect(PURE_MODULES).not.toMatch(forbidden);
    }
  });

  it("the dialog stages exactly once, inside the confirmed import handler", () => {
    const handlerIndex = DIALOG_SOURCE.indexOf("async function handleImport");
    expect(handlerIndex).toBeGreaterThan(0);
    const before = DIALOG_SOURCE.slice(0, handlerIndex);
    const handler = DIALOG_SOURCE.slice(handlerIndex);
    expect(before).not.toMatch(/stageWorkspaceAndTrySync\(/);
    expect(handler.match(/stageWorkspaceAndTrySync\(/g)).toHaveLength(1);
    // No arbitrary fetch from the import surface (§55).
    expect(DIALOG_SOURCE).not.toMatch(/\bfetch\(/);
    // Imported content renders as React text only — never dangerouslySetInnerHTML.
    expect(DIALOG_SOURCE).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it("SettingsCenter itself stays persistence-free (the import dialog owns the write)", () => {
    expect(SETTINGS_SOURCE).not.toMatch(/stageWorkspaceAndTrySync/);
    expect(SETTINGS_SOURCE).not.toMatch(/stageWorkspaceUpdate/);
  });
});
