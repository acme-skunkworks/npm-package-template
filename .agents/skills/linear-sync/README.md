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

The shipped [`config.json`](config.json) carries **ACME Skunkworks defaults**
(`linearTeamName` and `issueKeys`) — update them for your organisation on install,
or the state lookups will target the wrong team and branch issue-IDs won't match.
A neutral [`config.example.json`](config.example.json) ships alongside it as a
template — copy it over `config.json` and fill in your values, or edit
`config.json` directly.

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
