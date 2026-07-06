// The initialise-package-repo skill is vendored byte-for-byte into two trees —
// `.claude/skills/` (Claude Code) and `.agents/skills/` (Cursor). They must stay
// identical, but `eslint --fix` in pre-commit only touches `.agents/**` (the preset
// ignores `.claude/**`), which silently drifted the mirror once already (A-663).
// This test is the guard: it fails the moment the two trees diverge in file set or
// content, so a drift is caught in CI rather than shipped.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// This test lives at infrastructure/tests/<file>; the repo root is two levels up.
// Resolve from the module's own directory so it does not depend on the cwd.
const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SKILL = join("skills", "initialise-package-repo");
const CLAUDE = join(REPO_ROOT, ".claude", SKILL);
const AGENTS = join(REPO_ROOT, ".agents", SKILL);

/**
 * Repo-relative file paths under `root`, sorted, for a stable set comparison.
 */
function walk(root, base = root) {
  const found = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full, base));
    } else {
      found.push(relative(base, full));
    }
  }

  return found.toSorted();
}

describe("initialise-package-repo mirror parity", () => {
  it("ships the same set of files in both trees", () => {
    expect(walk(AGENTS)).toEqual(walk(CLAUDE));
  });

  it("ships byte-identical content in both trees", () => {
    for (const rel of walk(CLAUDE)) {
      expect(readFileSync(join(AGENTS, rel), "utf8"), `mismatch: ${rel}`).toBe(
        readFileSync(join(CLAUDE, rel), "utf8"),
      );
    }
  });
});
