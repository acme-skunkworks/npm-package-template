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
//   slug             : branch-name-derived slug (changelog/<ts>-<slug>.md filename)
//   bump             : major | minor | patch (release magnitude when it IS a release)
//   body             : a one-line draft summary (the ship flow may rewrite this)
//   type             : the Conventional-Commit type of the lead commit (feat/fix/
//                      perf/docs/refactor/chore/…) — the PR-title prefix
//   breaking         : whether any commit is breaking (`!` or BREAKING CHANGE:)
//   category         : the dated changelog `category` enum value for this change
//   releaseTriggering: whether this change cuts a release (A-598 — by the change's
//                      semantic category, NOT by which paths it touches)
//
// Release-type is decided by the change's **semantic category** (the commit
// types send-it itself authored), not by whether the diff touches a publish path
// (A-598): feat/fix/perf — or any breaking change — cut a release; docs/refactor/
// chore/ci/build/test/style do not, wherever the files live.
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

// Conventional types that cut a release under release-please: feat (minor),
// fix / perf (patch). A `!` / `BREAKING CHANGE:` makes any type a major release.
const RELEASE_TYPES = new Set(["feat", "fix", "perf"]);

// Map a Conventional-Commit type to the dated changelog's `category` enum
// (chore, docs, feature, fix, perf, refactor). Anything outside the enum
// (`ci`, `build`, `test`, `style`, or an unrecognised prefix) folds to `chore`.
const CATEGORY_BY_TYPE = {
  docs: "docs",
  feat: "feature",
  fix: "fix",
  perf: "perf",
  refactor: "refactor",
};

const CONVENTIONAL_TYPE = /^([a-z]+)(\([^)]+\))?!?:/i;

// The Conventional-Commit type of a subject (lower-cased), or `chore` when the
// subject carries no recognisable `type:` prefix.
export function deriveType(subject) {
  const match = subject.match(CONVENTIONAL_TYPE);
  return match ? match[1].toLowerCase() : "chore";
}

// Decide release-type by the change's semantic category, not by path (A-598).
// The lead commit's type drives the title/category (mirroring deriveBump /
// deriveBody, which key off commits[0]); breaking-change detection scans all
// commits (mirroring deriveBump). Returns the PR-title `type`, whether it's
// `breaking`, the changelog `category`, and whether it is `releaseTriggering`.
export function deriveCategory(commits) {
  const breaking = commits.some(
    (commit) =>
      BREAKING_SUBJECT.test(commit.subject) ||
      /BREAKING CHANGE:/.test(commit.body),
  );
  const type = commits.length > 0 ? deriveType(commits[0].subject) : "chore";
  return {
    breaking,
    // `Object.hasOwn` guard so a type colliding with an inherited Object key
    // (`constructor`, `toString`, …) resolves to `chore`, not the prototype's
    // value — `?? "chore"` alone wouldn't catch a non-null inherited property.
    category: Object.hasOwn(CATEGORY_BY_TYPE, type)
      ? CATEGORY_BY_TYPE[type]
      : "chore",
    releaseTriggering: breaking || RELEASE_TYPES.has(type),
    type,
  };
}

const USAGE = `derive-bump — print the slug/bump/body send-it derives from the branch commits

Usage:
  node derive-bump.mjs            Print { slug, bump, body, type, breaking, category, releaseTriggering } as JSON to stdout (read-only)
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
  const { breaking, category, releaseTriggering, type } =
    deriveCategory(commits);
  console.log(
    JSON.stringify(
      {
        body: deriveBody(commits),
        breaking,
        bump: deriveBump(commits),
        category,
        releaseTriggering,
        slug: deriveSlug(branch),
        type,
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
