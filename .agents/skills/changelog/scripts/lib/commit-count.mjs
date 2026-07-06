// Resolve a merged PR's commit count EXCLUDING merge commits, via the GitHub
// REST commits endpoint. Shared by finalise-changelog (release-time enrichment)
// and backfill-commits (the one-off backlog backfill) — A-560.
//
// Squash-merging collapses a PR to a single commit on `main`, so the per-commit
// count is lost from local Git history — but the PR commits endpoint still
// returns the original branch commits post-merge, so the count stays
// recoverable. Excluding merge commits drops `main`-merge resolution commits
// (those with more than one parent) so the count reflects authored work rather
// than branch upkeep; the REST commit object's `parents` array is the reliable
// signal (`gh pr view --json commits` omits parent data).
//
// Runner-injectable `(cmd, args) -> stdout`, mirroring finalise-changelog's
// makeResolver, so it's unit-testable with a fake runner and never reaches the
// network in tests. `gh api --paginate` substitutes `{owner}`/`{repo}` from the
// repo's remote and merges the paged arrays, so PRs with more than one page of
// commits still count correctly.

/**
 * Count a merged PR's commits, excluding merge commits (more than one parent).
 * @param {(cmd: string, args: string[]) => string} run command runner
 * @param {number | string} prNumber merged PR number
 * @returns {null | string} the non-merge commit count as a string, or null when the response isn't an array. Throws (rather than returning null) if the gh output isn't valid JSON — a network/auth failure must surface to the caller, not be silently recorded as a count; both callers own that (finalise-changelog's resolver and backfill's main() each wrap the call).
 */
export function nonMergeCommitCount(run, prNumber) {
  const json = run("gh", [
    "api",
    "--paginate",
    `repos/{owner}/{repo}/pulls/${prNumber}/commits`,
  ]);
  const commits = JSON.parse(json);
  if (!Array.isArray(commits)) {
    return null;
  }

  // Exclude only commits we can positively identify as merges (>1 parent). The
  // REST commits endpoint always includes `parents`, so a missing/malformed
  // `parents` is anomalous — treat it as 0 parents (a normal commit) so we err
  // toward counting authored work rather than silently dropping it; a real merge
  // always arrives with its two parents present.
  const count = commits.filter(
    (commit) =>
      (Array.isArray(commit?.parents) ? commit.parents.length : 0) <= 1,
  ).length;
  return String(count);
}
