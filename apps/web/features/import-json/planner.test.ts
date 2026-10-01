import { describe, expect, it } from "vitest";

import type { ImportIssue, VelaDeskImportDocumentV1 } from "./contract";
import { parseImportDocument } from "./parser";
import { planImport, plansMateriallyEqual } from "./planner";
import { addApp, addSection, makeTestIdFactory, officeWorkspace } from "./fixtures";

function documentOf(
  sections: { name: string; apps: { name: string; url: string }[] }[]
): VelaDeskImportDocumentV1 {
  return { format: "veladesk-import", version: 1, sections };
}

function parsedOf(text: string): { document: VelaDeskImportDocumentV1; warnings: readonly ImportIssue[] } {
  const result = parseImportDocument(text);
  if (!result.ok) {
    throw new Error(`fixture parse failed: ${result.issues.map((issue) => issue.code).join(",")}`);
  }
  return { document: result.parsed.document, warnings: result.parsed.issues };
}

describe("planImport: section actions", () => {
  it("merges into an exactly-one existing canonical-name section", () => {
    const { workspace, officePageId } = officeWorkspace();
    const document = documentOf([
      {
        name: "Office",
        apps: [
          { name: "GitHub", url: "https://github.com/" },
          { name: "Notion", url: "https://www.notion.so/" },
        ],
      },
    ]);
    const plan = planImport(workspace, document);
    expect(plan.sections).toHaveLength(1);
    expect(plan.sections[0]?.action).toBe("merge");
    expect(plan.sections[0]?.targetPageId).toBe(officePageId);
    expect(plan.summary.mergeSections).toBe(1);
    expect(plan.summary.createSections).toBe(0);
  });

  it("creates a section with no existing canonical-name match", () => {
    const { workspace } = officeWorkspace();
    const document = documentOf([{ name: "AI", apps: [{ name: "ChatGPT", url: "https://chatgpt.com/" }] }]);
    const plan = planImport(workspace, document);
    expect(plan.sections[0]?.action).toBe("create");
    expect(plan.sections[0]?.targetPageId).toBeNull();
    expect(plan.summary.createSections).toBe(1);
  });

  it("creates an empty new section (organizational structure first)", () => {
    const { workspace } = officeWorkspace();
    const document = documentOf([{ name: "以后整理", apps: [] }]);
    const plan = planImport(workspace, document);
    expect(plan.sections[0]?.action).toBe("create");
    expect(plan.sections[0]?.apps).toEqual([]);
    expect(plan.summary.createSections).toBe(1);
    expect(plan.summary.inputApps).toBe(0);
  });

  it("merges duplicate sections inside the document (first display name wins)", () => {
    const { workspace } = officeWorkspace();
    const document = documentOf([
      { name: "AI", apps: [{ name: "ChatGPT", url: "https://chatgpt.com/" }] },
      { name: " ai ", apps: [{ name: "Claude", url: "https://claude.ai/" }] },
    ]);
    const plan = planImport(workspace, document);
    expect(plan.sections).toHaveLength(1);
    expect(plan.sections[0]?.displayName).toBe("AI");
    expect(plan.sections[0]?.apps.map((app) => app.name)).toEqual(["ChatGPT", "Claude"]);
    const duplicateWarning = plan.warnings.find((issue) => issue.code === "DUPLICATE_IMPORT_SECTION");
    expect(duplicateWarning).toBeDefined();
    expect(duplicateWarning?.path).toBe("sections[1]");
  });

  it("blocks with AMBIGUOUS_EXISTING_SECTION when two existing sections share the name key", () => {
    const { workspace } = officeWorkspace();
    const ambiguous = addSection(workspace, "page-office-2", " office ");
    const document = documentOf([{ name: "Office", apps: [{ name: "Notion", url: "https://www.notion.so/" }] }]);
    const plan = planImport(ambiguous, document);
    const error = plan.errors.find((issue) => issue.code === "AMBIGUOUS_EXISTING_SECTION");
    expect(error).toBeDefined();
    expect(error?.path).toBe("sections[0]");
    // The planner refuses to choose: the merge target stays unresolved and
    // the blocking error disables the plan (never applied).
    expect(plan.sections[0]?.action).toBe("merge");
    expect(plan.sections[0]?.targetPageId).toBeNull();
  });
});

describe("planImport: app actions", () => {
  it("skips an app whose URL already exists anywhere in the workspace", () => {
    const { workspace } = officeWorkspace();
    const document = documentOf([{ name: "AI", apps: [{ name: "GitHub", url: "https://github.com" }] }]);
    const plan = planImport(workspace, document);
    expect(plan.sections[0]?.apps[0]?.action).toBe("skip-duplicate");
    const warning = plan.warnings.find((issue) => issue.code === "DUPLICATE_WORKSPACE_APP");
    expect(warning).toBeDefined();
    expect(warning?.value).toBe("GitHub · Office");
    expect(plan.summary.duplicateApps).toBe(1);
    expect(plan.summary.createApps).toBe(0);
  });

  it("treats root-slash and fragment variants of an existing URL as duplicates", () => {
    const { workspace } = officeWorkspace();
    const document = documentOf([{ name: "AI", apps: [{ name: "GitHub Docs", url: "https://github.com/#top" }] }]);
    const plan = planImport(workspace, document);
    expect(plan.sections[0]?.apps[0]?.action).toBe("skip-duplicate");
  });

  it("keeps the first occurrence of a duplicate URL inside the import", () => {
    const { workspace } = officeWorkspace();
    const document = documentOf([
      { name: "One", apps: [{ name: "ChatGPT", url: "https://chatgpt.com/" }] },
      { name: "Two", apps: [{ name: "ChatGPT", url: "https://chatgpt.com/" }] },
    ]);
    const plan = planImport(workspace, document);
    expect(plan.sections[0]?.apps[0]?.action).toBe("create");
    expect(plan.sections[1]?.apps[0]?.action).toBe("skip-duplicate");
    const warning = plan.warnings.find((issue) => issue.code === "DUPLICATE_IMPORT_APP");
    expect(warning?.path).toBe("sections[1].apps[0]");
    expect(plan.summary.duplicateApps).toBe(1);
  });

  it("creates same-name apps with different URLs as distinct applications", () => {
    const { workspace } = officeWorkspace();
    const document = documentOf([
      {
        name: "Dev",
        apps: [
          { name: "Example", url: "https://example.com/" },
          { name: "Example", url: "https://example.com/team/" },
        ],
      },
    ]);
    const plan = planImport(workspace, document);
    expect(plan.sections[0]?.apps.every((app) => app.action === "create")).toBe(true);
    expect(plan.summary.createApps).toBe(2);
  });

  it("produces a no-op summary when everything is already present", () => {
    const { workspace } = officeWorkspace();
    const document = documentOf([{ name: "Office", apps: [{ name: "GitHub", url: "https://github.com/" }] }]);
    const plan = planImport(workspace, document);
    expect(plan.summary).toEqual({
      inputSections: 1,
      createSections: 0,
      mergeSections: 1,
      inputApps: 1,
      createApps: 0,
      duplicateApps: 1,
      warningCount: 1,
    });
  });

  it("indexes existing apps across every section of the workspace", () => {
    const { workspace } = officeWorkspace();
    const withSecond = addSection(
      addApp(workspace, "page-office", "app-wiki", "Wiki", "http://wiki.internal/"),
      "page-tools",
      "Tools"
    );
    const document = documentOf([{ name: "AI", apps: [{ name: "Internal Wiki", url: "http://wiki.internal/" }] }]);
    const plan = planImport(withSecond, document);
    expect(plan.sections[0]?.apps[0]?.action).toBe("skip-duplicate");
    expect(plan.warnings.find((issue) => issue.code === "DUPLICATE_WORKSPACE_APP")?.value).toBe("Wiki · Office");
  });
});

describe("planImport: determinism and material change", () => {
  it("produces materially equal plans for the same snapshot and document", () => {
    const { workspace } = officeWorkspace();
    const document = documentOf([
      { name: "Office", apps: [{ name: "Notion", url: "https://www.notion.so/" }] },
      { name: "AI", apps: [{ name: "ChatGPT", url: "https://chatgpt.com/" }] },
    ]);
    const first = planImport(workspace, document);
    const second = planImport(workspace, document);
    expect(plansMateriallyEqual(first, second)).toBe(true);
    expect(first.summary).toEqual(second.summary);
  });

  it("detects a new duplicate discovered between preview and confirm", () => {
    const { workspace } = officeWorkspace();
    const document = documentOf([{ name: "AI", apps: [{ name: "ChatGPT", url: "https://chatgpt.com/" }] }]);
    const previewed = planImport(workspace, document);
    const changed = addApp(workspace, "page-office", "app-chatgpt", "ChatGPT", "https://chatgpt.com/");
    const replanned = planImport(changed, document);
    expect(plansMateriallyEqual(previewed, replanned)).toBe(false);
  });

  it("detects a create flipping to a merge", () => {
    const { workspace } = officeWorkspace();
    const document = documentOf([{ name: "AI", apps: [{ name: "ChatGPT", url: "https://chatgpt.com/" }] }]);
    const previewed = planImport(workspace, document);
    const replanned = planImport(addSection(workspace, "page-ai", "AI"), document);
    expect(plansMateriallyEqual(previewed, replanned)).toBe(false);
  });

  it("treats semantically unchanged replans as equal across snapshot references", () => {
    const { workspace } = officeWorkspace();
    const document = documentOf([{ name: "AI", apps: [{ name: "ChatGPT", url: "https://chatgpt.com/" }] }]);
    const previewed = planImport(workspace, document);
    // An unrelated section appeared, but the import semantics for THIS
    // document are unchanged.
    const replanned = planImport(addSection(workspace, "page-unused", "Unused"), document);
    expect(plansMateriallyEqual(previewed, replanned)).toBe(true);
  });
});

describe("planImport: parser warning pass-through", () => {
  it("carries UNSUPPORTED_FIELD_IGNORED warnings into the plan summary", () => {
    const { workspace } = officeWorkspace();
    const { document, warnings } = parsedOf(
      JSON.stringify({
        format: "veladesk-import",
        version: 1,
        note: "extra",
        sections: [{ name: "AI", apps: [{ name: "ChatGPT", url: "https://chatgpt.com/", description: "x" }] }],
      })
    );
    const plan = planImport(workspace, document, warnings);
    expect(plan.warnings.filter((issue) => issue.code === "UNSUPPORTED_FIELD_IGNORED")).toHaveLength(2);
    expect(plan.summary.warningCount).toBe(2);
  });
});

describe("makeTestIdFactory (fixture sanity)", () => {
  it("emits distinct deterministic ids per kind", () => {
    const factory = makeTestIdFactory();
    expect(factory("page")).toBe("page-1");
    expect(factory("page")).toBe("page-2");
    expect(factory("app")).toBe("app-1");
  });
});
