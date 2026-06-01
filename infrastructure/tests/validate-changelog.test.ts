import { validateEntry } from "../scripts/validate-changelog.js";
import { describe, expect, it } from "vitest";

const VALID_NAME = "20260523-145537-v1-0-3.md";

function entry(fm: string, body = "## Added\n\n- A change\n"): string {
  return `---\n${fm}\n---\n\n${body}`;
}

describe("validateEntry", () => {
  it("accepts a minimal backfilled historical entry (no branch/author/stats)", () => {
    const raw = entry(
      [
        'title: "Add inline per-rule docs"',
        'version: "1.0.3"',
        'created_at: "2026-05-23T14:55:37Z"',
        "category: docs",
        "breaking: false",
      ].join("\n"),
    );
    expect(validateEntry(VALID_NAME, raw)).toEqual([]);
  });

  it("accepts a fully-enriched in-flight entry", () => {
    const raw = entry(
      [
        'title: "Fix a thing"',
        'version: "1.2.0"',
        'created_at: "2026-05-23T14:55:37Z"',
        'merged_at: "2026-05-24T09:00:00Z"',
        'branch: "asw-123-fix-a-thing"',
        "pr: 42",
        'commit: "abc1234"',
        "merge_strategy: squash",
        'author: "you@example.com"',
        "co_authors: []",
        "category: fix",
        "breaking: false",
        'issues: ["ASW-123"]',
        "stats:",
        "  files_changed: 3",
        "  loc_added: 10",
        "  loc_removed: 2",
      ].join("\n"),
    );
    expect(validateEntry(VALID_NAME, raw)).toEqual([]);
  });

  it("rejects a bad filename", () => {
    const errors = validateEntry(
      "not-a-changelog.md",
      entry(
        'title: "x"\ncreated_at: "2026-05-23T14:55:37Z"\ncategory: fix\nbreaking: false',
      ),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/filename must match/);
  });

  it("flags each missing required field", () => {
    const errors = validateEntry(VALID_NAME, entry("release_note: null"));
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/missing required field: title/),
        expect.stringMatching(/missing required field: created_at/),
        expect.stringMatching(/missing required field: category/),
        expect.stringMatching(/missing required field: breaking/),
      ]),
    );
  });

  it("rejects a non-semver version", () => {
    const raw = entry(
      'title: "x"\nversion: "v1.0"\ncreated_at: "2026-05-23T14:55:37Z"\ncategory: fix\nbreaking: false',
    );
    expect(validateEntry(VALID_NAME, raw)).toEqual([
      expect.stringMatching(/version must be a semver string/),
    ]);
  });

  it("rejects a non-UTC created_at", () => {
    const raw = entry(
      'title: "x"\ncreated_at: "2026-05-23 14:55"\ncategory: fix\nbreaking: false',
    );
    expect(validateEntry(VALID_NAME, raw)).toEqual([
      expect.stringMatching(/created_at must be ISO 8601 UTC/),
    ]);
  });

  it("rejects a non-UTC merged_at", () => {
    const raw = entry(
      'title: "x"\ncreated_at: "2026-05-23T14:55:37Z"\ncategory: fix\nbreaking: false\nmerged_at: "2026-05-24"',
    );
    expect(validateEntry(VALID_NAME, raw)).toEqual([
      expect.stringMatching(/merged_at must be ISO 8601 UTC/),
    ]);
  });

  it("rejects a non-integer pr", () => {
    const raw = entry(
      'title: "x"\ncreated_at: "2026-05-23T14:55:37Z"\ncategory: fix\nbreaking: false\npr: "twelve"',
    );
    expect(validateEntry(VALID_NAME, raw)).toEqual([
      expect.stringMatching(/pr must be an integer/),
    ]);
  });

  it("rejects a commit that isn't a 7-char hex SHA", () => {
    const raw = entry(
      'title: "x"\ncreated_at: "2026-05-23T14:55:37Z"\ncategory: fix\nbreaking: false\ncommit: "abc"',
    );
    expect(validateEntry(VALID_NAME, raw)).toEqual([
      expect.stringMatching(/commit must be a 7-char hex SHA/),
    ]);
  });

  it("rejects an empty author when present", () => {
    const raw = entry(
      'title: "x"\ncreated_at: "2026-05-23T14:55:37Z"\ncategory: fix\nbreaking: false\nauthor: ""',
    );
    expect(validateEntry(VALID_NAME, raw)).toEqual([
      expect.stringMatching(/author must be a non-empty string/),
    ]);
  });

  it("rejects an invalid merge_strategy", () => {
    const raw = entry(
      'title: "x"\ncreated_at: "2026-05-23T14:55:37Z"\ncategory: fix\nbreaking: false\nmerge_strategy: "fast-forward"',
    );
    expect(validateEntry(VALID_NAME, raw)).toEqual([
      expect.stringMatching(/merge_strategy must be one of/),
    ]);
  });

  it("rejects an unknown category", () => {
    const raw = entry(
      'title: "x"\ncreated_at: "2026-05-23T14:55:37Z"\ncategory: nope\nbreaking: false',
    );
    expect(validateEntry(VALID_NAME, raw)).toEqual([
      expect.stringMatching(/category must be one of/),
    ]);
  });

  it("requires a ## Breaking section when breaking: true", () => {
    const raw = entry(
      'title: "x"\ncreated_at: "2026-05-23T14:55:37Z"\ncategory: fix\nbreaking: true',
      "## Changed\n\n- Something\n",
    );
    expect(validateEntry(VALID_NAME, raw)).toEqual([
      expect.stringMatching(/"## Breaking" as the first body section/),
    ]);
  });

  it("rejects breaking: true when ## Breaking is not the first section", () => {
    const raw = entry(
      'title: "x"\ncreated_at: "2026-05-23T14:55:37Z"\ncategory: fix\nbreaking: true',
      "## Added\n\n- New\n\n## Breaking\n\n- Migrate\n",
    );
    expect(validateEntry(VALID_NAME, raw)).toEqual([
      expect.stringMatching(/"## Breaking" as the first body section/),
    ]);
  });

  it("accepts breaking: true when ## Breaking is the first section", () => {
    const raw = entry(
      'title: "x"\ncreated_at: "2026-05-23T14:55:37Z"\ncategory: fix\nbreaking: true',
      "## Breaking\n\n- Migrate\n\n## Changed\n\n- Other\n",
    );
    expect(validateEntry(VALID_NAME, raw)).toEqual([]);
  });

  it("accepts a SemVer version with hyphenated prerelease/build identifiers", () => {
    const raw = entry(
      'title: "x"\nversion: "1.2.3-rc-1+build-45"\ncreated_at: "2026-05-23T14:55:37Z"\ncategory: fix\nbreaking: false',
    );
    expect(validateEntry(VALID_NAME, raw)).toEqual([]);
  });

  it("requires at least one body section", () => {
    const raw = entry(
      'title: "x"\ncreated_at: "2026-05-23T14:55:37Z"\ncategory: fix\nbreaking: false',
      "Just prose, no headings.\n",
    );
    expect(validateEntry(VALID_NAME, raw)).toEqual([
      expect.stringMatching(/body must contain at least one of/),
    ]);
  });

  it("rejects top-level stats keys", () => {
    const raw = entry(
      'title: "x"\ncreated_at: "2026-05-23T14:55:37Z"\ncategory: fix\nbreaking: false\nloc_added: 3',
    );
    expect(validateEntry(VALID_NAME, raw)).toEqual([
      expect.stringMatching(/loc_added must be under stats/),
    ]);
  });

  it("rejects malformed issue IDs", () => {
    const raw = entry(
      'title: "x"\ncreated_at: "2026-05-23T14:55:37Z"\ncategory: fix\nbreaking: false\nissues: ["nope-1"]',
    );
    expect(validateEntry(VALID_NAME, raw)).toEqual([
      expect.stringMatching(/must match \[A-Z\]/),
    ]);
  });
});
