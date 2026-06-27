# cleanup-repo

Clean up a Git repository's merged branches and worktrees, then prune filesystem
cruft (recursively-empty directories and orphaned `node_modules/`) — behind
per-pass confirmation gates, with a `--dry-run` preview.

## Install

From any consumer repo:

```bash
npx skills add https://github.com/acme-skunkworks/agent-skills --skill cleanup-repo --agent claude-code --agent cursor --copy
```

`--copy` writes real files so the bundle is portable. Don't use `-g` / `--global`
— the install should live in the consumer repo.

## Configure

The shipped [`config.json`](config.json) carries **ACME Skunkworks defaults**
(`linearTeamName` and `issueKeys`) — update them for your organisation on install,
or the Linear lookups will target the wrong team and branch issue-IDs won't match.
A neutral [`config.example.json`](config.example.json) ships alongside it as a
template — copy it over `config.json` and fill in your values, or edit
`config.json` directly.

| Key | Meaning | Default |
| --- | --- | --- |
| `linearTeamName` | Linear team **name** used to resolve the live `Done` state. Stable across team-key renames. | `"ACME Skunkworks"` |
| `issueKeys` | Team-key prefixes that may appear in branch names; the issue-ID regex is built from these. | `["A"]` |
| `mainBranch` | Trunk a branch must be merged into to count as merged; both passes diff against `origin/<mainBranch>`. Set it for repos whose trunk isn't `main` (`master`, `develop`, …). | `"main"` |
| `protectedBranches` | Branches never deleted, locally or remotely. | `["main"]` |

> **Base branch.** The trunk defaults to `origin/main`; set the `mainBranch`
> config key for repositories on `master` / `develop` / similar — both merge
> passes (git ancestry and merged-PR lookup) diff against `origin/<mainBranch>`.

## Requirements

- `git` and `gh` CLIs (`gh` authenticated for the squash-merge detection pass).
- Node.js ≥22 (per the package's `engines`), for the bundled filesystem-hygiene script.
- The Linear MCP server is **optional**: the issue-status check and the `Done`
  writeback are skipped silently when it is unavailable.

## What it does

Two passes, confirmed separately (accept or decline each; `--branches-only` /
`--fs-only` run just one):

1. **Branch/worktree pass** — fetches and prunes, removes merged worktrees
   (guarding ones with uncommitted changes), deletes merged local and remote
   branches using two-pass detection (`git branch --merged origin/main` plus
   `gh pr list … --state merged` for squash-merges), optionally writes linked
   Linear issues back to `Done` (default no).
2. **Filesystem-hygiene pass** — removes top-most recursively-empty directories
   (placeholder-only `.gitkeep` / `.gitignore` directories are left alone; `.git/`
   is hard-protected) and orphaned `node_modules/` directories (those whose parent
   has no `package.json`). The two filesystem groups are surfaced separately.

## Behaviour parity

The **branch/worktree pass** is a faithful port of the `/cleanup-branches` slash
command (canonical reference: Octavo's `.claude/commands/cleanup-branches.md`):
the same two-pass merge detection, the same uncommitted-changes worktree guard,
the same protected-branch handling, and the same opt-in, default-no Linear `Done`
transition.

The **filesystem-hygiene pass is new** to this skill — it has no equivalent in
`/cleanup-branches`. A single bundled script computes the removal set once, so the
`--dry-run` preview lists exactly what a real run removes.

See [`references/design-notes.md`](references/design-notes.md) for the `cleanup-repo`
naming rationale and the future extensions the name deliberately leaves room for.
