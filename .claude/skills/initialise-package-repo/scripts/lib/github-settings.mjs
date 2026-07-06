// Apply the GitHub repo settings that "Use this template" does NOT copy (A-663).
//
// Three deterministic settings, each idempotent and each done via `gh api` so the
// whole thing is one injected-runner surface (unit-tested by asserting the recorded
// argv). Read-only probes always run — so a dry-run reports the true current state
// — while the mutating calls fire only under `write`. Anything needing org/browser
// privilege (orchestrator matrix, road-runner install, Claude App, npm Trusted
// Publisher) is NOT here — that stays check-and-report in the SKILL.md layer.
//
//   1. npm-release environment  — main-only deployment-branch policy (A-326).
//   2. GO/NO GO ruleset         — required check-run pinned to the GitHub Actions
//                                 integration (integration_id 15368), replicating
//                                 this template's own live ruleset.
//   3. Release workflow enabled — the template ships it disabled; a real package
//                                 needs it on.

import { spawnSync } from "node:child_process";

/**
 * Repo settings constants — the ground truth these calls converge the repo onto.
 */
export const ENVIRONMENT_NAME = "npm-release";
export const RULESET_NAME = "Require GO/NO GO gate";
export const GO_NO_GO_CONTEXT = "GO/NO GO";
export const GITHUB_ACTIONS_INTEGRATION_ID = 15368;
export const RELEASE_WORKFLOW_FILE = "pkg-release.yml";

/**
 * The GO/NO GO ruleset payload — a single required-status-check rule on the
 * default branch, pinned to the GitHub Actions integration so nothing but this
 * repo's own Actions run can satisfy it. Mirrors the live ruleset on the template
 * repo. `bypass_actors: []` = no bypass. (PR-required / 0-approvals is inherited
 * from the org-level "Protect main trunk" ruleset — not recreated here.)
 */
export function goNoGoRulesetPayload() {
  return {
    conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
    enforcement: "active",
    name: RULESET_NAME,
    rules: [
      {
        parameters: {
          do_not_enforce_on_create: false,
          required_status_checks: [
            {
              context: GO_NO_GO_CONTEXT,
              integration_id: GITHUB_ACTIONS_INTEGRATION_ID,
            },
          ],
          strict_required_status_checks_policy: false,
        },
        type: "required_status_checks",
      },
    ],
    target: "branch",
  };
}

function defaultRun(args, options = {}) {
  return spawnSync("gh", args, { encoding: "utf8", ...options });
}

function ghJson(run, args) {
  const result = run(args, { encoding: "utf8" });
  if (!result || result.status !== 0 || !result.stdout) {
    return null;
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/**
 * Ensure the `npm-release` environment exists with a single `main`-only
 * deployment-branch policy. Idempotent: the environment PUT is safe to repeat, and
 * the `main` policy POST is guarded by a GET so it is never duplicated.
 * @returns {{ op: "environment", status: string, detail?: string }}
 */
export function ensureNpmReleaseEnvironment(
  slug,
  { run = defaultRun, write = false } = {},
) {
  const base = `repos/${slug}/environments/${ENVIRONMENT_NAME}`;
  const existing = ghJson(run, ["api", base]);
  const policies = existing
    ? ghJson(run, ["api", `${base}/deployment-branch-policies`])
    : null;
  const hasMainPolicy = Boolean(
    policies?.branch_policies?.some((policy) => policy.name === "main"),
  );

  if (existing && hasMainPolicy) {
    return { op: "environment", status: "present" };
  }

  if (!write) {
    return {
      detail: existing
        ? "add main branch policy"
        : "create environment + main policy",
      op: "environment",
      status: "would-create",
    };
  }

  run([
    "api",
    "-X",
    "PUT",
    base,
    "-F",
    "deployment_branch_policy[protected_branches]=false",
    "-F",
    "deployment_branch_policy[custom_branch_policies]=true",
  ]);
  if (!hasMainPolicy) {
    run([
      "api",
      "-X",
      "POST",
      `${base}/deployment-branch-policies`,
      "-f",
      "name=main",
    ]);
  }

  return { op: "environment", status: "created" };
}

/**
 * Ensure the GO/NO GO required-check ruleset exists. Idempotent: skips when a
 * ruleset of the same name is already present.
 * @returns {{ op: "ruleset", status: string }}
 */
export function ensureGoNoGoRuleset(
  slug,
  { run = defaultRun, write = false } = {},
) {
  const rulesets = ghJson(run, ["api", `repos/${slug}/rulesets`]) ?? [];
  if (
    Array.isArray(rulesets) &&
    rulesets.some((rs) => rs.name === RULESET_NAME)
  ) {
    return { op: "ruleset", status: "present" };
  }

  if (!write) {
    return { op: "ruleset", status: "would-create" };
  }

  run(["api", "-X", "POST", `repos/${slug}/rulesets`, "--input", "-"], {
    input: JSON.stringify(goNoGoRulesetPayload()),
  });
  return { op: "ruleset", status: "created" };
}

/**
 * Ensure the Release workflow is enabled. Idempotent: skips when already active.
 * @returns {{ op: "release-workflow", status: string }}
 */
export function ensureReleaseEnabled(
  slug,
  { run = defaultRun, write = false } = {},
) {
  const workflow = ghJson(run, [
    "api",
    `repos/${slug}/actions/workflows/${RELEASE_WORKFLOW_FILE}`,
  ]);
  if (workflow?.state === "active") {
    return { op: "release-workflow", status: "present" };
  }

  if (!write) {
    return { op: "release-workflow", status: "would-enable" };
  }

  run([
    "api",
    "-X",
    "PUT",
    `repos/${slug}/actions/workflows/${RELEASE_WORKFLOW_FILE}/enable`,
  ]);
  return { op: "release-workflow", status: "enabled" };
}

/**
 * Run all three settings ops in the correct order (environment before enabling
 * Release, so the first post-enable push has somewhere to deploy from).
 * @returns {Array<{ op: string, status: string, detail?: string }>}
 */
export function applyGithubSettings(
  slug,
  { run = defaultRun, write = false } = {},
) {
  return [
    ensureNpmReleaseEnvironment(slug, { run, write }),
    ensureGoNoGoRuleset(slug, { run, write }),
    ensureReleaseEnabled(slug, { run, write }),
  ];
}
