import { describe, expect, it } from "vitest";

import {
  IMPORT_FORMAT_IDENTITY,
  IMPORT_MAX_APPS,
  IMPORT_MAX_JSON_TEXT_LENGTH,
  IMPORT_MAX_SECTIONS,
} from "./contract";
import { parseImportDocument } from "./parser";

function sectionJson(name: string, apps: readonly unknown[]): unknown {
  return { name, apps };
}

function appJson(name: string, url: string): unknown {
  return { name, url };
}

function validDocumentJson(): string {
  return JSON.stringify({
    format: "veladesk-import",
    version: 1,
    sections: [
      sectionJson("办公", [appJson("GitHub", "https://github.com/")]),
      sectionJson("AI", [appJson("ChatGPT", "https://chatgpt.com/")]),
    ],
  });
}

function issueCodes(issues: readonly { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}

describe("parseImportDocument: valid documents", () => {
  it("parses a valid minimal document with no issues", () => {
    const result = parseImportDocument(validDocumentJson());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.document.format).toBe(IMPORT_FORMAT_IDENTITY);
      expect(result.parsed.document.version).toBe(1);
      expect(result.parsed.document.sections).toHaveLength(2);
      expect(result.parsed.document.sections[0]?.name).toBe("办公");
      expect(result.parsed.document.sections[0]?.apps[0]?.url).toBe("https://github.com/");
      expect(result.parsed.issues).toEqual([]);
    }
  });

  it("accepts icon omitted and icon auto equivalently", () => {
    const noIcon = parseImportDocument(
      JSON.stringify({ format: "veladesk-import", version: 1, sections: [{ name: "S", apps: [{ name: "A", url: "https://a.test/" }] }] })
    );
    const autoIcon = parseImportDocument(
      JSON.stringify({ format: "veladesk-import", version: 1, sections: [{ name: "S", apps: [{ name: "A", url: "https://a.test/", icon: "auto" }] }] })
    );
    expect(noIcon.ok).toBe(true);
    expect(autoIcon.ok).toBe(true);
  });

  it("normalizes display names (trim + whitespace collapse) without lowercasing", () => {
    const result = parseImportDocument(
      JSON.stringify({
        format: "veladesk-import",
        version: 1,
        sections: [{ name: "  AI  Tools ", apps: [{ name: "  GitHub  ", url: "https://github.com/" }] }],
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.document.sections[0]?.name).toBe("AI Tools");
      expect(result.parsed.document.sections[0]?.apps[0]?.name).toBe("GitHub");
    }
  });

  it("stores recognizable URLs in the Add App normalized form", () => {
    const result = parseImportDocument(
      JSON.stringify({
        format: "veladesk-import",
        version: 1,
        sections: [{ name: "S", apps: [{ name: "GitHub", url: "github.com" }] }],
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.document.sections[0]?.apps[0]?.url).toBe("https://github.com/");
    }
  });

  it("keeps custom-protocol URLs verbatim (trimmed) like Add App", () => {
    const result = parseImportDocument(
      JSON.stringify({
        format: "veladesk-import",
        version: 1,
        sections: [{ name: "S", apps: [{ name: "Obsidian", url: " obsidian://vault/notes " }] }],
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.document.sections[0]?.apps[0]?.url).toBe("obsidian://vault/notes");
    }
  });

  it("accepts intranet and localhost URLs the recognition gate rejects", () => {
    const result = parseImportDocument(
      JSON.stringify({
        format: "veladesk-import",
        version: 1,
        sections: [
          {
            name: "内部",
            apps: [
              { name: "Wiki", url: "http://wiki.internal/" },
              { name: "Dev", url: "http://localhost:3000/" },
            ],
          },
        ],
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.document.sections[0]?.apps[0]?.url).toBe("http://wiki.internal/");
      expect(result.parsed.document.sections[0]?.apps[1]?.url).toBe("http://localhost:3000/");
    }
  });
});

describe("parseImportDocument: JSON and root errors", () => {
  it("rejects malformed JSON with INVALID_JSON", () => {
    const result = parseImportDocument("{ not json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issueCodes(result.issues)).toContain("INVALID_JSON");
    }
  });

  it("rejects a root array with INVALID_ROOT", () => {
    const result = parseImportDocument("[]");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issueCodes(result.issues)).toContain("INVALID_ROOT");
    }
  });

  it("rejects non-object roots (string, number, boolean, null)", () => {
    for (const text of ['"x"', "1", "true", "null"]) {
      const result = parseImportDocument(text);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(issueCodes(result.issues)).toContain("INVALID_ROOT");
      }
    }
  });

  it("rejects text above the import size cap before schema work", () => {
    const result = parseImportDocument(" ".repeat(IMPORT_MAX_JSON_TEXT_LENGTH + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issueCodes(result.issues)).toContain("FILE_TOO_LARGE");
    }
  });
});

describe("parseImportDocument: format identity", () => {
  it("rejects a wrong format field", () => {
    const result = parseImportDocument(JSON.stringify({ format: "something-else", version: 1, sections: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((candidate) => candidate.code === "INVALID_FORMAT");
      expect(issue).toBeDefined();
      expect(issue?.path).toBe("format");
    }
  });

  it("rejects a missing version", () => {
    const result = parseImportDocument(JSON.stringify({ format: "veladesk-import", sections: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issueCodes(result.issues)).toContain("UNSUPPORTED_VERSION");
    }
  });

  it("rejects version 2 without best-effort parsing", () => {
    const result = parseImportDocument(
      JSON.stringify({ format: "veladesk-import", version: 2, sections: [{ name: "S", apps: [] }] })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issueCodes(result.issues)).toContain("UNSUPPORTED_VERSION");
    }
  });
});

describe("parseImportDocument: sections", () => {
  it("rejects missing sections", () => {
    const result = parseImportDocument(JSON.stringify({ format: "veladesk-import", version: 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issueCodes(result.issues)).toContain("MISSING_SECTIONS");
    }
  });

  it("rejects a non-array sections value", () => {
    const result = parseImportDocument(
      JSON.stringify({ format: "veladesk-import", version: 1, sections: "nope" })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issueCodes(result.issues)).toContain("INVALID_SECTIONS");
    }
  });

  it("rejects a missing section name with a section path", () => {
    const result = parseImportDocument(
      JSON.stringify({ format: "veladesk-import", version: 1, sections: [{ apps: [] }] })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((candidate) => candidate.code === "MISSING_SECTION_NAME");
      expect(issue).toBeDefined();
      expect(issue?.path).toBe("sections[0].name");
    }
  });

  it("rejects a blank section name", () => {
    const result = parseImportDocument(
      JSON.stringify({ format: "veladesk-import", version: 1, sections: [{ name: "   ", apps: [] }] })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issueCodes(result.issues)).toContain("INVALID_SECTION_NAME");
    }
  });

  it("rejects a section name longer than the section dialog limit", () => {
    const result = parseImportDocument(
      JSON.stringify({
        format: "veladesk-import",
        version: 1,
        sections: [{ name: "x".repeat(81), apps: [] }],
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issueCodes(result.issues)).toContain("INVALID_SECTION_NAME");
    }
  });

  it("rejects missing and non-array apps", () => {
    const missing = parseImportDocument(
      JSON.stringify({ format: "veladesk-import", version: 1, sections: [{ name: "S" }] })
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(issueCodes(missing.issues)).toContain("MISSING_APPS");
    }
    const notArray = parseImportDocument(
      JSON.stringify({ format: "veladesk-import", version: 1, sections: [{ name: "S", apps: {} }] })
    );
    expect(notArray.ok).toBe(false);
    if (!notArray.ok) {
      expect(issueCodes(notArray.issues)).toContain("INVALID_APPS");
    }
  });
});

describe("parseImportDocument: apps", () => {
  function documentWithApp(app: unknown): string {
    return JSON.stringify({ format: "veladesk-import", version: 1, sections: [{ name: "S", apps: [app] }] });
  }

  it("rejects a missing app name", () => {
    const result = parseImportDocument(documentWithApp({ url: "https://a.test/" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((candidate) => candidate.code === "MISSING_APP_NAME");
      expect(issue).toBeDefined();
      expect(issue?.path).toBe("sections[0].apps[0].name");
    }
  });

  it("rejects a blank app name", () => {
    const result = parseImportDocument(documentWithApp({ name: "  ", url: "https://a.test/" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issueCodes(result.issues)).toContain("INVALID_APP_NAME");
    }
  });

  it("rejects an app name longer than the Add App limit", () => {
    const result = parseImportDocument(documentWithApp({ name: "x".repeat(81), url: "https://a.test/" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issueCodes(result.issues)).toContain("INVALID_APP_NAME");
    }
  });

  it("rejects a missing app url", () => {
    const result = parseImportDocument(documentWithApp({ name: "A" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((candidate) => candidate.code === "MISSING_APP_URL");
      expect(issue).toBeDefined();
      expect(issue?.path).toBe("sections[0].apps[0].url");
    }
  });

  it("rejects a blank url as invalid", () => {
    const result = parseImportDocument(documentWithApp({ name: "A", url: "   " }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issueCodes(result.issues)).toContain("INVALID_APP_URL");
    }
  });

  it("rejects an url longer than the Add App limit as invalid", () => {
    const result = parseImportDocument(documentWithApp({ name: "A", url: `https://a.test/${"x".repeat(2100)}` }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issueCodes(result.issues)).toContain("INVALID_APP_URL");
    }
  });

  it("rejects unsupported icon values (brand name, URL, base64, object)", () => {
    for (const icon of ["github", "https://example.com/logo.png", "data:image/png;base64,AAAA", { kind: "asset" }, 1]) {
      const result = parseImportDocument(documentWithApp({ name: "A", url: "https://a.test/", icon }));
      expect(result.ok, `icon=${JSON.stringify(icon)}`).toBe(false);
      if (!result.ok) {
        const issue = result.issues.find((candidate) => candidate.code === "INVALID_ICON");
        expect(issue).toBeDefined();
        expect(issue?.path).toBe("sections[0].apps[0].icon");
      }
    }
  });

  it("warns about (and ignores) internal fields an AI must never provide", () => {
    // Task 024 §12/§13: icon VALUES are schema errors, but unknown extra
    // properties — including tempting internal ones like assetId/id/position
    // — are visible warnings, never silently honored and never fatal.
    for (const extra of [{ assetId: "asset-sha256-00" }, { id: "app-1" }, { position: { x: 0, y: 0 } }]) {
      const result = parseImportDocument(
        documentWithApp({ name: "A", url: "https://a.test/", icon: "auto", ...extra })
      );
      expect(result.ok, `extra=${JSON.stringify(extra)}`).toBe(true);
      if (result.ok) {
        const codes = issueCodes(result.parsed.issues);
        expect(codes).toContain("UNSUPPORTED_FIELD_IGNORED");
        expect(codes).not.toContain("INVALID_ICON");
        const app = result.parsed.document.sections[0]?.apps[0];
        expect(app && "id" in app).toBe(false);
        expect(app && "assetId" in app).toBe(false);
        expect(app && "position" in app).toBe(false);
      }
    }
  });
});

describe("parseImportDocument: unknown fields and prototype safety", () => {
  it("warns (does not fail) about an unknown top-level field", () => {
    const result = parseImportDocument(
      JSON.stringify({ format: "veladesk-import", version: 1, generatedBy: "ai", sections: [] })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issue = result.parsed.issues.find((candidate) => candidate.code === "UNSUPPORTED_FIELD_IGNORED");
      expect(issue).toBeDefined();
      expect(issue?.path).toBe("generatedBy");
      expect(issue?.severity).toBe("warning");
    }
  });

  it("warns about an unknown app field with the exact app path", () => {
    const result = parseImportDocument(
      JSON.stringify({
        format: "veladesk-import",
        version: 1,
        sections: [
          { name: "办公", apps: [] },
          { name: "AI", apps: [{ name: "A", url: "https://a.test/", description: "extra" }] },
        ],
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issue = result.parsed.issues.find((candidate) => candidate.code === "UNSUPPORTED_FIELD_IGNORED");
      expect(issue).toBeDefined();
      expect(issue?.path).toBe("sections[1].apps[0].description");
    }
  });

  it("treats a typo'd required field as an error, not an unknown field", () => {
    const result = parseImportDocument(
      JSON.stringify({
        format: "veladesk-import",
        version: 1,
        sections: [{ name: "S", apps: [{ name: "A", urls: "https://a.test/" }] }],
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issueCodes(result.issues)).toContain("MISSING_APP_URL");
    }
  });

  it("keeps prototype-looking JSON properties harmless warnings", () => {
    // Built as a raw string: a JS object literal would not create an own
    // `__proto__` property, but JSON.parse does — that is the case to cover.
    const result = parseImportDocument(
      '{"format":"veladesk-import","version":1,"sections":[{"name":"S","apps":[{"name":"A","url":"https://a.test/"}],"__proto__":"x","constructor":"y","prototype":"z"}]}'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const codes = issueCodes(result.parsed.issues);
      expect(codes.filter((code) => code === "UNSUPPORTED_FIELD_IGNORED")).toHaveLength(3);
      // The parsed section keeps ONLY known fields — no prototype pollution.
      const section = result.parsed.document.sections[0];
      expect(section && Object.keys(section).sort()).toEqual(["apps", "name"]);
    }
  });
});

describe("parseImportDocument: scale limits", () => {
  it("rejects more than the maximum sections", () => {
    const sections = Array.from({ length: IMPORT_MAX_SECTIONS + 1 }, (_unused, index) => ({
      name: `S${index}`,
      apps: [],
    }));
    const result = parseImportDocument(
      JSON.stringify({ format: "veladesk-import", version: 1, sections })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issueCodes(result.issues)).toContain("TOO_MANY_SECTIONS");
    }
  });

  it("rejects more than the maximum total apps", () => {
    const apps = Array.from({ length: IMPORT_MAX_APPS + 1 }, (_unused, index) => ({
      name: `A${index}`,
      url: `https://a${index}.test/`,
    }));
    const result = parseImportDocument(
      JSON.stringify({ format: "veladesk-import", version: 1, sections: [{ name: "S", apps }] })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issueCodes(result.issues)).toContain("TOO_MANY_APPS");
    }
  });
});
