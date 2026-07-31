// Apply the GitHub repo settings that "Use this template" does NOT copy (A-663).
//
// Four deterministic settings, each idempotent and each done via `gh api` so the
// whole thing is one injected-runner surface (unit-tested by asserting the recorded
// argv). Read-only probes always run — so a dry-run reports the true current state
// — while the mutating calls fire only under `write`. Anything needing org/browser
// privilege (orchestrator matrix, Claude App, npm Trusted Publisher) is NOT here —
// that stays check-and-report in the SKILL.md layer. (road-runner install +
// ROADRUNNER_* access are now org-wide, A-945, so no longer even reported.)
//
//   1. npm-release environment  — main-only deployment-branch policy (A-326).
//   2. GO/NO GO ruleset         — required check-run pinned to the GitHub Actions
//                                 integration (integration_id 15368), WITH
//                                 road-runner-bot as a bypass actor so the
//                                 changelog-enrich push to `main` clears the
//                                 required check (A-1019). Create-or-update.
//   3. Trunk changelog bypass   — road-runner-bot on the repo-level Trunk ruleset
//                                 so the post-merge enricher can write changelog/**
//                                 (ADR 0004 / A-808). Creates Trunk when absent.
//   4. Release workflow enabled — the template ships it disabled; a real package
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
/** Repo-level Trunk ruleset name (ADR 0004). Prefer this over org "Protect main trunk". */
export const TRUNK_RULESET_NAME = "Trunk";
/** Fallback name some repos use for a repo-sourced trunk ruleset. */
export const TRUNK_RULESET_ALT_NAME = "Protect main trunk";
/** road-runner-bot GitHub App id — the Integration that bypasses Trunk and GO/NO GO. */
export const ROADRUNNER_APP_ID = 2195582;

/**
 * The GO/NO GO ruleset payload — a single required-status-check rule on the
 * default branch, pinned to the GitHub Actions integration so nothing but this
 * repo's own Actions run can satisfy it. Mirrors the live ruleset on the template
 * repo.
 *
 * `bypass_actors` lists road-runner-bot (A-1019): `pkg-release.yml`'s
 * `changelog-enrich` job pushes `changelog/**` directly to `main` as
 * road-runner-bot after each merge and would otherwise be rejected by this
 * required check. Human PRs still have to satisfy GO/NO GO — the bypass is
 * scoped to the bot actor only.
 */
export function goNoGoRulesetPayload() {
  return {
    bypass_actors: [
      {
        actor_id: ROADRUNNER_APP_ID,
        actor_type: "Integration",
        bypass_mode: "always",
      },
    ],
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

/**
 * Payload for a new repo-level Trunk ruleset with the ADR 0004 changelog
 * write-back bypass. Org "Protect main trunk" only covers deletion /
 * non_fast_forward; this adds the pull_request gate + road-runner-bot bypass
 * the enricher needs. GO/NO GO stays in its own ruleset.
 */
export function trunkRulesetPayload() {
  return {
    bypass_actors: [
      {
        actor_id: ROADRUNNER_APP_ID,
        actor_type: "Integration",
        bypass_mode: "always",
      },
    ],
    conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
    enforcement: "active",
    name: TRUNK_RULESET_NAME,
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        parameters: {
          allowed_merge_methods: ["squash"],
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_approving_review_count: 0,
          required_review_thread_resolution: false,
        },
        type: "pull_request",
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
 * A one-line reason for a failed `gh` call, preferring its stderr. Used so a
 * mutating write that fails (permissions, network, rate limit) surfaces a real
 * signal instead of the call being reported as a silent success.
 */
function runFailure(result) {
  const stderr = (result?.stderr || "").trim();
  return stderr || `gh exited ${result?.status ?? "unknown"}`;
}

/**
 * Run a mutating `gh` call and return an `{ op, status: "error", detail }` result
 * when it fails, else `null` so the caller proceeds. Centralises the success check
 * every write path must apply.
 */
function failedRun(run, args, options, op) {
  const result = run(args, options);
  return result?.status === 0
    ? null
    : { detail: runFailure(result), op, status: "error" };
}

function hasRoadrunnerBypass(actors) {
  return (actors ?? []).some(
    (actor) =>
      actor.actor_id === ROADRUNNER_APP_ID &&
      actor.actor_type === "Integration",
  );
}

/**
 * Pick the repo-sourced Trunk ruleset from a list. Prefer exact name "Trunk",
 * then "Protect main trunk". Org-sourced rulesets are skipped — they cannot be
 * mutated via the repo rulesets API (HTTP 404).
 */
export function findRepoTrunkRuleset(rulesets) {
  if (!Array.isArray(rulesets)) {
    return null;
  }

  const repoScoped = rulesets.filter(
    (rs) => !rs.source_type || rs.source_type === "Repository",
  );
  return (
    repoScoped.find((rs) => rs.name === TRUNK_RULESET_NAME) ??
    repoScoped.find((rs) => rs.name === TRUNK_RULESET_ALT_NAME) ??
    null
  );
}

/**
 * Merge the road-runner-bot bypass into an existing ruleset via PUT, preserving
 * every other actor. Shared by GO/NO GO and Trunk, which both need the bot bypass.
 * @returns {{ op: string, status: "updated" } | { op: string, status: "error", detail: string }}
 */
function addRoadrunnerBypass(run, slug, full, op) {
  const bypassActors = [
    ...(full.bypass_actors ?? []),
    {
      actor_id: ROADRUNNER_APP_ID,
      actor_type: "Integration",
      bypass_mode: "always",
    },
  ];
  const putBody = {
    bypass_actors: bypassActors,
    conditions: full.conditions,
    enforcement: full.enforcement,
    name: full.name,
    rules: full.rules,
    target: full.target,
  };
  const putFailure = failedRun(
    run,
    ["api", "-X", "PUT", `repos/${slug}/rulesets/${full.id}`, "--input", "-"],
    { input: JSON.stringify(putBody) },
    op,
  );
  return putFailure ?? { op, status: "updated" };
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

  // PUT is issued even when the environment already exists — it is idempotent and
  // guarantees `custom_branch_policies` is on, which the policy POST below requires.
  const putFailure = failedRun(
    run,
    [
      "api",
      "-X",
      "PUT",
      base,
      "-F",
      "deployment_branch_policy[protected_branches]=false",
      "-F",
      "deployment_branch_policy[custom_branch_policies]=true",
    ],
    undefined,
    "environment",
  );
  if (putFailure) {
    return putFailure;
  }

  if (!hasMainPolicy) {
    const policyFailure = failedRun(
      run,
      [
        "api",
        "-X",
        "POST",
        `${base}/deployment-branch-policies`,
        "-f",
        "name=main",
      ],
      undefined,
      "environment",
    );
    if (policyFailure) {
      return policyFailure;
    }
  }

  return { op: "environment", status: "created" };
}

/**
 * Ensure the GO/NO GO required-check ruleset exists AND grants road-runner-bot a
 * bypass (A-1019 — the changelog-enrich push to `main` needs it). Idempotent
 * create-or-update: creates the ruleset when absent; when a same-named ruleset
 * exists but lacks the bot bypass, PUTs it to add the bypass without wiping other
 * actors.
 * @returns {{ op: "ruleset", status: string, detail?: string }}
 */
export function ensureGoNoGoRuleset(
  slug,
  { run = defaultRun, write = false } = {},
) {
  const list = ghJson(run, ["api", `repos/${slug}/rulesets`]) ?? [];
  const summary = Array.isArray(list)
    ? list.find(
        (rs) =>
          rs.name === RULESET_NAME &&
          (!rs.source_type || rs.source_type === "Repository"),
      )
    : null;

  if (!summary) {
    if (!write) {
      return { op: "ruleset", status: "would-create" };
    }

    const failure = failedRun(
      run,
      ["api", "-X", "POST", `repos/${slug}/rulesets`, "--input", "-"],
      { input: JSON.stringify(goNoGoRulesetPayload()) },
      "ruleset",
    );
    return failure ?? { op: "ruleset", status: "created" };
  }

  const full = ghJson(run, ["api", `repos/${slug}/rulesets/${summary.id}`]);
  if (!full) {
    return {
      detail: `could not load ruleset ${summary.id}`,
      op: "ruleset",
      status: "error",
    };
  }

  if (hasRoadrunnerBypass(full.bypass_actors)) {
    return { op: "ruleset", status: "present" };
  }

  if (!write) {
    return {
      detail: "add road-runner-bot bypass to GO/NO GO",
      op: "ruleset",
      status: "would-update",
    };
  }

  return addRoadrunnerBypass(run, slug, full, "ruleset");
}

/**
 * Ensure the repo-level Trunk ruleset grants road-runner-bot a bypass so the
 * post-merge changelog enricher can push `changelog/**` (ADR 0004 / A-808).
 * Creates a Trunk ruleset when none exists; merges the bypass into an existing
 * one without wiping other actors. Idempotent.
 * @returns {{ op: "trunk-bypass", status: string, detail?: string }}
 */
export function ensureTrunkChangelogBypass(
  slug,
  { run = defaultRun, write = false } = {},
) {
  const list = ghJson(run, ["api", `repos/${slug}/rulesets`]) ?? [];
  const summary = findRepoTrunkRuleset(list);

  if (!summary) {
    if (!write) {
      return {
        detail: "create Trunk ruleset with road-runner-bot bypass",
        op: "trunk-bypass",
        status: "would-create",
      };
    }

    const createFailure = failedRun(
      run,
      ["api", "-X", "POST", `repos/${slug}/rulesets`, "--input", "-"],
      { input: JSON.stringify(trunkRulesetPayload()) },
      "trunk-bypass",
    );
    return createFailure ?? { op: "trunk-bypass", status: "created" };
  }

  const full = ghJson(run, ["api", `repos/${slug}/rulesets/${summary.id}`]);
  if (!full) {
    return {
      detail: `could not load ruleset ${summary.id}`,
      op: "trunk-bypass",
      status: "error",
    };
  }

  if (hasRoadrunnerBypass(full.bypass_actors)) {
    return { op: "trunk-bypass", status: "present" };
  }

  if (!write) {
    return {
      detail: "add road-runner-bot bypass to Trunk",
      op: "trunk-bypass",
      status: "would-update",
    };
  }

  return addRoadrunnerBypass(run, slug, full, "trunk-bypass");
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

  const failure = failedRun(
    run,
    [
      "api",
      "-X",
      "PUT",
      `repos/${slug}/actions/workflows/${RELEASE_WORKFLOW_FILE}/enable`,
    ],
    undefined,
    "release-workflow",
  );
  return failure ?? { op: "release-workflow", status: "enabled" };
}

/**
 * Run all settings ops in the correct order (environment before enabling
 * Release, so the first post-enable push has somewhere to deploy from; Trunk
 * bypass after GO/NO GO so both rulesets exist before Release fires).
 * @returns {Array<{ op: string, status: string, detail?: string }>}
 */
export function applyGithubSettings(
  slug,
  { run = defaultRun, write = false } = {},
) {
  return [
    ensureNpmReleaseEnvironment(slug, { run, write }),
    ensureGoNoGoRuleset(slug, { run, write }),
    ensureTrunkChangelogBypass(slug, { run, write }),
    ensureReleaseEnabled(slug, { run, write }),
  ];
}
