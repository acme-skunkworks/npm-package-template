import { enrichFrontmatter } from "../scripts/enrich-changelog.js";
import type { EnrichInput } from "../scripts/enrich-changelog.js";
import matter from "gray-matter";
import { describe, expect, it } from "vitest";

const BASE: EnrichInput = {
  additions: "10",
  branch: "asw-123-fix-a-thing",
  changedFiles: "3",
  deletions: "2",
  mergedAt: "2026-05-24T09:00:00Z",
  mergeSha: "abc1234def5678",
  mergeStrategy: "squash",
  prNumber: "42",
};

function placeholderEntry(): string {
  return [
    "---",
    'title: "Fix a thing"',
    'created_at: "2026-05-23T14:55:37Z"',
    'branch: "asw-123-fix-a-thing"',
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
}

describe("enrichFrontmatter", () => {
  it("fills merged_at, commit (7 chars), merge_strategy, pr and overwrites stats", () => {
    const out = enrichFrontmatter(placeholderEntry(), BASE);
    const { data } = matter(out);
    expect(data.merged_at).toBe("2026-05-24T09:00:00Z");
    expect(data.commit).toBe("abc1234");
    expect(data.merge_strategy).toBe("squash");
    expect(data.pr).toBe(42);
    expect(data.stats).toEqual({
      files_changed: 3,
      loc_added: 10,
      loc_removed: 2,
    });
  });

  it("never overwrites an already-set fill-once field (idempotent re-run)", () => {
    const first = enrichFrontmatter(placeholderEntry(), BASE);
    const second = enrichFrontmatter(first, {
      ...BASE,
      mergedAt: "2099-01-01T00:00:00Z",
      mergeSha: "9999999",
      mergeStrategy: "rebase",
      prNumber: "999",
    });
    const { data } = matter(second);
    expect(data.merged_at).toBe("2026-05-24T09:00:00Z");
    expect(data.commit).toBe("abc1234");
    expect(data.pr).toBe(42);
    expect(data.merge_strategy).toBe("squash");
  });

  it("re-running still overwrites stats authoritatively", () => {
    const first = enrichFrontmatter(placeholderEntry(), BASE);
    const second = enrichFrontmatter(first, {
      ...BASE,
      additions: "100",
      changedFiles: "9",
      deletions: "5",
    });
    const { data } = matter(second);
    expect(data.stats).toEqual({
      files_changed: 9,
      loc_added: 100,
      loc_removed: 5,
    });
  });

  it("leaves created_at untouched", () => {
    const out = enrichFrontmatter(placeholderEntry(), BASE);
    expect(matter(out).data.created_at).toBe("2026-05-23T14:55:37Z");
  });

  it("does not introduce an affected_packages field", () => {
    const out = enrichFrontmatter(placeholderEntry(), BASE);
    expect(matter(out).data).not.toHaveProperty("affected_packages");
  });

  it("treats empty-string stat inputs as absent (no NaN written)", () => {
    const out = enrichFrontmatter(placeholderEntry(), {
      additions: "",
      branch: BASE.branch,
      changedFiles: "",
      deletions: "",
      mergedAt: BASE.mergedAt,
      mergeSha: BASE.mergeSha,
    });
    expect(matter(out).data.stats).toEqual({});
  });

  it("throws when created_at is missing", () => {
    const raw = "---\ntitle: x\nbranch: b\n---\n\n## Fixed\n\n- x\n";
    expect(() => enrichFrontmatter(raw, BASE)).toThrow(/no created_at/);
  });

  it("skips optional fields that aren't provided", () => {
    const out = enrichFrontmatter(placeholderEntry(), {
      branch: BASE.branch,
      mergedAt: BASE.mergedAt,
      mergeSha: BASE.mergeSha,
    });
    const { data } = matter(out);
    expect(data.commit).toBe("abc1234");
    expect(data.merged_at).toBe(BASE.mergedAt);
    // pr/merge_strategy stay as their (null) placeholders; stats stays empty.
    expect(data.stats).toEqual({});
  });
});
