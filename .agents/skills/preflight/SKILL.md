---
name: preflight
description: >-
  Run a change-gated, branch-scoped lint preflight (ESLint / markdownlint /
  actionlint) on the files a branch changes versus its base, classify each
  violation as introduced vs pre-existing, and drive the fix/defer loop via an
  exit-code contract (0 pass, 1 introduced/blocking, 2 pre-existing only). Use
  when asked to run preflight, check whether a branch will pass lint before
  pushing, or as the lint gate inside a ship/PR flow. Lints only the categories
  the branch touched — not a whole-repo lint — with linted workspaces and the
  base branch auto-detected, so a consuming repo configures nothing in the
  common case.
license: MIT
compatibility: >-
  Requires Node.js ≥22 for the bundled scripts (no npm dependencies — Node
  built-ins only) and the `git` CLI for branch/diff analysis. ESLint,
  markdownlint-cli2, and actionlint are invoked from the consumer repo's own
  toolchain (via `pnpm exec`); markdownlint-cli2 and actionlint are optional —
  preflight warns and skips that category if its binary is absent. The optional
  Linear debt-issue step needs the Linear MCP server; skip it silently if
  unavailable.
metadata:
  version: 0.1.8
  author: Rob Easthope
allowed-tools: Read, Bash(git:*), Bash(pnpm:*), Bash(node:*), mcp__linear-server__save_issue, mcp__linear-server__list_issue_statuses
---

# preflight

Change-gated, branch-scoped lint preflight. It lints only the categories relevant
to `origin/<base>...HEAD`, on changed paths only — not a whole-repo `pnpm lint` —
then classifies each violation as **introduced** (on a line this branch added or
changed) or **pre-existing** (already there, in a file the branch happens to
touch).

This skill is the single source of truth for the preflight loop. It is invoked
two ways:

- **Standalone** (`/preflight`) — a quick "will my branch pass scoped lint?"
  check, leaving any fixes in the working tree.
- **Inside a ship flow** (e.g. `/send-it`) — the lint gate that runs after commits
  and before the changelog/push steps.

All bundled scripts use only Node built-ins — no `npm install`, no build step.
They operate on the **consumer repo's root** (run them from the repo root, where
`git` resolves the branch diff).

## Running it

1. Make sure the base branch is up to date: `git fetch origin <base>` (the base is
   auto-detected — see Configuration).
2. Run the preflight: `node skills/preflight/scripts/preflight.mjs` (append
   `--dry-run` to report categories and scoped file lists without classifying
   violations). `--dry-run` is a true preview — every linter reports `would-run`
   and nothing is written, including `.preflight-summary.json`.
3. Read `.preflight-summary.json` for the categories run and the violation counts
   (`passed`, `deferred`, `blocking`). Written only on a real run, not under
   `--dry-run`. It is a transient scratch artefact, never committed — consumer
   repos gitignore it (the `initialise-skills` skill adds the entry when it
   reconciles a repo).

The script's exit code drives the loop:

- **Exit 0 — pass.** No introduced violations and every linter ran cleanly.
  Continue.
- **Exit 1 — introduced violations (blocking).** Run
  `node skills/preflight/scripts/lint-fix.mjs` on the branch-scoped paths, then
  re-run preflight. Repeat until introduced violations clear or the user aborts.
  (Inside a ship flow, commit the fixes; standalone, leave them in the working
  tree for the user to review and commit.)
- **Exit 2 — pre-existing violations only.** Show the list and ask the user to
  choose:
  - **Fix now** — apply the fixes, (commit if shipping), re-run preflight.
  - **Defer** — open a debt issue in the project's tracker (assign the maintainer;
    link the branch/PR context), then decide whether to continue or abort.

Exit 1 can also signal a linter that failed to run (non-zero exit with no
parseable violations) — inspect its stderr; this is blocking too.

## Categories

Each category is gated on what the branch changed (mirrors CI path triggers,
narrower scope):

| Category     | Runs when                                                                   | Skipped when                                                                                                        |
| ------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| ESLint       | Branch diff includes lintable code or eslint/tsconfig config paths          | Markdown-only or non-lintable changes                                                                               |
| markdownlint | Branch diff includes `.md` / `.mdx` (respecting repo ignores)               | No markdown changes; warns and skips if the `markdownlint-cli2` binary is missing                                   |
| actionlint   | Branch diff includes `.github/workflows/*.yml` or `.github/actionlint.yaml` | No workflow changes; config-only changes lint all tracked workflows; warns and skips if `actionlint` binary missing |

ESLint runs per workspace (via `pnpm --filter`), plus a root/scripts bucket.
Typecheck, tests, and framework checks (e.g. `astro check`) are **not** part of
preflight — they stay in CI.

## Standalone vs inside a ship flow

- **Standalone (`/preflight`)** does the lint preflight and the exit-code loop,
  then **reports**. On introduced violations it may run
  `node skills/preflight/scripts/lint-fix.mjs` and re-run, but it leaves fixes
  **in the working tree** — it never commits, writes a changelog, pushes, or opens
  a PR.
- **Inside `/send-it`** the same loop runs as the lint gate (after commits, before
  changelog work); fixes are committed so the branch is clean before the changelog
  is written. The changelog and its validation are **separate gates owned by the
  ship flow** — they are not part of this skill.

## Configuration

The two repo-specific inputs are auto-detected — a consuming repo edits nothing in
the common case:

- **Linted workspaces** are derived from `pnpm-workspace.yaml` plus each package's
  `package.json`: a workspace is included only if it declares a `lint` script. This
  auto-excludes intentionally-unlinted workspaces and non-package directories
  without a hand-maintained list.
- **Base branch** is detected from `origin/HEAD` (e.g. `main`, `master`,
  `develop`), falling back to `main` when that symbolic ref is absent.

To override either, add a `preflight.config.json` at the **consumer repo root**
(a [`config.example.json`](config.example.json) ships beside this file as a
template):

```json
{
  "baseBranch": "main",
  "workspaces": {
    "web": { "filter": "@acme/web", "prefix": "apps/web/" }
  }
}
```

Either key may be supplied on its own; the other is still auto-detected. Use the
override for non-pnpm repos, deliberate exclusions, or nested workspace globs the
detector does not expand.

## Implementation

The bundled scripts live beside this file under
[`scripts/`](scripts/) and are invoked directly with `node` — no `pnpm` aliases,
no `npm install`:

- `scripts/preflight.mjs` — the change-gated preflight and exit-code contract.
- `scripts/lint-fix.mjs` — scoped `eslint --fix` / `markdownlint-cli2 --fix` on the
  branch-changed paths.
- `scripts/classify-lint.mjs` — parse + classify violations as introduced vs
  pre-existing.
- `scripts/lib/{scope,diff-lines,paths}.mjs` — shared helpers (workspace/base-branch
  detection, diff-line mapping, path normalisation).

They have no external npm dependencies (Node built-ins only).

## Arguments

$ARGUMENTS
