#!/usr/bin/env -S npx tsx
// Changelog-completeness gate (SK-371). A release-triggering PR title
// (`feat`/`fix`/breaking) MUST carry a dated `changelog/` entry. This restores
// the coupling Changesets gave for free — no changeset → no release — now that
// release-please infers the bump from the Conventional-Commit PR title rather
// than an explicit file. Wired into ci.yml's build-and-lint job.
//
// "Release-triggering" mirrors release-please's default node bump table exactly:
// only `feat` (minor), `fix` (patch), and a `!` breaking marker (major) cut a
// release; `docs`/`chore`/`ci`/`refactor`/`perf`/`test`/`build`/`style` do not.
//
// Inputs (env, set by the workflow):
//   PR_TITLE — the pull request title (github.event.pull_request.title)
//   BASE_REF — the base branch name (github.base_ref); defaults to "main"
// Reads changed files from `git diff --name-only origin/<BASE_REF>...HEAD`.
// Pure functions live exported for vitest.

import { execFileSync } from "node:child_process";

const RELEASE_TRIGGERING_TYPE = /^(feat|fix)(\([^)]+\))?:/;
const BREAKING_SUBJECT = /^[a-z]+(\([^)]+\))?!:/;
const CHANGELOG_ENTRY = /^changelog\/.+\.md$/;

export function isReleaseTriggering(prTitle: string): boolean {
  const title = prTitle.trim();
  return BREAKING_SUBJECT.test(title) || RELEASE_TRIGGERING_TYPE.test(title);
}

export function hasChangelogEntry(changedFiles: readonly string[]): boolean {
  return changedFiles.some(
    (file) => CHANGELOG_ENTRY.test(file) && file !== "changelog/README.md",
  );
}

export type CompletenessResult = { ok: boolean; reason: string };

export function checkCompleteness(
  prTitle: string,
  changedFiles: readonly string[],
): CompletenessResult {
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

function readChangedFiles(baseRef: string): string[] {
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

function main(): void {
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
