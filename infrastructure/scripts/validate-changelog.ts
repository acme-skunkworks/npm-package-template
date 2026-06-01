#!/usr/bin/env -S npx tsx
// Validates the individual dated changelog entries under `changelog/`.
//
// Ported from octavo's scripts/validate-changelog.mjs and adapted for this
// repo (single, semver'd npm package):
//   - `version` is accepted (typed-when-present semver string); octavo has none.
//   - `affected_packages` is dropped (one package, not a monorepo).
//   - the REQUIRED set is relaxed to title/created_at/category/breaking so that
//     both backfilled historical entries (no branch/author/stats) and in-flight
//     entries (no version/merged_at/pr/commit/stats until enriched) validate.
//     /send-it is the guarantee that new entries get branch/author/co_authors;
//     validation is the safety net, not the sole guard.
//
// The pure `validateEntry(name, raw)` returns an array of error strings (empty
// means valid), so it's trivially unit-testable; main() walks the directory.

import matter from "gray-matter";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

export const CHANGELOG_DIR = "changelog";

const FILENAME_RE = /^(\d{8})-(\d{6})-([a-z0-9-]+)\.md$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
// SemVer 2.0.0: prerelease and build identifiers are dot-separated and may
// contain ASCII alphanumerics and hyphens (e.g. 1.2.3-rc-1, 1.2.3+build-45).
const SEMVER_RE =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SHA7_RE = /^[0-9a-f]{7}$/;
const ISSUE_RE = /^[A-Z]{2,}-\d+$/;
const CATEGORIES = new Set([
  "chore",
  "docs",
  "feature",
  "fix",
  "perf",
  "refactor",
]);
const MERGE_STRATEGIES = new Set(["merge", "rebase", "squash"]);
const SECTION_RE = /^##\s+(Breaking|Added|Changed|Fixed)\b/m;

const REQUIRED = ["title", "created_at", "category", "breaking"] as const;

type Frontmatter = Record<string, unknown>;

/**
 * True when a value is set to something meaningful (not null/undefined/"").
 */
function present(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isNonNegInt(value: unknown): boolean {
  return isInt(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function asIso(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return "";
}

/**
 * Validate one entry. Returns an array of human-readable error strings.
 */
export function validateEntry(name: string, raw: string): string[] {
  const errors: string[] = [];
  function fail(message: string): void {
    errors.push(`${name}: ${message}`);
  }

  if (!FILENAME_RE.test(name)) {
    fail("filename must match YYYYMMDD-HHMMSS-<slug>.md (slug: [a-z0-9-]+)");
    return errors;
  }

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (error) {
    fail(`frontmatter unparseable: ${(error as Error).message}`);
    return errors;
  }

  const fm = (parsed.data ?? {}) as Frontmatter;
  const body = parsed.content ?? "";

  for (const key of REQUIRED) {
    if (!(key in fm)) {
      fail(`missing required field: ${key}`);
    }
  }

  if (
    "title" in fm &&
    (typeof fm.title !== "string" || fm.title.trim() === "")
  ) {
    fail("title must be a non-empty string");
  }

  if (
    "release_note" in fm &&
    fm.release_note !== null &&
    typeof fm.release_note !== "string"
  ) {
    fail("release_note must be a string or null when present");
  }

  if (
    present(fm.version) &&
    (typeof fm.version !== "string" || !SEMVER_RE.test(fm.version))
  ) {
    fail(
      `version must be a semver string when set (got ${JSON.stringify(fm.version)})`,
    );
  }

  if ("created_at" in fm && !ISO_UTC_RE.test(asIso(fm.created_at))) {
    fail(
      `created_at must be ISO 8601 UTC with Z suffix (got ${JSON.stringify(fm.created_at)})`,
    );
  }

  if (present(fm.merged_at) && !ISO_UTC_RE.test(asIso(fm.merged_at))) {
    fail("merged_at must be ISO 8601 UTC with Z suffix when set");
  }

  if (
    "branch" in fm &&
    (typeof fm.branch !== "string" || fm.branch.trim() === "")
  ) {
    fail("branch must be a non-empty string when present");
  }

  if (present(fm.pr) && !isInt(fm.pr)) {
    fail("pr must be an integer when set");
  }

  if (present(fm.commit) && !SHA7_RE.test(String(fm.commit))) {
    fail("commit must be a 7-char hex SHA when set");
  }

  if (
    present(fm.merge_strategy) &&
    !MERGE_STRATEGIES.has(String(fm.merge_strategy))
  ) {
    fail(`merge_strategy must be one of: ${[...MERGE_STRATEGIES].join(", ")}`);
  }

  if (
    "author" in fm &&
    (typeof fm.author !== "string" || fm.author.trim() === "")
  ) {
    fail("author must be a non-empty string when present");
  }

  if ("co_authors" in fm && !isStringArray(fm.co_authors)) {
    fail("co_authors must be an array of strings (use [] when none)");
  }

  if ("category" in fm && !CATEGORIES.has(String(fm.category))) {
    fail(`category must be one of: ${[...CATEGORIES].join(", ")}`);
  }

  if ("breaking" in fm && typeof fm.breaking !== "boolean") {
    fail("breaking must be a boolean");
  }

  if ("issues" in fm) {
    if (isStringArray(fm.issues)) {
      for (const id of fm.issues) {
        if (!ISSUE_RE.test(id)) {
          fail(`issues entry ${JSON.stringify(id)} must match [A-Z]{2,}-\\d+`);
        }
      }
    } else {
      fail("issues must be an array of strings when present");
    }
  }

  // PR stats live under stats: { files_changed, loc_added, loc_removed }.
  const statKeys = ["files_changed", "loc_added", "loc_removed"];
  for (const key of statKeys) {
    if (key in fm) {
      fail(`${key} must be under stats, not top-level`);
    }
  }

  // stats is optional (filled by enrichment), but must be a well-formed object
  // with non-negative integer values when present.
  if (present(fm.stats)) {
    if (typeof fm.stats !== "object" || Array.isArray(fm.stats)) {
      fail("stats must be an object");
    } else {
      const stats = fm.stats as Record<string, unknown>;
      for (const key of statKeys) {
        if (key in stats && present(stats[key]) && !isNonNegInt(stats[key])) {
          fail(`stats.${key} must be a non-negative integer when set`);
        }
      }
    }
  }

  // The schema (changelog/README.md) requires "## Breaking" to be the FIRST
  // body section when breaking: true — not merely present somewhere.
  if (fm.breaking === true) {
    const firstSection = body.match(/^##\s+([A-Za-z]+)\b/m)?.[1];
    if (firstSection !== "Breaking") {
      fail('breaking: true requires "## Breaking" as the first body section');
    }
  }

  if (!SECTION_RE.test(body)) {
    fail(
      "body must contain at least one of: ## Breaking | ## Added | ## Changed | ## Fixed",
    );
  }

  return errors;
}

function listEntries(directory: string): string[] {
  let stat;
  try {
    stat = statSync(directory);
  } catch {
    console.error(`changelog directory not found: ${directory}`);
    process.exit(2);
  }

  if (!stat.isDirectory()) {
    console.error(`${directory} is not a directory`);
    process.exit(2);
  }

  return readdirSync(directory)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => join(directory, name));
}

function main(): void {
  const files = listEntries(CHANGELOG_DIR);
  const errors: string[] = [];
  for (const file of files) {
    errors.push(...validateEntry(basename(file), readFileSync(file, "utf8")));
  }

  if (errors.length > 0) {
    console.error(
      `Changelog validation failed with ${errors.length} error(s):\n`,
    );
    for (const message of errors) {
      console.error(`  - ${message}`);
    }

    process.exit(1);
  }

  console.log(
    `Changelog validation passed (${files.length} entr${files.length === 1 ? "y" : "ies"} checked).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
