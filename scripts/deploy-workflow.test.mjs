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

describe("CI deploy trigger (deploy task §2)", () => {
  it("supports an input-less workflow_dispatch through the same quality job", () => {
    expect(workflow).toMatch(/^\s*workflow_dispatch:\s*$/m);
    expect(workflow).not.toMatch(/workflow_dispatch:\s*\n\s+inputs:/);
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

  it("gates on quality and keeps pull requests outside production", () => {
    expect(workflow).toMatch(
      /deploy:\s*\n\s+name: deploy \(racknerd\)\s*\n\s+needs: quality/,
    );
    expect(deployJob).toMatch(
      /if: github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/main'/,
    );
    expect(deployJob).toMatch(/environment: production-racknerd/);
  });

  it("checks out the exact validated SHA, never a moving ref", () => {
    expect(deployJob).toMatch(/ref: \$\{\{ github\.sha \}\}/);
    expect(deployJob).not.toMatch(/ref: main\b/);
  });

  it("auto-deploy is gated by the environment variable, off unless 'true'", () => {
    // Step-level gate (environment-scoped vars are not reliable in job-if).
    expect(deployJob).toMatch(/Auto-deploy gate/);
    expect(deployJob).toMatch(/VELADESK_AUTO_DEPLOY/);
    expect(deployJob).toMatch(
      /"workflow_dispatch" \] \|\| \[ "\$VELADESK_AUTO_DEPLOY" = "true" \]/,
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
