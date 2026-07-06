# linear-sync

Transition the Linear issues linked to the current branch through their workflow
states (In Progress / In Review / Done) — resolving state IDs by team **name**,
extracting issue IDs from the branch, and applying the transition idempotently.

## Install

From any consumer repo:

```bash
npx skills add https://github.com/acme-skunkworks/agent-skills --skill linear-sync --agent claude-code --agent cursor --copy
```

`--copy` writes real files so the bundle is portable. Don't use `-g` / `--global`
— the install should live in the consumer repo.

## Configure

This skill ships only [`config.example.json`](config.example.json), a neutral
template — the per-skill `config.json` is generated on install, not vendored, so
you never inherit another repo's values. Run the `initialise-skills` skill to
generate `config.json` from the example with your repo's facts, or copy it to
`config.json` and fill it in by hand. Set `linearTeamName` and `issueKeys` for
your organisation, or the state lookups will target the wrong team and branch
issue-IDs won't match.

| Key | Meaning | Default |
| --- | --- | --- |
| `linearTeamName` | Linear team **name** used to resolve live state IDs. Stable across team-key renames — always resolve by name, not key. | `"ACME Skunkworks"` |
| `issueKeys` | Team-key prefixes that may appear in branch names; the issue-ID regex is built from these. | `["A"]` |

## Requirements

- The Linear MCP server (the `mcp__linear-server__*` tools). The skill drives it
  directly and has no non-MCP fallback — if it is unavailable, the skill cannot run.
- The `git` CLI, to read the current branch name.

## What it does

Resolves the target state's live ID once (by team name), extracts the branch's
issue IDs (from `issueKeys`), reads each issue's current state, and applies the
target transition idempotently — skipping any issue already at or past it. The
default standalone target is **In Progress** (the start-of-work transition).

See [`SKILL.md`](SKILL.md) for the full transition-rules table, the
team-name-not-key gotcha, and the caller-responsibility (when/whether to fire)
boundaries.
