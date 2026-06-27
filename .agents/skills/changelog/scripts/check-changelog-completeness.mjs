#!/usr/bin/env node
// Changelog-completeness gate (A-380). A release-triggering PR title
// (`feat`/`fix`/breaking) MUST carry a dated `changelog/` entry. This restores
// the coupling Changesets gave for free — no changeset → no release — now that
// release-please infers the bump from the Conventional-Commit PR title rather
// than an explicit file. Wired into validate.yml's build-and-lint job.
//
// "Release-triggering" mirrors release-please's default node bump table:
// `feat` (minor), `fix`/`perf`/`revert` (patch), and a `!` breaking marker
// (major) cut a release; `docs`/`chore`/`ci`/`refactor`/`test`/`build`/`style`
// do not.
//
// Inputs (env, set by the workflow):
//   PR_TITLE — the pull request title (github.event.pull_request.title)
//   BASE_REF — the base branch name (github.base_ref); defaults to "main"
// Reads changed files from `git diff --name-only origin/<BASE_REF>...HEAD`.
// Pure functions live exported for vitest.
//
// Zero-dep: Node built-ins only — no tsx, so CI runs it under bare `node`.

import { execFileSync } from "node:child_process";
import { argv } from "node:process";

const RELEASE_TRIGGERING_TYPE = /^(feat|fix|perf|revert)(\([^)]+\))?:/;
const BREAKING_SUBJECT = /^[a-z]+(\([^)]+\))?!:/;
const CHANGELOG_ENTRY = /^changelog\/.+\.md$/;

/**
 * @param {string} prTitle pull request title
 * @returns {boolean}
 */
export function isReleaseTriggering(prTitle) {
  const title = prTitle.trim();
  return BREAKING_SUBJECT.test(title) || RELEASE_TRIGGERING_TYPE.test(title);
}

/**
 * @param {string[]} changedFiles changed file paths
 * @returns {boolean}
 */
export function hasChangelogEntry(changedFiles) {
  return changedFiles.some(
    (file) => CHANGELOG_ENTRY.test(file) && file !== "changelog/README.md",
  );
}

/**
 * @typedef {object} CompletenessResult
 * @property {boolean} ok whether the gate passes
 * @property {string} reason human-readable explanation
 */

/**
 * @param {string} prTitle pull request title
 * @param {string[]} changedFiles changed file paths
 * @returns {CompletenessResult}
 */
export function checkCompleteness(prTitle, changedFiles) {
  if (!isReleaseTriggering(prTitle)) {
    return {
      ok: true,
      reason: `PR title "${prTitle}" is not release-triggering — no changelog entry required.`,
    };
  }

  if (hasChangelogEntry(changedFiles)) {
    return {
      ok: true,
      reason: "Release-triggering PR title with a changelog/ entry present.",
    };
  }

  return {
    ok: false,
    reason: `PR title "${prTitle}" triggers a release (feat/fix/breaking) but no changelog/*.md entry is present in the diff vs the base branch. Run /send-it (or add a dated changelog/ entry) so the release carries notes.`,
  };
}

/**
 * @param {string} baseRef
 * @returns {string[]}
 */
function readChangedFiles(baseRef) {
  // execFileSync (argv array, no shell) rather than execSync — consistent with
  // finalise-changelog.mjs and keeps `baseRef` (from env) out of a shell string.
  const out = execFileSync(
    "git",
    ["diff", "--name-only", `origin/${baseRef}...HEAD`],
    { encoding: "utf8" },
  );
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const USAGE = `check-changelog-completeness — gate a release-triggering PR on a dated changelog/ entry

Reads PR_TITLE and BASE_REF (default "main") from the environment and the changed
files from \`git diff --name-only origin/<BASE_REF>...HEAD\`. A feat/fix/breaking
PR title with no changelog/*.md entry in the diff fails the gate (exit 1).

Usage:
  PR_TITLE=… node check-changelog-completeness.mjs   Run the gate
  node check-changelog-completeness.mjs --self-test   Run the built-in offline smoke test
  node check-changelog-completeness.mjs --help        Show this message (alias: -h)`;

// Offline smoke test: exercise the pure checkCompleteness / isReleaseTriggering
// over representative inputs — no env, no git. The exhaustive cases live in the
// repo's vitest suite (infrastructure/tests/check-changelog-completeness.test.ts).
function selfTest() {
  const cases = [
    {
      name: "feat: title is release-triggering",
      ok: isReleaseTriggering("feat: add a thing") === true,
    },
    {
      name: "docs: title is not release-triggering",
      ok: isReleaseTriggering("docs: tidy the readme") === false,
    },
    {
      name: "breaking ! marker is release-triggering",
      ok: isReleaseTriggering("feat(api)!: drop the old endpoint") === true,
    },
    {
      name: "feat with a changelog entry passes the gate",
      ok:
        checkCompleteness("feat: x", ["changelog/20260101-000000-a-1-x.md"])
          .ok === true,
    },
    {
      name: "feat with no changelog entry fails the gate",
      ok:
        checkCompleteness("feat: x", ["skills/changelog/SKILL.md"]).ok ===
        false,
    },
    {
      name: "changelog/README.md does not satisfy the gate",
      ok: checkCompleteness("fix: y", ["changelog/README.md"]).ok === false,
    },
    {
      name: "non-release-triggering title passes with no entry",
      ok: checkCompleteness("chore: z", []).ok === true,
    },
  ];

  let failed = 0;
  for (const { name, ok } of cases) {
    if (ok) {
      console.log(`  ok    ${name}`);
    } else {
      failed += 1;
      console.log(`  FAIL  ${name}`);
    }
  }

  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

function main() {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  if (args.includes("--self-test")) {
    selfTest();
    return;
  }

  const prTitle = process.env.PR_TITLE ?? "";
  const baseRef = process.env.BASE_REF || "main";

  if (!prTitle) {
    console.error(
      "PR_TITLE is not set — cannot run the changelog-completeness gate.",
    );
    process.exit(1);
  }

  const result = checkCompleteness(prTitle, readChangedFiles(baseRef));
  console.log(result.reason);
  if (!result.ok) {
    process.exit(1);
  }
}

// Only run when invoked as a CLI, not when imported (e.g. by unit tests
// exercising the pure functions).
if (argv[1] && import.meta.filename === argv[1]) {
  main();
}
