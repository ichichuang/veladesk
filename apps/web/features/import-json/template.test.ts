// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { IMPORT_FORMAT_IDENTITY } from "./contract";
import {
  downloadVelaDeskImportTemplate,
  IMPORT_TEMPLATE_BLOB_TYPE,
  IMPORT_TEMPLATE_FILENAME,
  VELA_IMPORT_TEMPLATE_V1,
} from "./template";

const CANONICAL_TEMPLATE_JSON = JSON.stringify(
  {
    format: "veladesk-import",
    version: 1,
    sections: [
      {
        name: "办公",
        apps: [
          { name: "GitHub", url: "https://github.com/", icon: "auto" },
          { name: "Notion", url: "https://www.notion.so/", icon: "auto" },
        ],
      },
      {
        name: "AI",
        apps: [{ name: "ChatGPT", url: "https://chatgpt.com/", icon: "auto" }],
      },
    ],
  },
  null,
  2
);

describe("VELA_IMPORT_TEMPLATE_V1", () => {
  it("is the exact canonical v1 template", () => {
    expect(JSON.stringify(VELA_IMPORT_TEMPLATE_V1, null, 2)).toBe(CANONICAL_TEMPLATE_JSON);
    expect(VELA_IMPORT_TEMPLATE_V1.format).toBe(IMPORT_FORMAT_IDENTITY);
    expect(VELA_IMPORT_TEMPLATE_V1.version).toBe(1);
  });

  it("round-trips through JSON.stringify/parse unchanged", () => {
    expect(JSON.parse(JSON.stringify(VELA_IMPORT_TEMPLATE_V1))).toEqual(VELA_IMPORT_TEMPLATE_V1);
  });

  it("matches the architecture document (docs must never drift)", () => {
    const docsPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../docs/architecture/import-json-v1.md"
    );
    const docs = readFileSync(docsPath, "utf8");
    expect(docs).toContain(CANONICAL_TEMPLATE_JSON);
    expect(docs).toContain("veladesk-import-v1.json");
  });
});

describe("downloadVelaDeskImportTemplate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads the canonical template file and revokes the object URL", async () => {
    const createdUrls: string[] = [];
    const revokedUrls: string[] = [];
    const clicks: { href: string; download: string }[] = [];
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const url = `blob:template-${createdUrls.length + 1}`;
      createdUrls.push(url);
      return url;
    });
    vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation((url: string) => {
        revokedUrls.push(url);
      });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download });
    });

    downloadVelaDeskImportTemplate();

    expect(createdUrls).toHaveLength(1);
    expect(clicks).toHaveLength(1);
    expect(clicks[0]?.download).toBe(IMPORT_TEMPLATE_FILENAME);
    expect(IMPORT_TEMPLATE_FILENAME).toBe("veladesk-import-v1.json");
    expect(clicks[0]?.href).toBe(createdUrls[0]);
    expect(revokedUrls).toEqual(createdUrls);

    // The blob carries the canonical bytes and the UTF-8 JSON media type.
    const blob = createObjectUrl.mock.calls[0]?.[0] as Blob | undefined;
    expect(blob).toBeDefined();
    expect(blob?.type).toBe(IMPORT_TEMPLATE_BLOB_TYPE);
    expect(await readBlobText(blob)).toBe(JSON.stringify(VELA_IMPORT_TEMPLATE_V1, null, 2));
  });
});

/** jsdom's Blob lacks `.text()`; fall back to FileReader. */
async function readBlobText(blob: Blob | undefined): Promise<string> {
  if (blob === undefined) {
    throw new Error("expected a blob");
  }
  if (typeof blob.text === "function") {
    return blob.text();
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(blob);
  });
}
