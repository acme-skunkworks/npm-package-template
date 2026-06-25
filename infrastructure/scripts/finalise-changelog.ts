#!/usr/bin/env -S npx tsx
// Release-time finalisation of changelog entries — run by the orchestrator
// right after `release-please release-pr` (SK-371/SK-376), so the result is
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

import { rewriteBody, splitFrontmatter } from "./add-links-changelog.js";
import { enrichFrontmatter } from "./enrich-changelog.js";
import { readPackageVersion, stampVersion } from "./stamp-changelog-version.js";
import matter from "gray-matter";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CHANGELOG_DIR = "changelog";

export type ResolvedPr = {
  additions: null | string;
  changedFiles: null | string;
  deletions: null | string;
  mergedAt: string;
  mergeSha: string;
  mergeStrategy: null | string;
  prNumber: string;
};

/**
 * Resolve the merged PR for a branch, or null when none is found.
 */
export type PrResolver = (branch: string) => null | ResolvedPr;

export type Runner = (cmd: string, args: readonly string[]) => string;

function blank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * Finalise one entry's raw markdown for release. Returns the rewritten markdown,
 * or null when nothing changed (already finalised).
 */
export function finaliseEntry(
  raw: string,
  version: string,
  resolvePr: PrResolver,
): null | string {
  const fm = matter(raw).data as Record<string, unknown>;
  if (!blank(fm.version)) {
    return null; // already shipped in a release
  }

  let next = raw;

  const branch = typeof fm.branch === "string" ? fm.branch : "";
  const needsEnrich = blank(fm.merged_at) || blank(fm.commit) || blank(fm.pr);
  if (branch && needsEnrich) {
    const pr = resolvePr(branch);
    if (pr) {
      next = enrichFrontmatter(next, {
        additions: pr.additions,
        branch,
        changedFiles: pr.changedFiles,
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

function realRunner(cmd: string, args: readonly string[]): string {
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
 */
export function makeResolver(run: Runner): PrResolver {
  function resolve(branch: string): null | ResolvedPr {
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
    const list = JSON.parse(json) as Array<{
      additions?: number;
      changedFiles?: number;
      deletions?: number;
      headRefOid?: string;
      mergeCommit?: { oid?: string };
      mergedAt?: string;
      number?: number;
    }>;
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
    let mergeStrategy: null | string = null;
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

    // Absent numeric fields stay null (not ""), so the enrich guard skips them
    // rather than parsing "" into NaN.
    return {
      additions: pr.additions === undefined ? null : String(pr.additions),
      changedFiles:
        pr.changedFiles === undefined ? null : String(pr.changedFiles),
      deletions: pr.deletions === undefined ? null : String(pr.deletions),
      mergedAt: pr.mergedAt ?? "",
      mergeSha,
      mergeStrategy,
      prNumber: String(pr.number ?? ""),
    };
  }

  return (branch: string): null | ResolvedPr => {
    // Enrichment is best-effort metadata: a gh/git failure here must NOT abort
    // the release-please release-PR build and block the release. On any error,
    // warn and return null — the entry still gets version-stamped, just without
    // PR metadata.
    try {
      return resolve(branch);
    } catch (error) {
      console.warn(
        `⚠️  Could not resolve PR for branch ${branch}: ${(error as Error).message}`,
      );
      return null;
    }
  };
}

function main(): void {
  const version = readPackageVersion(readFileSync("package.json", "utf8"));
  const resolvePr = makeResolver(realRunner);

  const files = readdirSync(CHANGELOG_DIR)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => join(CHANGELOG_DIR, name));

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

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
