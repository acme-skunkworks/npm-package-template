#!/usr/bin/env node
// Release-time finalisation of changelog entries — run by the orchestrator
// right after `release-please release-pr` (A-380/A-376), so the result is
// committed into the release PR (no separate workflow, no bot push to main).
// Reads the just-bumped version from package.json, which release-please updated.
//
// For every entry that isn't finalised yet (empty `version`):
//   1. resolve its merged PR from the `branch` field via `gh` and enrich
//      (merged_at / commit / pr / merge_strategy / stats);
//   2. stamp `version` with the just-bumped package.json version;
//   3. rewrite bare Linear IDs to links.
//
// The pure `finaliseEntry(raw, version, resolvePr)` is unit-testable with a fake
// resolver; main() wires the real `gh`/`git` resolver and walks the directory.
//
// Zero-dep: composes the bundle's own modules (lib/enrich, lib/stamp,
// add-links) and the vendored frontmatter parser — no gray-matter, no tsx — so
// `pnpm changelog:finalise` runs under bare `node` (the orchestrator runs it
// with `--ignore-scripts`). The Linear workspace/issue keys come from config.json
// via add-links, not hardcoded constants.

import { rewriteBody, splitFrontmatter } from "./add-links.mjs";
import { nonMergeCommitCount } from "./lib/commit-count.mjs";
import { loadConfig } from "./lib/config.mjs";
import { enrichFrontmatter } from "./lib/enrich.mjs";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { readPackageVersion, stampVersion } from "./lib/stamp.mjs";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";

/**
 * @typedef {object} ResolvedPr
 * @property {null | string} additions Lines added (string), null when gh omits it.
 * @property {null | string} changedFiles Files changed (string), null when gh omits it.
 * @property {null | string} commits Non-merge commit count (string), null when unresolvable.
 * @property {null | string} deletions Lines removed (string), null when gh omits it.
 * @property {string} mergedAt PR merged_at timestamp (ISO 8601 UTC).
 * @property {string} mergeSha Merge commit SHA (full or short).
 * @property {null | string} mergeStrategy Inferred merge strategy, or null.
 * @property {string} prNumber PR number as a string.
 */

/**
 * True when a value is unset (null/undefined/"").
 * @param {unknown} value
 */
function blank(value) {
  return value === null || value === undefined || value === "";
}

/**
 * Finalise one entry's raw markdown for release. Returns the rewritten markdown,
 * or null when nothing changed (already finalised).
 * @param {string} raw entry markdown
 * @param {string} version version to stamp
 * @param {Function} resolvePr resolves a branch to its merged PR, or null
 * @returns {null | string}
 */
export function finaliseEntry(raw, version, resolvePr) {
  const fm = parseFrontmatter(raw).data;
  if (!blank(fm.version)) {
    return null; // already shipped in a release
  }

  let next = raw;

  const branch = typeof fm.branch === "string" ? fm.branch : "";
  // Include blank(fm.stats) so a hand-authored entry that pre-fills
  // merged_at/commit/pr but leaves stats blank still gets stats from the PR.
  // Also treat a populated-but-commits-less stats block as enrichable: an entry
  // finalised in the window between `stats` first existing (A-380) and
  // `stats.commits` being added (A-560) has every other field set, so without
  // the `stats.commits` check needsEnrich is false, enrich is skipped, the entry
  // is version-stamped, and the later line-63 short-circuit makes the missing
  // `commits` un-backfillable through finalise forever (A-579).
  const needsEnrich =
    blank(fm.merged_at) ||
    blank(fm.commit) ||
    blank(fm.pr) ||
    blank(fm.stats) ||
    blank(fm.stats?.commits);
  if (branch && needsEnrich) {
    const pr = resolvePr(branch);
    if (pr) {
      next = enrichFrontmatter(next, {
        additions: pr.additions,
        branch,
        changedFiles: pr.changedFiles,
        commits: pr.commits,
        deletions: pr.deletions,
        mergedAt: pr.mergedAt,
        mergeSha: pr.mergeSha,
        mergeStrategy: pr.mergeStrategy,
        prNumber: pr.prNumber,
      });
    }
  }

  next = stampVersion(next, version) ?? next;

  const { body, fm: fmText } = splitFrontmatter(next);
  next = fmText + rewriteBody(body);

  return next === raw ? null : next;
}

/**
 * @param {string} cmd command to run
 * @param {string[]} args command arguments
 * @returns {string} stdout
 */
function realRunner(cmd, args) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    // Fail fast if gh/git stalls (network/auth). Enrichment is best-effort, so
    // a timeout throws → makeResolver's try/catch falls back to null rather
    // than hanging the release until the whole job times out.
    timeout: 30_000,
  });
}

/**
 * Build a PR resolver backed by `gh` + `git` (injectable runner for tests).
 * @param {Function} run runs a command (cmd, args) and returns stdout
 * @returns {Function} resolver mapping a branch to its merged PR, or null
 */
export function makeResolver(run) {
  /**
   * @param {string} branch
   * @returns {null | ResolvedPr}
   */
  function resolve(branch) {
    const json = run("gh", [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "merged",
      "--limit",
      "1",
      "--json",
      "number,mergedAt,additions,deletions,changedFiles,mergeCommit,headRefOid",
    ]);
    const list = JSON.parse(json);
    if (list.length === 0) {
      return null;
    }

    const pr = list[0];
    const mergeSha = pr.mergeCommit?.oid ?? "";

    // Infer merge strategy from the merge commit shape (GitHub doesn't expose
    // it directly): 2+ parents -> merge; otherwise squash.
    // NOTE: rebase merges are also reported as "squash" — GitHub replays them
    // with fresh SHAs, so mergeCommit.oid never equals headRefOid and the
    // "rebase" branch below is effectively unreachable. This repo squash-merges
    // anyway, and merge_strategy is only record-keeping metadata, so the
    // imprecision is harmless.
    let mergeStrategy = null;
    if (mergeSha) {
      const parents = (
        run("git", ["cat-file", "-p", mergeSha]).match(/^parent /gm) ?? []
      ).length;
      if (parents >= 2) {
        mergeStrategy = "merge";
      } else {
        mergeStrategy = mergeSha === pr.headRefOid ? "rebase" : "squash";
      }
    }

    // Commit count is resolved separately (a second API call). Keep it
    // independently best-effort: a failure here leaves commits null but must NOT
    // discard the stats we already resolved, so it gets its own try/catch rather
    // than riding the outer one (which would null the whole ResolvedPr).
    let commits = null;
    if (pr.number !== undefined && pr.number !== null) {
      try {
        commits = nonMergeCommitCount(run, pr.number);
      } catch (error) {
        console.warn(
          `⚠️  Could not resolve commit count for PR #${pr.number}: ${error.message}`,
        );
      }
    }

    // Absent numeric fields stay null (not ""), so the enrich guard skips them
    // rather than parsing "" into NaN.
    return {
      additions: pr.additions === undefined ? null : String(pr.additions),
      changedFiles:
        pr.changedFiles === undefined ? null : String(pr.changedFiles),
      commits,
      deletions: pr.deletions === undefined ? null : String(pr.deletions),
      mergedAt: pr.mergedAt ?? "",
      mergeSha,
      mergeStrategy,
      prNumber: String(pr.number ?? ""),
    };
  }

  return (branch) => {
    // Enrichment is best-effort metadata: a gh/git failure here must NOT abort
    // the release-please release-PR build and block the release. On any error,
    // warn and return null — the entry still gets version-stamped, just without
    // PR metadata.
    try {
      return resolve(branch);
    } catch (error) {
      console.warn(
        `⚠️  Could not resolve PR for branch ${branch}: ${error.message}`,
      );
      return null;
    }
  };
}

const USAGE = `finalise-changelog — release-time enrich + version-stamp the dated changelog/ entries

Run by the release orchestrator right after \`release-please release-pr\`. Reads the
just-bumped version from package.json, then for every un-finalised entry: resolves
its merged PR via \`gh\`/\`git\` to enrich (merged_at/commit/pr/merge_strategy/stats),
stamps \`version\`, and rewrites bare Linear IDs to links. WRITES to changelog/ files.

Usage:
  node finalise-changelog.mjs            Finalise every un-finalised entry (writes; needs gh/git)
  node finalise-changelog.mjs --self-test  Run the built-in offline smoke test
  node finalise-changelog.mjs --help     Show this message (alias: -h)`;

// Offline smoke-test resolver — a fixed fake PR, no gh/git.
function fakeResolver() {
  return {
    additions: "10",
    changedFiles: "2",
    commits: "4",
    deletions: "3",
    mergedAt: "2026-01-02T00:00:00Z",
    mergeSha: "abcdef1234567890",
    mergeStrategy: "squash",
    prNumber: "42",
  };
}

// Offline smoke test: exercise the pure finaliseEntry with a fake resolver — no
// gh, no git, no real package.json, no filesystem writes. The exhaustive cases
// live in the repo's vitest suite (infrastructure/tests/finalise-changelog.test.ts).
function selfTest() {
  const cases = [];

  const unfinalised = `---
title: Sample
created_at: '2026-01-01T00:00:00Z'
merged_at:
branch: a-1-sample
pr:
commit:
merge_strategy:
version:
category: feature
breaking: false
stats:
  files_changed:
  loc_added:
  loc_removed:
---

## Added

- A thing.
`;
  const finalised = finaliseEntry(unfinalised, "1.2.3", fakeResolver);
  cases.push({
    name: "an un-finalised entry is rewritten",
    ok: typeof finalised === "string" && finalised !== unfinalised,
  });
  cases.push({
    name: "the bumped version is stamped",
    ok: typeof finalised === "string" && finalised.includes("version: 1.2.3"),
  });

  // An already-stamped entry is a no-op (returns null).
  const alreadyDone = (finalised ?? unfinalised).replace(/\n$/, "\n");
  cases.push({
    name: "an already-finalised entry returns null (no rewrite)",
    ok: finaliseEntry(alreadyDone, "1.2.3", fakeResolver) === null,
  });

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

  const config = loadConfig();
  const version = readPackageVersion(readFileSync("package.json", "utf8"));
  const resolvePr = makeResolver(realRunner);

  const files = readdirSync(config.changelogDir)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => join(config.changelogDir, name));

  let finalised = 0;
  for (const file of files) {
    const next = finaliseEntry(readFileSync(file, "utf8"), version, resolvePr);
    if (next !== null) {
      writeFileSync(file, next);
      finalised++;
      console.log(`finalised ${version}: ${file}`);
    }
  }

  console.log(
    `Changelog finalisation complete. ${finalised} entr${finalised === 1 ? "y" : "ies"} finalised with ${version}.`,
  );
}

// Only run the filesystem pass when invoked as a CLI, not when imported (e.g.
// by unit tests exercising finaliseEntry/makeResolver).
if (argv[1] && import.meta.filename === argv[1]) {
  main();
}
