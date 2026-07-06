#!/usr/bin/env node
// Post-merge enrichment of a single changelog entry — the DEPLOY-TARGET entry
// point the release orchestrator's `enrich-changelogs.yml` cron invokes on a
// checked-out target as `node scripts/enrich-changelog.mjs` (bare node, no
// install), one run per discovered entry.
//
// Deploy targets (octavo, shared-workflows) are never checked out during the
// release flow, so — unlike npm targets, which enrich at release time via
// `finalise-changelog.mjs` (`changelog:finalise`) — their entries can only be
// filled afterwards, from the cron. This is the writer that cron had no
// implementation for: it reads the per-PR data from the env-var interface below,
// finds the entry by its `branch:` field, fills the post-merge fields, and writes
// back.
//
// Env-var interface (all supplied by enrich-changelogs.yml):
//   BRANCH_NAME     the entry's branch — the lookup key       (required)
//   MERGED_AT       PR merged_at (ISO 8601 UTC)               (required)
//   MERGE_SHA       merge commit SHA (only first 7 stored)    (required)
//   MERGE_STRATEGY  merge | rebase | squash                   (optional)
//   PR_NUMBER       merged PR number                          (optional)
//   ADDITIONS       lines added   -> stats.loc_added          (optional)
//   DELETIONS       lines removed -> stats.loc_removed        (optional)
//   CHANGED_FILES   files changed -> stats.files_changed      (optional)
// The cron passes no commit count, so `stats.commits` is left to the release-time
// path; the pure transform needs no `GH_TOKEN` (the cron empties it).
//
// Thin re-serialising wrapper: it delegates the actual field logic to the
// built+tested `lib/enrich.mjs#enrichFrontmatter`, which re-serialises the
// frontmatter. That's safe here — entries reaching this cron were authored by the
// current `changelog` skill and are already canonical, so the round-trip is a
// formatting no-op (contrast `backfill-commits.mjs`, which splices to avoid
// churning older, differently-formatted backlog entries). Enrichment is fill-once
// via enrichFrontmatter's guards, so re-runs are idempotent.
//
// Zero-dep: composes the bundle's own lib modules, so it runs under bare `node`.

import { findEntryByBranch } from "./lib/changelog.mjs";
import { isCliEntry } from "./lib/cli-entry.mjs";
import { loadConfig } from "./lib/config.mjs";
import { enrichFrontmatter } from "./lib/enrich.mjs";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { argv, env } from "node:process";

/**
 * Map the orchestrator's env-var interface into an EnrichInput. Absent or empty
 * vars become null so enrichFrontmatter's `blank()` guards fire — and so
 * `Number.parseInt` is never handed `""` (which is NaN, and the validator rejects
 * it).
 * @param {Record<string, string | undefined>} environment the process env
 * @returns {import("./lib/enrich.mjs").EnrichInput}
 */
export function readEnvironmentInput(environment) {
  function read(name) {
    const value = environment[name];
    return value === undefined || value === "" ? null : value;
  }

  return {
    additions: read("ADDITIONS"),
    branch: read("BRANCH_NAME"),
    changedFiles: read("CHANGED_FILES"),
    deletions: read("DELETIONS"),
    mergedAt: read("MERGED_AT"),
    mergeSha: read("MERGE_SHA"),
    mergeStrategy: read("MERGE_STRATEGY"),
    prNumber: read("PR_NUMBER"),
  };
}

/**
 * Enrich one entry's raw markdown, returning the rewritten string — or null when
 * enrichment changes nothing (an already-filled entry, since enrichFrontmatter's
 * fill-once guards make a re-run a no-op). Lets callers detect no-ops without
 * diffing frontmatter.
 * @param {string} raw entry markdown
 * @param {import("./lib/enrich.mjs").EnrichInput} input
 * @returns {null | string}
 */
export function enrichEntry(raw, input) {
  const next = enrichFrontmatter(raw, input);
  return next === raw ? null : next;
}

const USAGE = `enrich-changelog — fill the post-merge fields of one changelog entry

The deploy-target post-merge enricher: reads a merged PR's data from env vars,
finds the entry by its branch, fills merged_at / commit / merge_strategy / pr /
stats via the shared enrich lib, and writes back. Fill-once and idempotent.

Env vars: BRANCH_NAME, MERGED_AT, MERGE_SHA (required); MERGE_STRATEGY, PR_NUMBER,
ADDITIONS, DELETIONS, CHANGED_FILES (optional).

Usage:
  node enrich-changelog.mjs             Enrich the entry for $BRANCH_NAME (writes)
  node enrich-changelog.mjs --check     Exit 1 if the entry still needs enriching
  node enrich-changelog.mjs --dry-run   Report what would change without writing
  node enrich-changelog.mjs --self-test Offline smoke test of the pure logic
  node enrich-changelog.mjs --help      Show this message (alias: -h)`;

/**
 * @param {boolean} condition
 * @param {string} message
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Offline smoke test of the pure logic — no filesystem, no network. Enriches an
 * in-memory placeholder and asserts the fields land and a re-run is a no-op.
 */
function selfTest() {
  const entry = [
    "---",
    'title: "Fix a thing"',
    'created_at: "2026-05-23T14:55:37Z"',
    'branch: "a-1-fix-a-thing"',
    "merged_at:",
    "pr:",
    "commit:",
    "merge_strategy:",
    "category: fix",
    "breaking: false",
    "---",
    "",
    "## Fixed",
    "",
    "- A thing",
    "",
  ].join("\n");
  const input = {
    additions: "10",
    branch: "a-1-fix-a-thing",
    changedFiles: "3",
    deletions: "2",
    mergedAt: "2026-05-24T09:00:00Z",
    mergeSha: "abc1234def5678",
    mergeStrategy: "squash",
    prNumber: "7",
  };

  const out = enrichEntry(entry, input);
  assert(out !== null, "expected enrichment to change the placeholder entry");
  const { data } = parseFrontmatter(/** @type {string} */ (out));
  assert(data.merged_at === "2026-05-24T09:00:00Z", "merged_at not filled");
  assert(data.commit === "abc1234", "commit not filled to 7 chars");
  assert(data.merge_strategy === "squash", "merge_strategy not filled");
  assert(data.pr === 7, "blank pr must be resolved from prNumber");
  assert(
    typeof data.stats === "object" &&
      data.stats !== null &&
      data.stats.loc_added === 10 &&
      data.stats.loc_removed === 2 &&
      data.stats.files_changed === 3,
    "stats not overwritten authoritatively",
  );
  assert(enrichEntry(out, input) === null, "re-run should be a no-op");
}

function main() {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  if (args.includes("--self-test")) {
    try {
      selfTest();
      console.log("✓ enrich-changelog self-test passed");
    } catch (error) {
      console.error(`✗ enrich-changelog self-test failed: ${error.message}`);
      process.exit(1);
    }

    return;
  }

  const check = args.includes("--check");
  const dryRun = args.includes("--dry-run");
  const input = readEnvironmentInput(env);

  // The cron always supplies these three; without them there is nothing to look
  // up or fill, so this is a misinvocation rather than a no-op.
  if (!input.branch || !input.mergedAt || !input.mergeSha) {
    console.error(
      "enrich-changelog: BRANCH_NAME, MERGED_AT and MERGE_SHA are required.\n",
    );
    console.error(USAGE);
    process.exit(2);
  }

  const path = findEntryByBranch(input.branch, loadConfig().changelogDir);
  if (path === null) {
    // Discovery upstream may race with the entry's own merge; a missing entry is
    // not the writer's failure to own — warn and succeed.
    console.warn(
      `enrich-changelog: no entry for branch '${input.branch}' — nothing to enrich.`,
    );
    return;
  }

  let next = null;
  try {
    next = enrichEntry(readFileSync(path, "utf8"), input);
  } catch (error) {
    console.error(`enrich-changelog: ${path}: ${error.message}`);
    process.exit(1);
  }

  if (next === null) {
    console.log(`already enriched: ${path}`);
    return;
  }

  if (check) {
    // Completeness gate: the entry still needs enriching.
    console.log(`would enrich: ${path}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`would enrich: ${path}`);
    return;
  }

  writeFileSync(path, next);
  console.log(`enriched: ${path}`);
}

// Only run the filesystem pass when invoked as a CLI, not when imported by tests.
if (isCliEntry(import.meta.filename)) {
  main();
}
