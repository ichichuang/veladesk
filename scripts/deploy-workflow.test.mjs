import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Static contract tests for the production deploy path (deploy task):
 *   - .github/workflows/ci.yml deploy job — targeted assertions only,
 *     never a YAML snapshot, mirroring release-workflow.test.mjs.
 *   - scripts/deploy-racknerd.sh — syntax check + the script's own
 *     identifier-validation self-test.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

const workflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/ci.yml", import.meta.url)),
  "utf8",
);

const script = readFileSync(
  fileURLToPath(new URL("./deploy-racknerd.sh", import.meta.url)),
  "utf8",
);

const releaseWorkflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url)),
  "utf8",
);

describe("CI deploy trigger (deploy task §2; tag channel)", () => {
  it("supports an input-less workflow_dispatch through the same quality job", () => {
    expect(workflow).toMatch(/^\s*workflow_dispatch:\s*$/m);
    expect(workflow).not.toMatch(/workflow_dispatch:\s*\n\s+inputs:/);
  });

  it("no tag-push trigger — the release handoff dispatches explicitly (no double deploys)", () => {
    expect(workflow).toMatch(/push:\s*\n\s+branches: \[main\]/);
    expect(workflow).not.toMatch(/tags: \["v\*"\]/);
  });

  it("no workflow-level concurrency may cancel an active deploy", () => {
    // The concurrency block moved to job level; only quality keeps
    // cancel-in-progress.
    const beforeJobs = workflow.split("jobs:")[0] ?? "";
    const jobsSection = workflow.split("jobs:")[1] ?? "";
    expect(beforeJobs).not.toMatch(/concurrency:/);
    expect(jobsSection).toMatch(
      /quality:\s*\n\s+concurrency:\s*\n\s+group: ci-quality-\$\{\{ github\.ref \}\}\s*\n\s+cancel-in-progress: true/,
    );
  });

  it("the deploy job serializes production and is never cancelled", () => {
    expect(workflow).toMatch(/group: veladesk-deploy-production/);
    const deployJob = workflow.split("  deploy:")[1] ?? "";
    expect(deployJob).toMatch(/cancel-in-progress: false/);
  });
});

describe("CI deploy job invariants (deploy task §2–§4)", () => {
  const deployJob = workflow.split("  deploy:")[1] ?? "";

  it("gates on quality; only main pushes and v* tags reach production", () => {
    expect(workflow).toMatch(
      /deploy:\s*\n\s+name: deploy \(racknerd\)\s*\n\s+needs: quality/,
    );
    expect(deployJob).toMatch(
      /if: >-\s*\n\s*github\.event_name != 'pull_request' &&\s*\n\s*\(github\.ref == 'refs\/heads\/main' \|\| startsWith\(github\.ref, 'refs\/tags\/v'\)\)/,
    );
    expect(deployJob).toMatch(/environment: production-racknerd/);
  });

  it("checks out the exact validated SHA, never a moving ref", () => {
    expect(deployJob).toMatch(/ref: \$\{\{ github\.sha \}\}/);
    expect(deployJob).not.toMatch(/ref: main\b/);
  });

  it("release tags deploy unconditionally; main pushes need the variable", () => {
    // Step-level gate (environment-scoped vars are not reliable in job-if).
    expect(deployJob).toMatch(/Auto-deploy gate/);
    expect(deployJob).toMatch(/\[\[ "\$GITHUB_REF" == refs\/tags\/v\* \]\]/);
    expect(deployJob).toMatch(/"workflow_dispatch"/);
    expect(deployJob).toMatch(
      /\{ \[ "\$\{GITHUB_EVENT_NAME\}" = "push" \] && \[ "\$VELADESK_AUTO_DEPLOY" = "true" \]; \}/,
    );
    // Every production-touching step sits behind the gate output.
    const steps = deployJob.split("\n      - name:").slice(1);
    expect(steps.length).toBeGreaterThan(5);
    for (const step of steps) {
      if (/Auto-deploy gate/.test(step)) continue;
      expect(step).toMatch(/steps\.gate\.outputs\.run == 'true'/);
    }
  });

  it("uses the pinned host key with strict host checking", () => {
    expect(deployJob).toMatch(/StrictHostKeyChecking yes/);
    expect(deployJob).toMatch(/secrets\.VELADESK_SSH_KNOWN_HOSTS/);
    expect(deployJob).not.toMatch(/StrictHostKeyChecking accept-new/);
  });

  it("fails on host deploy-script drift before doing anything", () => {
    expect(deployJob).toMatch(/host deploy script drifted/);
    expect(deployJob).toMatch(/sha256sum scripts\/deploy-racknerd\.sh/);
  });

  it("invokes exactly one sudo entry with validated identifiers only", () => {
    expect(deployJob).toMatch(
      /sudo -n \/usr\/local\/sbin\/veladesk-deploy\.sh --commit '\$\{SHA\}' --sha256 '\$\{sha256\}' --run-id '\$\{GITHUB_RUN_ID\}'/,
    );
    expect(deployJob.match(/sudo -n/g)?.length).toBe(1);
  });

  it("verifies the server-side release identity and the public HTTPS site", () => {
    expect(deployJob).toMatch(/cat \/opt\/veladesk\/current\/COMMIT/);
    expect(deployJob).toMatch(/public HTTPS site/);
    expect(deployJob).toMatch(/api\/v1\/workspaces/);
  });
});

describe("release.yml → ci.yml handoff (deploy task v3)", () => {
  const dispatchJob = releaseWorkflow.split("  dispatch-deploy:")[1] ?? "";

  it("dispatches CI on the release tag only after the release published", () => {
    expect(releaseWorkflow).toMatch(/dispatch-deploy:\s*\n\s+name: dispatch CI deploy on the release tag/);
    expect(releaseWorkflow).toMatch(/needs: \[prepare, final\]/);
    expect(dispatchJob).toMatch(/if: needs\.prepare\.outputs\.should_release == 'true'/);
  });

  it("scopes the Actions permission to the dispatch job with the built-in token", () => {
    expect(dispatchJob).toMatch(/permissions:\s*\n\s+# Job-scoped[^\n]*\n\s+contents: read\s*\n\s+actions: write/);
    expect(dispatchJob).toMatch(/GH_TOKEN: \$\{\{ github\.token \}\}/);
    // No personal access token anywhere in the handoff.
    expect(dispatchJob).not.toMatch(/secrets\.[A-Z_]*TOKEN|ghp_/);
  });

  it("dispatches on the tag, never on main", () => {
    expect(dispatchJob).toMatch(/gh workflow run ci\.yml --repo "\$\{\{ github\.repository \}\}" --ref "\$TAG"/);
    expect(dispatchJob).not.toMatch(/--ref main\b/);
  });

  it("resolves the fresh tag back to the validated release SHA before dispatching", () => {
    expect(dispatchJob).toMatch(/git rev-parse "\$TAG\^\{commit\}"/);
    expect(dispatchJob).toMatch(/RELEASE_SHA: \$\{\{ needs\.prepare\.outputs\.commit_sha \}\}/);
    expect(dispatchJob).toMatch(/does not resolve to the SHA the release pipeline validated/);
  });

  it("confirms the dispatched run registered (bounded)", () => {
    expect(dispatchJob).toMatch(/--event workflow_dispatch/);
    expect(dispatchJob).toMatch(/headBranch == env\.TAG/);
    expect(dispatchJob).toMatch(/did not register within 120s/);
  });
});

describe("scripts/deploy-racknerd.sh (deploy task §3–§4)", () => {
  it("parses cleanly under bash", () => {
    execFileSync("bash", ["-n", `${here}deploy-racknerd.sh`]);
  });

  it("passes its own identifier-validation self-test", () => {
    const out = execFileSync("bash", [
      `${here}deploy-racknerd.sh`,
      "--self-test",
    ]).toString();
    expect(out).toMatch(/all checks passed/);
    expect(out).not.toMatch(/FAIL:/);
  });

  it("accepts only validated release identifiers — no paths or commands", () => {
    for (const validator of ["is_commit", "is_sha256", "is_run_id", "is_bundle_dir"]) {
      expect(script).toMatch(new RegExp(`${validator}\\(\\) \\{`));
    }
    expect(script).toMatch(/unknown argument/);
    // The tarball path is derived from the commit, never taken from argv.
    expect(script).toMatch(/TARBALL="\$UPLOAD_DIR\/veladesk-\$COMMIT\.tar\.gz"/);
  });

  it("enforces the rollback rules around migrations", () => {
    expect(script).toMatch(/mig_fingerprint/);
    expect(script).toMatch(/HALTED-MIGRATED/);
    expect(script).toMatch(/ROLLED-BACK/);
  });

  it("takes a consistent backup and verifies it before the switch", () => {
    expect(script).toMatch(/integrity_check/);
    expect(script).toMatch(/FAILED-BACKUP/);
  });

  it("rejects stale runs and no-ops the already-deployed SHA under the lock", () => {
    expect(script).toMatch(/flock -n 9/);
    expect(script).toMatch(/RESULT="NO-OP"/);
    expect(script).toMatch(/RESULT="STALE"/);
  });
});
