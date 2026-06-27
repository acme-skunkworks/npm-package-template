// Derives the deterministic bits the send-it ship flow needs from the branch
// commits. Zero dependencies — Node built-ins only, no build step, no tsx.
// Run: node skills/send-it/scripts/derive-bump.mjs
//
// Under release-please (Conventional Commits) there is no changeset file: the
// release signal is the Conventional Commits PR title. send-it uses these
// derived bits to name the dated changelog/ entry and to compose that title
// (the bump signal release-please reads).
//
// Fields printed as JSON to stdout:
//   slug : branch-name-derived slug (changelog/<ts>-<slug>.md filename)
//   bump : major | minor | patch (drives the PR-title prefix: feat!/feat/fix)
//   body : a one-line draft summary (the ship flow may rewrite this)
//
// Reads from git via `git branch --show-current` and `git log <base>..HEAD`.
// The base ref is `origin/main` (falling back to `main`), overridable via the
// BASE_REF env var. The pure functions are exported for vitest.

import { readGitBranch, readGitCommits } from "./lib/git.mjs";
import { realpathSync } from "node:fs";

const SLUG_MAX = 60;

export function deriveSlug(branch) {
  const cleaned = branch
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  if (cleaned.length <= SLUG_MAX) {
    return cleaned;
  }

  const truncated = cleaned.slice(0, SLUG_MAX);
  const lastHyphen = truncated.lastIndexOf("-");
  return lastHyphen > 0 ? truncated.slice(0, lastHyphen) : truncated;
}

const BREAKING_SUBJECT = /^[a-z]+(\([^)]+\))?!:/;
const FEAT_SUBJECT = /^feat(\([^)]+\))?:/;

export function deriveBump(commits) {
  if (commits.length === 0) {
    return "patch";
  }

  const anyBreaking = commits.some(
    (commit) =>
      BREAKING_SUBJECT.test(commit.subject) ||
      /BREAKING CHANGE:/.test(commit.body),
  );
  if (anyBreaking) {
    return "major";
  }

  if (FEAT_SUBJECT.test(commits[0].subject)) {
    return "minor";
  }

  return "patch";
}

export function deriveBody(commits) {
  if (commits.length === 0) {
    return "";
  }

  const subject = commits[0].subject;
  return subject.replace(/^[a-z]+(\([^)]+\))?!?:\s*/, "");
}

const USAGE = `derive-bump — print the slug/bump/body send-it derives from the branch commits

Usage:
  node derive-bump.mjs            Print { slug, bump, body } as JSON to stdout (read-only)
  node derive-bump.mjs --help     Show this message (alias: -h)

Env:
  BASE_REF   Override the base ref (default: origin/main, then main).`;

function main() {
  if (
    process.argv
      .slice(2)
      .some((argument) => argument === "--help" || argument === "-h")
  ) {
    console.log(USAGE);
    return;
  }

  const branch = readGitBranch();
  const commits = readGitCommits();
  console.log(
    JSON.stringify(
      {
        body: deriveBody(commits),
        bump: deriveBump(commits),
        slug: deriveSlug(branch),
      },
      null,
      2,
    ),
  );
}

// Run main() only when invoked directly as a CLI, not when imported (e.g. by
// check-skill-bumps, which imports deriveBump). Compare realpath'd paths so
// symlinks (macOS /var→/private/var, pnpm's store) don't cause a false negative.
function isCliEntry() {
  if (!process.argv[1]) {
    return false;
  }

  try {
    return realpathSync(import.meta.filename) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  main();
}
