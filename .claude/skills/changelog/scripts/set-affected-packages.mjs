#!/usr/bin/env node
// Merge-time half of changelog enrichment.
//
// `affected_packages` is knowable before merge — it's just the set of workspace
// packages the branch diff touches — so the changelog step computes it at write
// time rather than waiting for a privileged post-merge step. This script reads
// the branch diff against the base, maps it through the shared
// `derivePackagesFromPaths` rule, and writes the result into the changelog entry
// for the current branch.
//
// The post-merge-only fields (`merged_at`, `commit`, `merge_strategy`, and
// authoritative `stats`) are deliberately NOT touched here — they're owned by
// the release-orchestrator and stay blank until it fills them.
//
// Env overrides (both optional):
//   BASE_REF    — base to diff against (default: origin/<baseBranch> from config.json)
//   BRANCH_NAME — entry lookup key (default: current branch via git)

import { findEntryByBranch } from "./lib/changelog.mjs";
import { isCliEntry } from "./lib/cli-entry.mjs";
import { loadConfig } from "./lib/config.mjs";
import { derivePackagesFromPaths } from "./lib/derive-packages.mjs";
import { parseFrontmatter, stringifyFrontmatter } from "./lib/frontmatter.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Rebuild an entry's frontmatter with `affected_packages` set, in canonical
 * field order (`affected_packages` immediately before `stats`).
 *
 * Guards against a destructive overwrite: if `data` is empty or lacks the
 * expected `branch` key — which is what `parseFrontmatter` returns when the
 * entry has no parseable frontmatter — throw rather than clobber the file with
 * just `affected_packages`.
 * @param {Record<string, unknown>} data parsed frontmatter data
 * @param {string[]} packages derived affected packages
 * @returns {Record<string, unknown>} the rebuilt frontmatter object
 */
export function buildAffectedPackagesFrontmatter(data, packages) {
  if (!data || typeof data !== "object" || !("branch" in data)) {
    throw new Error(
      "Refusing to write affected_packages: entry frontmatter is empty or " +
        "missing the `branch` key — parsing likely failed. Writing would " +
        "overwrite the entry with only affected_packages.",
    );
  }

  const fm = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "affected_packages") {
      continue; // re-inserted in its canonical slot below
    }

    if (key === "stats") {
      fm.affected_packages = packages;
    }

    fm[key] = value;
  }

  if (!("affected_packages" in fm)) {
    // No `stats` key to anchor against; append (a missing `stats` is itself a
    // contract violation the validator will flag).
    fm.affected_packages = packages;
  }

  return fm;
}

function git(args) {
  let out;
  try {
    out = execFileSync("git", args, { encoding: "utf8" });
  } catch (error) {
    // Most likely cause when run standalone: BASE_REF isn't fetched. In a ship
    // flow the base is fetched before this runs.
    console.error(`git ${args.join(" ")} failed: ${error.message}`);
    process.exit(1);
  }

  return out.trim();
}

function currentBranch() {
  const fromEnvironment = process.env.BRANCH_NAME?.trim();
  if (fromEnvironment) {
    return fromEnvironment;
  }

  return git(["rev-parse", "--abbrev-ref", "HEAD"]);
}

function changedPaths(base) {
  // Three-dot: files changed on the branch since it diverged from base, so
  // unrelated churn that landed on base meanwhile doesn't leak in.
  const out = git(["diff", "--name-only", `${base}...HEAD`]);
  return out ? out.split("\n") : [];
}

const USAGE = `set-affected-packages — write affected_packages into the current branch's changelog entry

Monorepo-only (config.json affectedPackages: true; a no-op otherwise). Diffs the
branch against the base, maps the changed paths through the shared package rule,
and writes the derived list into the entry's frontmatter (canonical field order).

Env overrides: BASE_REF (default origin/<baseBranch>), BRANCH_NAME (default git HEAD).

Usage:
  node set-affected-packages.mjs            Derive + write affected_packages (writes; needs git)
  node set-affected-packages.mjs --check    Report what would change; write nothing (alias: --dry-run)
  node set-affected-packages.mjs --self-test  Run the built-in offline smoke test
  node set-affected-packages.mjs --help     Show this message (alias: -h)`;

// Offline smoke test: exercise the pure buildAffectedPackagesFrontmatter — no
// git, no filesystem. The exhaustive cases live in the repo's vitest suite
// (tests/skills/changelog/set-affected-packages.test.ts).
function selfTest() {
  const cases = [];

  const data = {
    branch: "a-1-sample",
    stats: { files_changed: null },
    title: "Sample",
  };
  const rebuilt = buildAffectedPackagesFrontmatter(data, ["skills/changelog"]);
  cases.push({
    name: "affected_packages is set from the derived list",
    ok:
      JSON.stringify(rebuilt.affected_packages) ===
      JSON.stringify(["skills/changelog"]),
  });
  cases.push({
    name: "affected_packages is inserted immediately before stats",
    ok:
      Object.keys(rebuilt).indexOf("affected_packages") ===
      Object.keys(rebuilt).indexOf("stats") - 1,
  });

  let guardThrew = false;
  try {
    buildAffectedPackagesFrontmatter({}, ["x"]);
  } catch {
    guardThrew = true;
  }

  cases.push({
    name: "refuses to write when frontmatter lacks the branch key",
    ok: guardThrew,
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
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  if (args.includes("--self-test")) {
    selfTest();
    return;
  }

  // --check (alias --dry-run): report what would change and write nothing.
  // Exit 0 when already up to date, 1 when a rewrite is needed — prettier-style,
  // so CI can gate on it.
  const check = args.some(
    (argument) => argument === "--check" || argument === "--dry-run",
  );

  const config = loadConfig();

  // `affected_packages` is monorepo-only. Single-package repos leave
  // `affectedPackages: false` (the default) so entries stay clean — the field
  // is write-only and redundant there, and the validator treats it as
  // optional-when-present. No-op in both normal and --check modes so CI never
  // demands a rewrite. Genuine monorepos opt in via `affectedPackages: true`.
  if (!config.affectedPackages) {
    console.log(
      "affectedPackages is off (config.json sets it false, or omits it and it " +
        "defaults to false) — affected_packages not emitted. Nothing to set.",
    );
    process.exit(0);
  }

  const BASE_REF =
    process.env.BASE_REF?.trim() || `origin/${config.baseBranch}`;

  const branch = currentBranch();
  const file = findEntryByBranch(branch, config.changelogDir);
  if (!file) {
    console.log(
      `No changelog entry found for branch '${branch}'. Nothing to set.`,
    );
    process.exit(0);
  }

  const packages = derivePackagesFromPaths(changedPaths(BASE_REF), {
    changelogDir: config.changelogDir,
    fallbackPackage: config.fallbackPackage,
    packageRoots: config.packageRoots,
  });

  const raw = readFileSync(file, "utf8");
  const parsed = parseFrontmatter(raw);
  // Always overwrite (not fill-only like the post-merge fields): re-running must
  // re-derive affected_packages from the latest branch diff as commits are added.
  //
  // Rebuild in canonical field order via the guarded helper, which refuses to
  // write when the parse yielded empty/branch-less data (a destructive overwrite).
  const fm = buildAffectedPackagesFrontmatter(parsed.data, packages);
  const next = stringifyFrontmatter(parsed.content, fm);

  if (check) {
    if (next === raw) {
      console.log(`affected_packages already up to date on ${file}`);
      console.log(`  affected_packages=${JSON.stringify(packages)}`);
      process.exit(0);
    }

    console.log(`[check] would set affected_packages on ${file}`);
    console.log(`  branch=${branch} base=${BASE_REF}`);
    console.log(`  affected_packages=${JSON.stringify(packages)}`);
    process.exit(1);
  }

  writeFileSync(file, next);

  console.log(`Set affected_packages on ${file}`);
  console.log(`  branch=${branch} base=${BASE_REF}`);
  console.log(`  affected_packages=${JSON.stringify(packages)}`);
}

// Only run when invoked as a CLI, not when imported (e.g. by unit tests
// exercising `buildAffectedPackagesFrontmatter`).
if (isCliEntry(import.meta.filename)) {
  main();
}
