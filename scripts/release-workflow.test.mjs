import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Static contract tests for .github/workflows/release.yml (task 025 §49).
 * Targeted assertions only — never a YAML snapshot, so the workflow can
 * evolve without test churn while the release invariants stay pinned.
 */

const workflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url)),
  "utf8",
);

describe("release trigger (task 025 §14–§15; dispatch 027-R1)", () => {
  it("triggers on main pushes that touch package.json", () => {
    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\n\s*-\s*main/);
    expect(workflow).toMatch(/paths:\s*\n\s*-\s*package\.json/);
  });

  it("has an input-less workflow_dispatch recovery entry (027-R1 §8)", () => {
    expect(workflow).toMatch(/^\s*workflow_dispatch:\s*$/m);
    // The dispatch entry carries NO inputs — no human-supplied version of
    // any kind reaches the pipeline.
    expect(workflow).not.toMatch(/workflow_dispatch:\s*\n\s+inputs:/);
    for (const forbidden of [/inputs:/, /\brelease_version\b/, /tag_name:/]) {
      expect(workflow).not.toMatch(forbidden);
    }
  });

  it("dispatch decides through the same script in dispatch mode (027-R1 §9)", () => {
    expect(workflow).toMatch(/github\.event_name.*"workflow_dispatch"/);
    expect(workflow).toMatch(/release-version\.mjs \\\n\s+dispatch/);
    // Both protection checks feed the dispatch decision.
    expect(workflow).toMatch(/steps\.exists\.outputs\.tag_exists/);
    expect(workflow).toMatch(/steps\.exists\.outputs\.release_exists/);
  });

  it("normal pushes keep the previous-vs-current comparison (027-R1 §10)", () => {
    expect(workflow).toMatch(/github\.event\.before/);
    expect(workflow).toMatch(/steps\.previous\.outputs\.previous/);
    // Either an existing tag OR an existing release blocks a push release.
    expect(workflow).toMatch(/EITHER_EXISTS/);
  });
});

describe("prepare job (task 025 §16)", () => {
  it("checks out full history and runs the version gate", () => {
    expect(workflow).toMatch(/fetch-depth:\s*0/);
    expect(workflow).toMatch(/pnpm version:check/);
  });

  it("decides through the shared release decision script", () => {
    expect(workflow).toMatch(/scripts\/release-version\.mjs/);
    // The previous-vs-current comparison happens in-workflow (dependency-only
    // package.json edits must not release).
    expect(workflow).toMatch(/github\.event\.before/);
  });

  it("refuses to run when the target tag or release already exists", () => {
    expect(workflow).toMatch(/git ls-remote --tags/);
    expect(workflow).toMatch(/gh release view/);
  });

  it("exports the decision outputs", () => {
    expect(workflow).toMatch(/should_release/);
    expect(workflow).toMatch(/tag/);
    expect(workflow).toMatch(/commit_sha/);
  });
});

describe("gates before any publish (task 025 §20, §42)", () => {
  it("quality runs the full gate and is required", () => {
    expect(workflow).toMatch(/pnpm typecheck/);
    expect(workflow).toMatch(/pnpm lint/);
    expect(workflow).toMatch(/pnpm test:run/);
    expect(workflow).toMatch(/pnpm build/);
    expect(workflow).toMatch(/smoke:standalone/);
  });

  it("platform packages require prepare AND quality", () => {
    expect(workflow).toMatch(/needs:\s*\[prepare,\s*quality\]/);
  });

  it("packages build per-platform on a runner matrix (native better-sqlite3)", () => {
    expect(workflow).toMatch(/windows-latest/);
    expect(workflow).toMatch(/ubuntu-latest/);
    expect(workflow).toMatch(/macos-latest/);
    // The packager's manifest is the single naming rule — no workflow-side
    // platform/arch guessing beyond the runner list.
    expect(workflow).toMatch(/package-release\.mjs/);
    expect(workflow).toMatch(/verify-release-package\.mjs/);
  });

  it("uses the official artifact actions", () => {
    expect(workflow).toMatch(/actions\/upload-artifact@v7/);
    expect(workflow).toMatch(/actions\/download-artifact@v8/);
  });
});

describe("final job (task 025 §40–§43)", () => {
  it("depends on prepare, quality and every platform package", () => {
    expect(workflow).toMatch(/needs:\s*\[prepare,\s*quality,\s*package\]/);
  });

  it("holds the ONLY write permission", () => {
    const permissionBlocks = workflow.match(/permissions:/g) ?? [];
    expect(permissionBlocks.length).toBeGreaterThanOrEqual(2);
    expect(workflow).toMatch(/contents:\s*write/);
    // contents: write appears exactly once (final only).
    expect((workflow.match(/contents:\s*write/g) ?? []).length).toBe(1);
  });

  it("creates the tag/release LAST, formally, from the source version", () => {
    expect(workflow).toMatch(/gh release create/);
    expect(workflow).toMatch(/--target/);
    expect(workflow).toMatch(/--title "VelaDesk \$\{\{ needs\.prepare\.outputs\.tag \}\}"/);
    expect(workflow).toMatch(/--generate-notes/);
    expect(workflow).not.toMatch(/--draft/);
    expect(workflow).not.toMatch(/--prerelease/);
  });

  it("re-verifies the version and tag absence before publishing", () => {
    expect(workflow).toMatch(/root version moved during the release run/);
    expect(workflow).toMatch(/refusing to overwrite/);
  });

  it("ships SHA256SUMS.txt for every archive", () => {
    expect(workflow).toMatch(/SHA256SUMS\.txt/);
    expect(workflow).toMatch(/sha256sum/);
  });
});

describe("node/pnpm discipline (task 025 §23)", () => {
  it("keeps .nvmrc and packageManager as the only version sources", () => {
    expect((workflow.match(/node-version-file:\s*\.nvmrc/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(workflow).toMatch(/pnpm\/action-setup@v6/);
    // No hardcoded second Node version anywhere.
    expect(workflow).not.toMatch(/node-version:\s*\d/);
  });
});
