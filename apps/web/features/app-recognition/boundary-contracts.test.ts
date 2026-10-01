import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Static source contracts for the recognition boundary (task 020-A
 * §51–§52, §50).
 *
 * The repo does not use the `server-only` package anywhere, so the
 * client/server boundary is enforced the way this codebase already
 * enforces conventions: by source contract. These tests fail the build if
 * a client module ever imports the DNS layer, the safe-fetch boundary,
 * the HTML parser or the server recognizer — or if the Add-App client
 * ever fetches anything except VelaDesk's own recognition endpoint — or
 * if a recognized icon is ever rendered from a remote URL.
 */

const CLIENT_SOURCES = [
  "contract.ts",
  "normalize-url.ts",
  "normalize-url.test.ts",
  "smart-add-state.ts",
  "smart-add-state.test.ts",
  "recognition-client.ts",
  "recognition-controller.ts",
  "recognition-controller.test.ts",
  "use-app-recognition.ts",
]
  .map((name) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8"))
  .join("\n");

const ADD_APP_SOURCE = [
  "../home/add-app-dialog.tsx",
  "../home/add-app-icon-picker.tsx",
]
  .map((path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"))
  .join("\n");

describe("server-only boundary (§51)", () => {
  it("client recognition modules never import server-only code", () => {
    for (const forbidden of [
      /from\s+"[^"]*server\/app-recognition\//,
      /from\s+"node:dns/,
      /from\s+"htmlparser2/,
      /import\s[^;]*safe-public-fetch/,
      /import\s[^;]*node-transport/,
      /import\s[^;]*recognize-app-url/,
    ]) {
      expect(CLIENT_SOURCES).not.toMatch(forbidden);
    }
  });

  it("the Add App dialog never imports server-only code", () => {
    for (const forbidden of [
      /from\s+"[^"]*server\//,
      /from\s+"node:dns/,
      /from\s+"htmlparser2/,
    ]) {
      expect(ADD_APP_SOURCE).not.toMatch(forbidden);
    }
  });
});

describe("no client arbitrary fetch (§52)", () => {
  it("the Add App form fetches only the recognition endpoint", () => {
    // The single fetch call site lives in recognition-client.ts and posts
    // to the shared constant — never to a user-provided or detected URL.
    const clientSource = readFileSync(
      fileURLToPath(new URL("./recognition-client.ts", import.meta.url)),
      "utf8"
    );
    expect(clientSource).toMatch(/APP_RECOGNITION_API_PATH/);
    expect(clientSource).not.toMatch(/fetch\(\s*[a-z]+Url/i);
    // The dialog, hook and controller never call fetch themselves.
    expect(ADD_APP_SOURCE).not.toMatch(/\bfetch\(/);
    const hookSource = readFileSync(
      fileURLToPath(new URL("./use-app-recognition.ts", import.meta.url)),
      "utf8"
    );
    expect(hookSource).not.toMatch(/\bfetch\(/);
  });
});

describe("no browser remote image (§50, §21)", () => {
  it("recognized/uploaded icons render only from local data/blob URLs", () => {
    // Previews come from data: URLs (detected bytes) and object URLs
    // (pending uploads) — never from a remote http(s) src, so displaying a
    // recognized icon never contacts the target site.
    for (const forbidden of [
      /src=\{?\s*["`]https?:/,
      /background-image/,
      /url\(\s*["']?https?:/,
    ]) {
      expect(ADD_APP_SOURCE).not.toMatch(forbidden);
    }
    expect(ADD_APP_SOURCE).toMatch(/data:\$\{value\.mimeType\};base64,/);
    expect(ADD_APP_SOURCE).toMatch(/previewUrl/);
  });

  it("the persisted icon for detected bytes is a local asset reference", () => {
    // On Add, detected-image bytes flow through prepareUploadedImage +
    // stageAsset and persist as { kind: "asset", assetId } — never as a
    // remote URL and never as base64 in the workspace.
    expect(ADD_APP_SOURCE).toMatch(/prepareUploadedImage/);
    expect(ADD_APP_SOURCE).toMatch(/stageAsset/);
    expect(ADD_APP_SOURCE).toMatch(/kind: "asset", assetId/);
  });
});
