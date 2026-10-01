/**
 * The canonical VelaDesk Import JSON v1 template (task 024 §4).
 *
 * This constant is the single source of truth for the downloadable file —
 * docs and tests must match it, never drift from it.
 */

import type { VelaDeskImportDocumentV1 } from "./contract";

export const VELA_IMPORT_TEMPLATE_V1: VelaDeskImportDocumentV1 = {
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
      apps: [
        { name: "ChatGPT", url: "https://chatgpt.com/", icon: "auto" },
      ],
    },
  ],
};

export const IMPORT_TEMPLATE_FILENAME = "veladesk-import-v1.json";

export const IMPORT_TEMPLATE_BLOB_TYPE = "application/json;charset=utf-8";

/**
 * Client-only helper: downloads the canonical template as a UTF-8 JSON
 * file through a temporary object URL. No workspace write.
 */
export function downloadVelaDeskImportTemplate(): void {
  const blob = new Blob([JSON.stringify(VELA_IMPORT_TEMPLATE_V1, null, 2)], {
    type: IMPORT_TEMPLATE_BLOB_TYPE,
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = IMPORT_TEMPLATE_FILENAME;
  anchor.rel = "noopener";
  anchor.click();
  URL.revokeObjectURL(url);
}
