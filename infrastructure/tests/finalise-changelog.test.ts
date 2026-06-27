import { finaliseEntry, makeResolver } from "../scripts/finalise-changelog.js";
import type { ResolvedPr, Runner } from "../scripts/finalise-changelog.js";
import matter from "gray-matter";
import { describe, expect, it } from "vitest";

const PR: ResolvedPr = {
  additions: "10",
  changedFiles: "3",
  deletions: "2",
  mergedAt: "2026-05-24T09:00:00Z",
  mergeSha: "abc1234def",
  mergeStrategy: "squash",
  prNumber: "42",
};

function placeholderEntry(): string {
  return [
    "---",
    'title: "Fix a thing"',
    "version:",
    'created_at: "2026-05-23T14:55:37Z"',
    "merged_at:",
    'branch: "a-123-fix-a-thing"',
    "pr:",
    "commit:",
    "category: fix",
    "breaking: false",
    'issues: ["A-123"]',
    "---",
    "",
    "## Fixed",
    "",
    "- A thing for A-123.",
    "",
  ].join("\n");
}

describe("finaliseEntry", () => {
  it("enriches, stamps version, and links an un-finalised entry", () => {
    const out = finaliseEntry(placeholderEntry(), "1.2.0", () => PR);
    expect(out).not.toBeNull();
    const { content, data } = matter(out as string);
    expect(data.version).toBe("1.2.0");
    expect(data.merged_at).toBe("2026-05-24T09:00:00Z");
    expect(data.commit).toBe("abc1234");
    expect(data.pr).toBe(42);
    expect(data.merge_strategy).toBe("squash");
    expect(data.stats).toEqual({
      files_changed: 3,
      loc_added: 10,
      loc_removed: 2,
    });
    expect(content).toContain(
      "[A-123](https://linear.app/acme-skunkworks/issue/A-123)",
    );
  });

  it("returns null for an already-finalised entry (version set)", () => {
    const raw = placeholderEntry().replace("version:", 'version: "1.0.0"');
    expect(finaliseEntry(raw, "1.2.0", () => PR)).toBeNull();
  });

  it("stamps + links even when no PR is found (resolver returns null)", () => {
    const out = finaliseEntry(placeholderEntry(), "1.2.0", () => null);
    const { data } = matter(out as string);
    expect(data.version).toBe("1.2.0");
    expect(data.merged_at ?? "").toBe(""); // not enriched
    expect(data.pr ?? "").toBe("");
  });

  it("does not call the resolver when the entry has no branch", () => {
    const raw = placeholderEntry().replace(
      'branch: "a-123-fix-a-thing"',
      "branch:",
    );
    let called = false;
    const out = finaliseEntry(raw, "9.9.9", () => {
      called = true;
      return PR;
    });
    expect(called).toBe(false);
    expect(matter(out as string).data.version).toBe("9.9.9");
  });
});

type Call = { args: readonly string[]; cmd: string };

function makeRunner(handlers: Record<string, () => string>): {
  calls: Call[];
  run: Runner;
} {
  const calls: Call[] = [];
  const run: Runner = (cmd, args) => {
    calls.push({ args, cmd });
    const key = `${cmd} ${args.join(" ")}`;
    for (const prefix of Object.keys(handlers).sort(
      (a, b) => b.length - a.length,
    )) {
      if (key.startsWith(prefix)) {
        return handlers[prefix]();
      }
    }

    return "";
  };

  return { calls, run };
}

describe("makeResolver", () => {
  it("maps gh JSON to ResolvedPr and infers squash from a single-parent merge", () => {
    const { run } = makeRunner({
      "gh pr list": () =>
        JSON.stringify([
          {
            additions: 10,
            changedFiles: 3,
            deletions: 2,
            headRefOid: "head999",
            mergeCommit: { oid: "merge111" },
            mergedAt: "2026-05-24T09:00:00Z",
            number: 42,
          },
        ]),
      "git cat-file": () => "tree x\nparent p1\nauthor a\n",
    });
    const resolved = makeResolver(run)("a-123-fix-a-thing");
    expect(resolved).toEqual({
      additions: "10",
      changedFiles: "3",
      deletions: "2",
      mergedAt: "2026-05-24T09:00:00Z",
      mergeSha: "merge111",
      mergeStrategy: "squash",
      prNumber: "42",
    });
  });

  it("infers merge from a 2-parent merge commit", () => {
    const { run } = makeRunner({
      "gh pr list": () =>
        JSON.stringify([{ mergeCommit: { oid: "m" }, number: 1 }]),
      "git cat-file": () => "tree x\nparent p1\nparent p2\n",
    });
    expect(makeResolver(run)("b")?.mergeStrategy).toBe("merge");
  });

  it("returns null when no merged PR is found", () => {
    const { run } = makeRunner({ "gh pr list": () => "[]" });
    expect(makeResolver(run)("missing")).toBeNull();
  });

  it("returns null (does not throw) when gh fails, so the release isn't blocked", () => {
    const run: Runner = () => {
      throw new Error("gh: API rate limit exceeded");
    };

    expect(makeResolver(run)("any-branch")).toBeNull();
  });

  it("returns null mergeStrategy when the PR has no merge commit", () => {
    const { run } = makeRunner({
      "gh pr list": () => JSON.stringify([{ number: 1 }]),
    });
    expect(makeResolver(run)("b")?.mergeStrategy).toBeNull();
  });

  it("returns null stat fields when gh omits them (so no NaN is written)", () => {
    const { run } = makeRunner({
      "gh pr list": () =>
        JSON.stringify([{ mergeCommit: { oid: "m" }, number: 7 }]),
      "git cat-file": () => "tree x\nparent p1\n",
    });
    const resolved = makeResolver(run)("b");
    expect(resolved?.additions).toBeNull();
    expect(resolved?.deletions).toBeNull();
    expect(resolved?.changedFiles).toBeNull();
  });
});
