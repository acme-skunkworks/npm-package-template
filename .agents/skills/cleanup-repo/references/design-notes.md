# cleanup-repo — design notes

## Why `cleanup-repo`, not `cleanup-branches`

The skill lifts an existing slash command called `/cleanup-branches`, but it is
named `cleanup-repo` deliberately:

- It already does more than branches — it removes **worktrees** (with an
  uncommitted-changes guard and detached-HEAD handling) and runs a
  **filesystem-hygiene** pass.
- The broader name leaves room for further repo-hygiene extensions without
  another rename.

Per-repo slash-command names are a consumer choice. A consumer can expose this as
`/cleanup-repo`, or keep `/cleanup-branches` as a friendlier alias.

## Initial scope

- Merged-worktree and merged-branch cleanup (two-pass detection), an opt-in Linear
  `Done` writeback, per-pass confirmation gates, and a `--dry-run` preview — at
  parity with `/cleanup-branches`.
- **New:** a filesystem-hygiene pass — recursively-empty directory pruning and
  orphan `node_modules/` pruning.

## Deliberate non-goals (v1)

- **The filesystem pass is not parameterised.** The placeholder allowlist
  (`.gitkeep`, `.gitignore`) is fixed, and the orphan-`node_modules` rule is fixed
  at the strict "no sibling `package.json`" check. Either can become a config knob
  in a future minor bump if a real consumer case demands it.
- **No workspace-membership inference** for orphan `node_modules/` — strict
  parent-`package.json` check only.
- **Single-snapshot removal within `apply()`.** `apply()` detects once and removes
  that snapshot; removing an orphan `node_modules/` can leave its parent empty, but
  that parent is left for a follow-up run rather than swept in the same snapshot.
  Note the skill runs the filesystem detection twice — a read-only pass for the
  preview, then `apply()` **after** worktree removal — so the apply pass may sweep a
  worktree parent (e.g. `.claude/worktrees/`) that the pre-removal preview could not
  yet see. The skill predicts these in the preview from the worktree-removal list.
- **Configurable merge-detection base branch.** *(Landed since v1 — no longer a
  non-goal.)* Both passes (git ancestry and merged-PR lookup) diff against
  `origin/<mainBranch>`, defaulting to `main`; the `mainBranch` config key (beside
  `protectedBranches`) covers `master` / `develop` trunks.

## Future extensions (out of scope, enabled by the name)

Each would be a follow-up issue and a minor version bump:

- Pruning stale local tags (`git tag --merged main` style).
- An optional reflog / garbage-collection trigger after large cleanups.
- Surfacing local branches with no upstream that have been stale for N days.
- Build-artifact cleanup (`dist/`, `build/`, `.next/`, `coverage/`, …) — only if a
  generalisable heuristic emerges; tool-specific cleanup stays the user's job.

Explicitly **not** planned: lockfile / package-manager cache cleanup
(`pnpm store prune`, npm/yarn caches) — a different concern on a different cadence.
