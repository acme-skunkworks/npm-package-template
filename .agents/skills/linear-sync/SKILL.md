---
name: linear-sync
description: >-
  Transition the Linear issues linked to the current branch through their
  workflow states (In Progress / In Review / Done) — resolve live state IDs by
  team name, extract issue IDs from the branch, and apply the transition
  idempotently. Use when starting work on an issue, when a PR opens or updates,
  during branch cleanup, or whenever a branch's Linear issues need their state
  synced. Resolves state IDs by team name (not key — keys go stale on rename),
  reads the team name and issue-ID prefixes from config.json, and skips any issue
  already at or past the target state.
license: MIT
compatibility: >-
  Requires the Linear MCP server (the `mcp__linear-server__*` tools). The branch
  read needs the `git` CLI. If the Linear MCP server is unavailable the skill
  cannot run — it has no non-MCP fallback.
metadata:
  version: 0.3.2
  author: Rob Easthope
allowed-tools: Read, Bash(git:*), mcp__linear-server__get_issue, mcp__linear-server__save_issue, mcp__linear-server__list_issue_statuses
---

# linear-sync

Move the Linear issues linked to the current branch through their workflow
states. This skill is the single source of truth for **how** issues are
transitioned: resolving the live state IDs, extracting issue IDs from a branch
name, and the per-state transition rules. Callers decide **when** and **whether**
to fire it; the mechanics live here once so the rules don't drift across the
ship flow, branch cleanup, and the start-of-work transition.

## Configuration

Two knobs live in [`config.json`](config.json) beside this file. Read it at the
start of a run and use its values throughout. Edit your copied `config.json` to
match the consuming repo:

| Key | Meaning | Default |
| --- | --- | --- |
| `linearTeamName` | Linear team **name** used to resolve the live state IDs. Use the name, not the key — the key is renamed over time but the name is stable. | `"ACME Skunkworks"` |
| `issueKeys` | Team-key prefixes that may appear in branch names. The issue-ID regex is built from these. | `["A"]` |

A neutral [`config.example.json`](config.example.json) ships alongside it as a
template — copy it over `config.json` and fill in your values, or edit
`config.json` directly.

## Usage modes

`--dry-run` is passed through `$ARGUMENTS` (the agent reads it), matching the
`--dry-run` "preview, change nothing" convention used across the other skills.

**Normal** — resolve state IDs, extract the branch's issue IDs, apply the
transition, and report what moved:

```bash
linear-sync
```

**Dry run** — resolve state IDs and each issue's current state, report the
intended transition (or skip reason) per issue, and exit **without any
`save_issue` call**:

```bash
linear-sync --dry-run
```

Under `--dry-run` the resolve + read steps still run (they are read-only), so the
preview is accurate; only the `save_issue` write in the transition step is
skipped. End the report with `DRY RUN — no issues were changed.`

## Resolving the target state (do this once per run)

Call `mcp__linear-server__list_issue_statuses` with `team: <linearTeamName>`
**once** to fetch the team's live workflow states. Each carries a stable `type`
(`triage` / `backlog` / `unstarted` / `started` / `completed` / `canceled`), a
display `name`, an `id`, and a `position`.

**Resolve the target by `type`, not by display name.** Display names are
customisable — a consumer may rename `In Progress` → `Doing` or `In Review` →
`Code Review` — so matching the literal name silently fails to find the state (the
biggest correctness gap for adopters). Map each transition to a concrete state:

- **In Progress** → the `started` state named "In Progress" (case-insensitive);
  else the **earliest** `started` by `position`.
- **In Review** → the `started` state whose name matches "In Review" / "Review";
  else, when there are ≥2 `started` states, the **latest** `started` by `position`;
  else the In Progress state.
- **Done** → the `completed` state named "Done"; else the **earliest** `completed`
  by `position`.

`started` covers both In Progress and In Review, so the name match (then `position`)
is what separates them; a team with a single `started` state resolves both targets
to it. Use the resolved `id` in the `save_issue` call.

**Pass the team _name_, not the key.** Linear state IDs are per-team, and a
workspace's team can be renamed over its lifetime (e.g. CAT → WTF → AKW → ASW),
so a hardcoded key goes stale. The team _name_ (`linearTeamName`) does not move.
This is the canonical gotcha for adopters — resolve by name, every run.

## Extracting issue IDs from the branch

Build the issue-ID regex **deterministically** — mirror the canonical, tested
`buildIssueRe` in the repo-root [`lib/issue-keys.mjs`](../../lib/issue-keys.mjs),
which `pnpm vendor:sync` copies into each consuming bundle (ADR-0004) and which
exists for exactly this job:

1. **Escape regex metacharacters** in each key (a configured key such as `C++`
   would otherwise throw or silently widen the match).
2. **Group the alternation.** Wrap the keys in `(?:…)` whenever there is more than
   one, so the `-\d+` binds to the whole alternation: `\b(?:A|B)-\d+\b`. The naive
   join `\bA|B-\d+\b` is **wrong** — it parses as `\bA` _or_ `B-\d+\b`, matching a
   bare `A` and missing `A-7`. A single key needs no wrapper: `\bA-\d+\b`.
3. **Guard the empty case.** With no configured keys, match nothing — never build
   an empty alternation (it would match the empty string before every `-<digits>`
   and inject bogus IDs like `-2`).

Match the result (with the `g` flag) against the **upper-cased** branch name —
branches like `asw-7-as-acquired` carry the key in lower case, and a flow such as
`--issue=A-7` produces upper-case branch names like `A-7-as-acquired`. Keeping the
legacy keys means leftover branches from before a team-key rename are still
recognised. Deduplicate the matches. Bogus or malformed IDs simply error on lookup
and are skipped with a warning — no separate validation pass.

When a caller already has an `issues` list to hand (e.g. a changelog step emits
one), use that instead of re-extracting.

## Transition rules

For each issue ID, call `mcp__linear-server__get_issue` to read its current state
(use its `type`, not its display name). Decide using the **progression order** of
state types:

```text
triage < backlog < unstarted < started < completed
```

`canceled` (which also covers a `Duplicate` state) is terminal and sits outside the
line. Within `started`, order by `position`, so In Progress precedes In Review. All
transitions are **idempotent**: apply only when the current state is **earlier** in
the progression than the resolved target; **skip** silently when the issue is
already **at or past** it, or when its current type is `completed` or `canceled`
(terminal states are never advanced automatically).

- **In Progress** (fired when starting work on an issue) — apply from `triage` /
  `backlog` / `unstarted`; skip from any `started`, `completed`, or `canceled`.
- **In Review** (fired on PR open/update inside a ship flow) — apply from `triage` /
  `backlog` / `unstarted`, or from a `started` state **earlier** by `position` than
  the resolved In Review (e.g. In Progress); skip once at or past In Review, or
  `completed` / `canceled`.
- **Done** (fired on branch cleanup) — apply from `triage` / `backlog` /
  `unstarted` / `started`; skip from `completed` / `canceled`.

Apply a transition with `mcp__linear-server__save_issue` using the **resolved state
`id`** — it is unambiguous across renames. The display-name form
`state: "<target>"` works only when the consumer kept Linear's default state names.

**Under `--dry-run`, skip this `save_issue` call.** Still read each issue's
current state with `get_issue` and decide whether it _would_ transition, but
report the intended move (e.g. `A-7: Todo → In Progress (would apply)` /
`A-9: In Review (would skip — already at/past target)`) instead of writing it.

> `Canceled` is the Linear API's own US spelling — keep it as-is when referenced
> in code or config.

## Caller responsibilities (when / whether to fire)

The skill owns the mechanics; each caller owns the policy:

- **Start of work** — transition to `In Progress` when work begins on an issue
  (unless already In Progress or further along). Run automatically; no prompt.
- **Ship flow** (PR open/update) — transition linked issues to `In Review`
  automatically after the PR is created or updated. No prompt.
- **Branch cleanup** — transition orphaned issues to `Done` only **after explicit
  confirmation, default no**. Linear's GitHub integration normally handles the
  `Done` transition on PR merge, so this prompt exists only for the rare case
  where the integration didn't fire (e.g. the issue ID was added after merge).

## Standalone vs inside a caller

- **Standalone** — resolve the target state, extract the branch's issue IDs,
  apply the transition, and report which issues moved and which were skipped. The
  default target is **In Progress** (the start-of-work transition that has no
  other home).
- **Inside a caller** — the caller supplies the target (and often the `issues`
  list) and decides whether to prompt; the mechanics above are unchanged.

## Implementation

No supporting scripts — the skill drives the Linear MCP tools directly
(`list_issue_statuses`, `get_issue`, `save_issue`). The only repo-specific inputs
are the team name and the issue-ID prefixes, both read from `config.json`.
