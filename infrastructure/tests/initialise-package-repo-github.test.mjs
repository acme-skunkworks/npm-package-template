// Unit tests for the initialise-package-repo skill's GitHub-settings logic
// (A-663 / A-808). A fake runner records the `gh` argv and returns canned API
// responses, so we assert both the idempotent "already present → no mutation"
// path and the "absent → correct gh api call" path without touching a real repo.

import {
  applyGithubSettings,
  ensureGoNoGoRuleset,
  ensureNpmReleaseEnvironment,
  ensureReleaseEnabled,
  ensureTrunkChangelogBypass,
  findRepoTrunkRuleset,
  goNoGoRulesetPayload,
  ROADRUNNER_APP_ID,
  RULESET_NAME,
  TRUNK_RULESET_NAME,
  trunkRulesetPayload,
} from "../../.claude/skills/initialise-package-repo/scripts/lib/github-settings.mjs";
import { describe, expect, it } from "vitest";

/**
 * Build a fake `run` that returns queued responses by matching a substring of the
 * joined argv, and records every call. `{ status, stdout }` shape mirrors spawnSync.
 */
function fakeRun(responder) {
  const calls = [];
  function run(args) {
    calls.push(args);
    return responder(args.join(" ")) ?? { status: 0, stdout: "" };
  }

  return { calls, run };
}

const SLUG = "acme-skunkworks/portcullis";

describe("ensureNpmReleaseEnvironment", () => {
  it("is present when the env + main policy already exist (no mutation)", () => {
    const { calls, run } = fakeRun((cmd) => {
      if (cmd.endsWith("environments/npm-release")) {
        return { status: 0, stdout: '{"name":"npm-release"}' };
      }

      if (cmd.includes("deployment-branch-policies")) {
        return { status: 0, stdout: '{"branch_policies":[{"name":"main"}]}' };
      }

      return null;
    });
    const result = ensureNpmReleaseEnvironment(SLUG, { run, write: true });
    expect(result.status).toBe("present");
    expect(calls.some((call) => call.includes("PUT"))).toBe(false);
  });

  it("creates the env + main policy when absent (write)", () => {
    const { calls, run } = fakeRun((cmd) => {
      if (cmd.includes("deployment-branch-policies")) {
        return { status: 0, stdout: "" };
      }

      if (cmd.endsWith("environments/npm-release")) {
        return { status: 1, stdout: "" };
      } // 404 → absent

      return null;
    });
    const result = ensureNpmReleaseEnvironment(SLUG, { run, write: true });
    expect(result.status).toBe("created");
    const put = calls.find((call) => call.includes("PUT"));
    expect(put).toContain(
      "repos/acme-skunkworks/portcullis/environments/npm-release",
    );
    expect(put).toContain(
      "deployment_branch_policy[custom_branch_policies]=true",
    );
    const post = calls.find(
      (call) =>
        call.includes("POST") &&
        call.join(" ").includes("deployment-branch-policies"),
    );
    expect(post).toContain("name=main");
  });

  it("does not mutate on a dry-run", () => {
    const { calls, run } = fakeRun(() => ({ status: 1, stdout: "" }));
    const result = ensureNpmReleaseEnvironment(SLUG, { run, write: false });
    expect(result.status).toBe("would-create");
    expect(
      calls.every((call) => !call.includes("PUT") && !call.includes("POST")),
    ).toBe(true);
  });

  it("adds only the main policy when the env exists without one (write)", () => {
    const { calls, run } = fakeRun((cmd) => {
      if (cmd.endsWith("environments/npm-release")) {
        return { status: 0, stdout: '{"name":"npm-release"}' };
      }

      if (cmd.includes("deployment-branch-policies")) {
        return { status: 0, stdout: '{"branch_policies":[]}' }; // exists, empty
      }

      return { status: 0, stdout: "" };
    });
    const result = ensureNpmReleaseEnvironment(SLUG, { run, write: true });
    expect(result.status).toBe("created");
    // PUT is still issued (idempotent, guarantees custom_branch_policies) and the
    // POST adds the missing main policy.
    expect(calls.some((call) => call.includes("PUT"))).toBe(true);
    const post = calls.find(
      (call) =>
        call.includes("POST") &&
        call.join(" ").includes("deployment-branch-policies"),
    );
    expect(post).toContain("name=main");
  });

  it("reports error (not success) when a mutating gh api call fails (write)", () => {
    const { run } = fakeRun((cmd) => {
      if (cmd.endsWith("environments/npm-release")) {
        return { status: 1, stdout: "" }; // absent
      }

      if (cmd.includes("deployment-branch-policies")) {
        return { status: 0, stdout: "" };
      }

      if (cmd.includes("PUT")) {
        return { status: 1, stderr: "HTTP 403: must have admin rights" };
      }

      return { status: 0, stdout: "" };
    });
    const result = ensureNpmReleaseEnvironment(SLUG, { run, write: true });
    expect(result.status).toBe("error");
    expect(result.detail).toContain("admin");
  });
});

describe("ensureGoNoGoRuleset", () => {
  it("is present when a ruleset of the same name exists (no mutation)", () => {
    const { calls, run } = fakeRun(() => ({
      status: 0,
      stdout: JSON.stringify([{ name: RULESET_NAME }]),
    }));
    const result = ensureGoNoGoRuleset(SLUG, { run, write: true });
    expect(result.status).toBe("present");
    expect(calls.some((call) => call.includes("POST"))).toBe(false);
  });

  it("POSTs the pinned ruleset payload when absent (write)", () => {
    const { calls, run } = fakeRun((cmd) => {
      if (cmd.endsWith("rulesets")) {
        return { status: 0, stdout: "[]" };
      }

      return { status: 0, stdout: "" };
    });
    const result = ensureGoNoGoRuleset(SLUG, { run, write: true });
    expect(result.status).toBe("created");
    const post = calls.find((call) => call.includes("POST"));
    expect(post).toContain("repos/acme-skunkworks/portcullis/rulesets");
    expect(post).toContain("--input");
  });

  it("payload pins the GO/NO GO check to the GitHub Actions integration", () => {
    const check =
      goNoGoRulesetPayload().rules[0].parameters.required_status_checks[0];
    expect(check).toEqual({ context: "GO/NO GO", integration_id: 15368 });
    expect(goNoGoRulesetPayload().conditions.ref_name.include).toEqual([
      "~DEFAULT_BRANCH",
    ]);
    // bypass_actors must be sent explicitly — the API rejects a null/omitted value.
    expect(goNoGoRulesetPayload().bypass_actors).toEqual([]);
  });
});

describe("findRepoTrunkRuleset", () => {
  it("prefers repo-sourced Trunk over org Protect main trunk", () => {
    const found = findRepoTrunkRuleset([
      {
        id: 1,
        name: "Protect main trunk",
        source_type: "Organization",
      },
      { id: 2, name: "Trunk", source_type: "Repository" },
    ]);
    expect(found).toEqual({
      id: 2,
      name: "Trunk",
      source_type: "Repository",
    });
  });

  it("falls back to repo-sourced Protect main trunk", () => {
    const found = findRepoTrunkRuleset([
      {
        id: 1,
        name: "Protect main trunk",
        source_type: "Organization",
      },
      {
        id: 3,
        name: "Protect main trunk",
        source_type: "Repository",
      },
    ]);
    expect(found.id).toBe(3);
  });

  it("returns null when only org rulesets exist", () => {
    expect(
      findRepoTrunkRuleset([
        {
          id: 1,
          name: "Protect main trunk",
          source_type: "Organization",
        },
      ]),
    ).toBeNull();
  });
});

describe("ensureTrunkChangelogBypass", () => {
  it("is present when Trunk already has the road-runner-bot bypass", () => {
    const { calls, run } = fakeRun((cmd) => {
      if (cmd.endsWith("rulesets")) {
        return {
          status: 0,
          stdout: JSON.stringify([
            { id: 99, name: TRUNK_RULESET_NAME, source_type: "Repository" },
          ]),
        };
      }

      if (cmd.endsWith("rulesets/99")) {
        return {
          status: 0,
          stdout: JSON.stringify({
            bypass_actors: [
              {
                actor_id: ROADRUNNER_APP_ID,
                actor_type: "Integration",
                bypass_mode: "always",
              },
            ],
            conditions: {
              ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] },
            },
            enforcement: "active",
            id: 99,
            name: "Trunk",
            rules: [{ type: "deletion" }],
            target: "branch",
          }),
        };
      }

      return null;
    });
    const result = ensureTrunkChangelogBypass(SLUG, { run, write: true });
    expect(result.status).toBe("present");
    expect(calls.some((call) => call.includes("PUT"))).toBe(false);
  });

  it("would-update on dry-run when Trunk exists without the bypass", () => {
    const { calls, run } = fakeRun((cmd) => {
      if (cmd.endsWith("rulesets")) {
        return {
          status: 0,
          stdout: JSON.stringify([
            { id: 99, name: TRUNK_RULESET_NAME, source_type: "Repository" },
          ]),
        };
      }

      if (cmd.endsWith("rulesets/99")) {
        return {
          status: 0,
          stdout: JSON.stringify({
            bypass_actors: [],
            conditions: {
              ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] },
            },
            enforcement: "active",
            id: 99,
            name: "Trunk",
            rules: [{ type: "deletion" }],
            target: "branch",
          }),
        };
      }

      return null;
    });
    const result = ensureTrunkChangelogBypass(SLUG, { run, write: false });
    expect(result.status).toBe("would-update");
    expect(calls.some((call) => call.includes("PUT"))).toBe(false);
  });

  it("PUTs merged bypass_actors when Trunk exists without the bypass (write)", () => {
    const { calls, run } = fakeRun((cmd) => {
      if (cmd.endsWith("rulesets")) {
        return {
          status: 0,
          stdout: JSON.stringify([
            { id: 99, name: TRUNK_RULESET_NAME, source_type: "Repository" },
          ]),
        };
      }

      if (cmd.endsWith("rulesets/99") && !cmd.includes("PUT")) {
        return {
          status: 0,
          stdout: JSON.stringify({
            bypass_actors: [
              {
                actor_id: 5,
                actor_type: "RepositoryRole",
                bypass_mode: "always",
              },
            ],
            conditions: {
              ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] },
            },
            enforcement: "active",
            id: 99,
            name: "Trunk",
            rules: [{ type: "deletion" }],
            target: "branch",
          }),
        };
      }

      return { status: 0, stdout: "" };
    });
    const result = ensureTrunkChangelogBypass(SLUG, { run, write: true });
    expect(result.status).toBe("updated");
    const put = calls.find((call) => call.includes("PUT"));
    expect(put).toContain("repos/acme-skunkworks/portcullis/rulesets/99");
    expect(put).toContain("--input");
  });

  it("would-create on dry-run when no repo Trunk exists", () => {
    const { run } = fakeRun((cmd) => {
      if (cmd.endsWith("rulesets")) {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              id: 1,
              name: "Protect main trunk",
              source_type: "Organization",
            },
          ]),
        };
      }

      return null;
    });
    const result = ensureTrunkChangelogBypass(SLUG, { run, write: false });
    expect(result.status).toBe("would-create");
  });

  it("POSTs a new Trunk ruleset when absent (write)", () => {
    const { calls, run } = fakeRun((cmd) => {
      if (cmd.endsWith("rulesets") && !cmd.includes("POST")) {
        return { status: 0, stdout: "[]" };
      }

      return { status: 0, stdout: "" };
    });
    const result = ensureTrunkChangelogBypass(SLUG, { run, write: true });
    expect(result.status).toBe("created");
    const post = calls.find((call) => call.includes("POST"));
    expect(post).toContain("repos/acme-skunkworks/portcullis/rulesets");
    expect(trunkRulesetPayload().bypass_actors[0].actor_id).toBe(
      ROADRUNNER_APP_ID,
    );
    expect(trunkRulesetPayload().name).toBe("Trunk");
  });
});

describe("ensureReleaseEnabled", () => {
  it("is present when the workflow is already active (no mutation)", () => {
    const { calls, run } = fakeRun(() => ({
      status: 0,
      stdout: '{"state":"active"}',
    }));
    const result = ensureReleaseEnabled(SLUG, { run, write: true });
    expect(result.status).toBe("present");
    expect(calls.some((call) => call.includes("enable"))).toBe(false);
  });

  it("enables via the workflow filename when disabled (write)", () => {
    const { calls, run } = fakeRun((cmd) => {
      if (cmd.includes("/enable")) {
        return { status: 0, stdout: "" };
      }

      return { status: 0, stdout: '{"state":"disabled_manually"}' };
    });
    const result = ensureReleaseEnabled(SLUG, { run, write: true });
    expect(result.status).toBe("enabled");
    const enable = calls.find((call) => call.join(" ").includes("/enable"));
    expect(enable).toContain(
      "repos/acme-skunkworks/portcullis/actions/workflows/pkg-release.yml/enable",
    );
  });
});

describe("applyGithubSettings", () => {
  it("runs the four ops in order: environment, ruleset, trunk-bypass, release-workflow", () => {
    const { run } = fakeRun((cmd) => {
      if (cmd.endsWith("environments/npm-release")) {
        return { status: 0, stdout: '{"name":"npm-release"}' };
      }

      if (cmd.includes("deployment-branch-policies")) {
        return { status: 0, stdout: '{"branch_policies":[{"name":"main"}]}' };
      }

      if (cmd.endsWith("rulesets")) {
        return {
          status: 0,
          stdout: JSON.stringify([
            { name: RULESET_NAME, source_type: "Repository" },
            {
              id: 99,
              name: TRUNK_RULESET_NAME,
              source_type: "Repository",
            },
          ]),
        };
      }

      if (cmd.endsWith("rulesets/99")) {
        return {
          status: 0,
          stdout: JSON.stringify({
            bypass_actors: [
              {
                actor_id: ROADRUNNER_APP_ID,
                actor_type: "Integration",
                bypass_mode: "always",
              },
            ],
            id: 99,
            name: "Trunk",
          }),
        };
      }

      if (cmd.includes("workflows/pkg-release.yml")) {
        return { status: 0, stdout: '{"state":"active"}' };
      }

      return null;
    });
    const results = applyGithubSettings(SLUG, { run, write: false });
    expect(results.map((entry) => entry.op)).toEqual([
      "environment",
      "ruleset",
      "trunk-bypass",
      "release-workflow",
    ]);
    expect(results.every((entry) => entry.status === "present")).toBe(true);
  });

  it("reports each op's own state in a mixed partial-setup repo (dry-run)", () => {
    // env + workflow already set up, ruleset + trunk missing — a realistic partial spawn.
    const { run } = fakeRun((cmd) => {
      if (cmd.endsWith("environments/npm-release")) {
        return { status: 0, stdout: '{"name":"npm-release"}' };
      }

      if (cmd.includes("deployment-branch-policies")) {
        return { status: 0, stdout: '{"branch_policies":[{"name":"main"}]}' };
      }

      if (cmd.endsWith("rulesets")) {
        return { status: 0, stdout: "[]" }; // ruleset + trunk absent
      }

      if (cmd.includes("workflows/pkg-release.yml")) {
        return { status: 0, stdout: '{"state":"active"}' };
      }

      return null;
    });
    const results = applyGithubSettings(SLUG, { run, write: false });
    expect(results.map((entry) => [entry.op, entry.status])).toEqual([
      ["environment", "present"],
      ["ruleset", "would-create"],
      ["trunk-bypass", "would-create"],
      ["release-workflow", "present"],
    ]);
  });
});
