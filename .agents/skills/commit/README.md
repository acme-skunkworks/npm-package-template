# commit

Turn the working tree into logical, atomic **Conventional Commits** — classify
uncommitted files as in-scope vs out-of-scope against the branch's merge base,
show a staging plan, and create one commit per coherent change. It **never** `git
add -A`s: files that look like they belong to another branch or worktree are
flagged and never staged silently. It commits only — no push, PR, changelog, or
Linear writeback.

## Install

From any consumer repo:

```bash
npx skills add https://github.com/acme-skunkworks/agent-skills --skill commit --agent claude-code --agent cursor --copy
```

`--copy` writes real files so the bundle is portable. Don't use `-g` / `--global`
— the install should live in the consumer repo.

## Requirements

- The `git` CLI, for status/diff/merge-base analysis and to create the commits.
- **No npm dependencies and no build step** — this is a contract-only skill (the
  grouping logic is model-driven; [`SKILL.md`](SKILL.md) is the source of truth).

## Configure

The one repo-specific input is `baseBranch` — the trunk the branch diff is taken
against (`origin/<baseBranch>`), used to compute the merge base for scope
classification. It defaults to `main`. To override, edit the copied
`config.json` (a [`config.example.json`](config.example.json) ships as a
template):

```json
{
  "baseBranch": "main"
}
```

## What it does

Run standalone as `/commit`, or as the commit step inside a ship flow (e.g.
`/send-it`, which delegates its commit step to this skill). See
[`SKILL.md`](SKILL.md) for the full contract: the in-scope/out-of-scope
classification, the staging-plan confirmation, the atomic-grouping rules, and the
Conventional Commits formatting (including `!` / `BREAKING CHANGE:` markers).
