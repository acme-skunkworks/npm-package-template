// Zero-dep git helpers for host-repo fact detection (A-409).
//
// `detectBaseBranch` delegates to the canonical, vendored lib/base-branch.mjs
// (ADR-0004 / A-534) — shared with the preflight bundle rather than hand-copied,
// with `pnpm vendor:check` gating drift. Re-exported here (with this bundle's
// own default) so callers keep importing it from `./git.mjs`.
//
// The pure parsers (`parseIssueKeysFromBranches`) take their input as arguments
// so they are unit-testable without a real repository; only the thin `git*`
// wrappers shell out.

import { detectBaseBranch as detectBaseBranchVendored } from "./vendor/base-branch.mjs";
import { spawnSync } from "node:child_process";

const DEFAULT_BASE_BRANCH = "main";

/**
 * Resolve the default branch from `origin/HEAD` (e.g. main, master, develop),
 * falling back to `main` when the symbolic ref is absent.
 * @param {string} root
 * @returns {string}
 */
export function detectBaseBranch(root) {
  return detectBaseBranchVendored(root, DEFAULT_BASE_BRANCH);
}

/**
 * All branch names known to the repo (local + remote), one per line, with only
 * the ref namespace stripped (`refs/heads/` or `refs/remotes/<remote>/`) so an
 * embedded slash in a branch name survives. `--format=%(refname)` carries no
 * `*`/`+`/`HEAD ->` decorations, so the bare `HEAD` symbolic ref is the only
 * thing to drop. Returns [] when git fails (e.g. no repo).
 * @param {string} root
 * @returns {string[]}
 */
export function listBranchNames(root) {
  const result = spawnSync("git", ["branch", "-a", "--format=%(refname)"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return [];
  }

  return (
    result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      // Strip only the ref namespace — `refs/heads/` for a local branch or
      // `refs/remotes/<remote>/` for a tracking ref — so an embedded slash in the
      // branch name (a local `A-123/demo`) survives for key extraction (A-580).
      // `%(refname)` (full ref) carries no `HEAD ->` decoration; the symbolic ref
      // collapses to a bare `HEAD`, which we drop.
      .map((name) => name.replace(/^refs\/(?:heads|remotes\/[^/]+)\//, ""))
      .filter((name) => name !== "HEAD")
  );
}

/**
 * Branch names known to the repo (local + remote), ordered **most-recently
 * committed first** via `git for-each-ref --sort=-committerdate`, de-duplicated
 * keeping the first (most recent) occurrence. Querying both `refs/heads` and
 * `refs/remotes` means a branch and its tracking ref collapse to one name after
 * the remote-prefix strip. Returns [] when git fails (e.g. no repo). The ordering
 * is what lets issue-key detection prefer the current key over historical (A-556).
 * @param {string} root
 * @returns {string[]}
 */
export function listBranchNamesByRecency(root) {
  const result = spawnSync(
    "git",
    [
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname)",
      "refs/heads",
      "refs/remotes",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    return [];
  }

  const seen = new Set();
  return (
    result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      // Strip only the ref namespace (`refs/heads/` or `refs/remotes/<remote>/`)
      // so an embedded slash in the branch name survives for key extraction
      // (A-580), then drop the bare `HEAD` the symbolic remote ref collapses to.
      .map((name) => name.replace(/^refs\/(?:heads|remotes\/[^/]+)\//, ""))
      .filter((name) => name !== "HEAD")
      .filter((name) => {
        if (seen.has(name)) {
          return false;
        }

        seen.add(name);
        return true;
      })
  );
}

/**
 * Extract Linear-style issue-key prefixes from a list of branch names. A key is
 * the leading `<KEY>-<number>` segment (e.g. `asw-12-add-thing` → `ASW`,
 * `a-558-thing` → `A`). Uppercase-normalised, de-duplicated, sorted for stable
 * output. Accepts a **single-letter** key so a one-letter Linear team key (e.g.
 * `A`) is detected (A-556); `v1-release`-style branches are still excluded because
 * the digit follows the letter directly, with no `-` in between.
 * @param {string[]} branches
 * @returns {string[]}
 */
export function parseIssueKeysFromBranches(branches) {
  const keys = new Set();
  for (const branch of branches) {
    const match = /^([A-Za-z]+)-\d+/.exec(branch);
    if (match) {
      keys.add(match[1].toUpperCase());
    }
  }

  return [...keys].toSorted();
}

/**
 * Pick the *current* issue key(s) from branches given **most-recent-first**. Walks
 * in recency order and returns the key(s) of the first branch that carries one, so
 * a repo whose Linear team was renamed (…→ASW→SK→A) yields the active key from a
 * recent branch rather than the union of every historical prefix on stale branches
 * (A-556). Returns [] when no branch carries a key.
 * @param {string[]} branchesByRecency
 * @returns {string[]}
 */
export function currentIssueKeys(branchesByRecency) {
  for (const branch of branchesByRecency) {
    const keys = parseIssueKeysFromBranches([branch]);
    if (keys.length > 0) {
      return keys;
    }
  }

  return [];
}

/**
 * Convenience: detect the current issue key(s) straight from the repo's branch
 * list, preferring the most recently committed branch's prefix (A-556). Override
 * with `facts.issueKeys` when the recency heuristic is wrong (e.g. a brand-new repo
 * with no keyed branches yet, or one genuinely using several keys).
 * @param {string} root
 * @returns {string[]}
 */
export function detectIssueKeys(root) {
  return currentIssueKeys(listBranchNamesByRecency(root));
}
