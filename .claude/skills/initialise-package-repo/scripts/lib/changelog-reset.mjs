// Reset changelog/ to just its README.md in a spawned repo (A-663).
//
// The changelog-poisoning incident (2026-07-02): the template dogfoods its own
// changelog process, so `changelog/` accumulates dated entries documenting the
// TEMPLATE's development. "Use this template" copies them into the new repo, where
// the post-merge enricher would stamp the new package's first version onto every
// version-less entry and sweep them into its first release notes as noise. So the
// one correct state for a fresh repo is: changelog/ holding only README.md.
//
// `planChangelogReset` is a pure planner over a directory listing; the fs/git
// removal is the thin `resetChangelog` wrapper. Entries are removed with `git rm`
// when tracked (so the deletion is staged with the rest of the init) and plain
// unlink otherwise.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * The single file that must survive the reset.
 */
const KEEP = "README.md";

/**
 * Given the filenames in changelog/, return those to delete: every `.md` file
 * except README.md. Case-insensitive on the extension; README.md is matched
 * exactly (a `readme.md` in a spawned repo is unusual and better surfaced than
 * silently kept). Non-markdown files are left alone.
 * @param {string[]} filenames
 * @returns {string[]}
 */
export function planChangelogReset(filenames) {
  return filenames
    .filter((name) => name !== KEEP && /\.md$/i.test(name))
    .toSorted();
}

/**
 * Remove the dated changelog entries, keeping README.md. Idempotent: with only
 * README.md present the plan is empty and it is a clean no-op.
 * @param {{ dir: string, write?: boolean,
 *   run?: (args: string[], opts: object) => { status: number } }} opts
 * @returns {{ status: "reset" | "would-reset" | "clean", deleted: string[] }}
 */
export function resetChangelog({ dir, run = defaultRun, write = false }) {
  if (!existsSync(dir)) {
    return { deleted: [], status: "clean" };
  }

  const deleted = planChangelogReset(readdirSync(dir));
  if (deleted.length === 0) {
    return { deleted, status: "clean" };
  }

  if (!write) {
    return { deleted, status: "would-reset" };
  }

  const paths = deleted.map((name) => join(dir, name));
  // Stage the deletion via `git rm` so it rides along with the rest of the init
  // commit. `--ignore-unmatch` tolerates an already-untracked entry; anything git
  // can't remove (genuinely untracked) is swept by the fs fallback below.
  run(["rm", "--quiet", "--ignore-unmatch", "--", ...paths], {
    stdio: "ignore",
  });
  for (const path of paths) {
    if (existsSync(path)) {
      rmSync(path);
    }
  }

  return { deleted, status: "reset" };
}

function defaultRun(args, options) {
  return spawnSync("git", args, options);
}
