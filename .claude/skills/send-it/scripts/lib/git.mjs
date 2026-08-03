// Shared git helpers for the send-it bundle's zero-dependency scripts
// (derive-bump.mjs, check-skill-bumps.mjs). Node built-ins only — no build
// step, no tsx.
//
// `git log --format` field/record separators: %x1f (unit) between fields,
// %x1e (record) between commits. Kept here so both scripts agree on the
// encoding they parse.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const UNIT_SEP = "\u001F";
export const RECORD_SEP = "\u001E";

const CONFIG_PATH = new URL("../../config.json", import.meta.url);

/**
 * The configured trunk (`config.json` `baseBranch`), defaulting to `main` when
 * the file is absent, unreadable, or the key is missing/blank.
 * @returns {string}
 */
export function readBaseBranch() {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return typeof config.baseBranch === "string" && config.baseBranch.trim()
      ? config.baseBranch.trim()
      : "main";
  } catch {
    return "main";
  }
}

/**
 * Ordered, de-duplicated base-ref candidates to probe. `BASE_REF` (a per-run
 * override) wins, then the configured trunk (`origin/<baseBranch>` then the bare
 * `<baseBranch>`), then the `origin/main` → `main` fallback so an unset or
 * unresolvable `baseBranch` still resolves. With `baseBranch: "main"` the list
 * collapses to the original `[BASE_REF, origin/main, main]`.
 * @param {string} baseBranch
 * @param {string|undefined} [environmentBaseRef]
 * @returns {string[]}
 */
export function baseRefCandidates(
  baseBranch,
  environmentBaseRef = process.env.BASE_REF,
) {
  const trunk = (baseBranch || "main").trim() || "main";
  const ordered = [
    environmentBaseRef,
    `origin/${trunk}`,
    trunk,
    "origin/main",
    "main",
  ];
  return [...new Set(ordered.filter(Boolean))];
}

/**
 * Resolve the base ref to diff the branch against. Honours `config.json`'s
 * `baseBranch` (so a consumer whose trunk is `develop` diffs against
 * `origin/develop`), with `BASE_REF` overriding per-run and `origin/main` →
 * `main` as the final fallback. Returns null when none of the candidates exist
 * (e.g. a fresh repo with no trunk).
 */
export function resolveBaseRef() {
  const candidates = baseRefCandidates(readBaseBranch());
  for (const ref of candidates) {
    try {
      // execFileSync (no shell) — ref never reaches a shell, so a hostile
      // BASE_REF can't inject.
      execFileSync("git", ["rev-parse", "--verify", ref], { stdio: "ignore" });
      return ref;
    } catch {
      // ref doesn't exist; try next
    }
  }

  return null;
}

/**
 * `git log` argv for commits on HEAD not yet on `base`, newest first.
 * `--no-merges` keeps merge-commit subjects (often a PR title) out of the
 * bump scan so they are not double-counted against the branch's authored
 * commits under the dual merge policy (A-1176 / A-387 / A-824).
 * @param {string} base
 * @returns {string[]}
 */
export function gitLogRangeArgs(base) {
  return [
    "log",
    "--no-merges",
    `${base}..HEAD`,
    `--format=%H${UNIT_SEP}%s${UNIT_SEP}%b${RECORD_SEP}`,
  ];
}

/**
 * Commits on HEAD not yet on the base ref, newest first, as
 * `{ hash, subject, body }`. Empty array when there's no resolvable base.
 * Merge commits are excluded (see `gitLogRangeArgs`).
 */
export function readGitCommits() {
  const base = resolveBaseRef();
  if (!base) {
    return [];
  }

  const out = execFileSync("git", gitLogRangeArgs(base), { encoding: "utf8" });
  return out
    .split(RECORD_SEP)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, subject, body] = entry.split(UNIT_SEP);
      return { body: body ?? "", hash, subject: subject ?? "" };
    });
}

/**
 * The current branch name (empty string in a detached HEAD).
 */
export function readGitBranch() {
  return execFileSync("git", ["branch", "--show-current"], {
    encoding: "utf8",
  }).trim();
}
