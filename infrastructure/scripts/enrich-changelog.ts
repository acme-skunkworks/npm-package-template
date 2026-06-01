// Pure enrichment of a changelog entry's frontmatter — fills the fields that
// are only knowable once the PR has merged (merged_at / commit / merge_strategy
// / pr) plus authoritative stats. `version` is filled separately by
// stamp-changelog-version. created_at is never touched.
//
// This is a library module (no CLI): the release-time orchestrator
// finalise-changelog.ts composes it with the PR data it resolves from `gh`.
// Ported from octavo's enrich-changelog.mjs, minus affected_packages (single
// package). Kept pure so it's trivially unit-testable.

import matter from "gray-matter";

export type EnrichInput = {
  additions?: null | string;
  /**
   * Feature branch name — the stable lookup key.
   */
  branch: string;
  changedFiles?: null | string;
  deletions?: null | string;
  /**
   * PR merged_at timestamp (ISO 8601 UTC).
   */
  mergedAt: string;
  /**
   * Merge commit SHA (full or short); only the first 7 chars are stored.
   */
  mergeSha: string;
  mergeStrategy?: null | string;
  prNumber?: null | string;
};

/**
 * True when a value is unset (null/undefined/"").
 */
function blank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * Apply enrichment to a single entry's raw markdown and return the rewritten
 * markdown. Fill-once for merged_at/commit/merge_strategy/pr; authoritative
 * overwrite for stats. created_at is never touched.
 */
export function enrichFrontmatter(raw: string, input: EnrichInput): string {
  const parsed = matter(raw);
  const fm = { ...parsed.data } as Record<string, unknown>;

  if (!fm.created_at) {
    throw new Error("entry has no created_at; refusing to enrich");
  }

  const shortSha = input.mergeSha.slice(0, 7);

  if (blank(fm.merged_at)) {
    fm.merged_at = input.mergedAt;
  }

  if (blank(fm.commit)) {
    fm.commit = shortSha;
  }

  if (blank(fm.merge_strategy) && input.mergeStrategy) {
    fm.merge_strategy = input.mergeStrategy;
  }

  if (blank(fm.pr) && input.prNumber) {
    fm.pr = Number.parseInt(input.prNumber, 10);
  }

  // Authoritative overwrites from the GH API, always under stats: { ... }.
  const stats =
    typeof fm.stats === "object" &&
    fm.stats !== null &&
    !Array.isArray(fm.stats)
      ? { ...(fm.stats as Record<string, unknown>) }
      : {};
  // Guard with blank() (not just null/undefined): an empty string would slip
  // through and Number.parseInt("", 10) is NaN, which the validator rejects.
  if (!blank(input.additions)) {
    stats.loc_added = Number.parseInt(input.additions as string, 10);
  }

  if (!blank(input.deletions)) {
    stats.loc_removed = Number.parseInt(input.deletions as string, 10);
  }

  if (!blank(input.changedFiles)) {
    stats.files_changed = Number.parseInt(input.changedFiles as string, 10);
  }

  fm.stats = stats;

  return matter.stringify(parsed.content, fm);
}
