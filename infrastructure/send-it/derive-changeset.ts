#!/usr/bin/env -S npx tsx
// Derives the deterministic bits of a /send-it changeset entry.
// Run: pnpm tsx infrastructure/send-it/derive-changeset.ts
//
// Fields:
//   slug : branch-name-derived filename for `.changeset/<slug>.md`
//   bump : major | minor | patch (per /send-it's bump heuristic)
//   body : a one-line draft summary (the slash command may rewrite this)
//
// Reads from git via `git branch --show-current` and `git log origin/main..HEAD`
// and prints JSON to stdout. Pure functions live exported for vitest.

import { execSync } from "node:child_process";

const SLUG_MAX = 60;

export function deriveSlug(branch: string): string {
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

export type Commit = { body: string; hash?: string; subject: string };
export type Bump = "major" | "minor" | "patch";

const BREAKING_SUBJECT = /^[a-z]+(\([^)]+\))?!:/;
const FEAT_SUBJECT = /^feat(\([^)]+\))?:/;

export function deriveBump(commits: readonly Commit[]): Bump {
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

export function deriveBody(commits: readonly Commit[]): string {
  if (commits.length === 0) {
    return "";
  }

  const subject = commits[0].subject;
  return subject.replace(/^[a-z]+(\([^)]+\))?!?:\s*/, "");
}

function resolveBaseRef(): null | string {
  for (const ref of ["origin/main", "main"]) {
    try {
      execSync(`git rev-parse --verify ${ref}`, { stdio: "ignore" });
      return ref;
    } catch {
      // ref doesn't exist; try next
    }
  }

  return null;
}

function readGitCommits(): Commit[] {
  const base = resolveBaseRef();
  if (!base) {
    return [];
  }

  const out = execSync(`git log ${base}..HEAD --format=%H%x1f%s%x1f%b%x1e`, {
    encoding: "utf8",
  });
  return out
    .split("\u001E")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, subject, body] = entry.split("\u001F");
      return { body: body ?? "", hash, subject: subject ?? "" };
    });
}

function readGitBranch(): string {
  return execSync("git branch --show-current", { encoding: "utf8" }).trim();
}

function main(): void {
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
