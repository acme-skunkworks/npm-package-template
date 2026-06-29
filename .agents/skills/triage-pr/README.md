# triage-pr

Take a pull request from **draft + failing CI** to **merge-ready**: fix in-scope
CI failures while the PR is a draft, then — once a human marks it ready — fetch
the unresolved AI review feedback, validate each finding, fix the valid ones and
decline the invalid ones with reasoning, and re-watch CI until green.

## Install

From any consumer repo:

```bash
npx skills add https://github.com/acme-skunkworks/agent-skills --skill triage-pr --agent claude-code --agent cursor --copy
```

`--copy` writes real files so the bundle is portable. Don't use `-g` / `--global`
— the install should live in the consumer repo.

## Configure

Edit [`config.json`](config.json) in your installed copy:

| Key | Meaning | Default |
| --- | --- | --- |
| `reviewBots` | GitHub login names whose comments and threads are treated as first-class AI review feedback (matched on `author.login`; the `[bot]` suffix is normalised, so `claude` and `claude[bot]` both match). Edit to match your install — review-bot logins vary per repo. `github-actions` is excluded by default (it posts CI/release comments, not code review); add it only if your install posts review-type comments via the Actions bot. | `["claude", "cursor", "coderabbitai"]` |
| `maxCiRounds` | Maximum Phase-A re-watch iterations before stopping and reporting blockers — bounds the fix-and-watch loop. | `5` |
| `replyOnAccept` | Whether an **accepted** finding gets a factual thread reply referencing the fixing commit before the thread is resolved (the audit trail). `false` resolves accepted threads silently; declines always reply with reasoning regardless. | `true` |
| `promoteOnGreen` | The single control for the draft→ready flip. When `true`, after Phase A finishes with every required check genuinely green on a **draft** PR, run `gh pr ready <pr>` to flip it to ready-for-review (the gate that turns AI review on), then continue into Phase B — instead of stopping at green. **Default-on**, and an enabled config *is* the human authorisation for the flip: proceed on proven green without seeking a separate sign-off. Set `false` (or pass `--no-promote`) to opt out and stop at green. Gated on proven-green CI, no unresolved human review threads, and no unresolved base drift; an explicit user prompt — or `--promote` / `--no-promote` — overrides it per run, and `--ci-only` / `--dry-run` never promote. | `true` |

## Requirements

- `gh` CLI, authenticated (`gh auth status` must pass) — used for checks, logs,
  review threads, and thread resolution.
- `git`.
- Node.js >=22 (ES-module support), for the bundled review-thread fetcher.

## What it does

Two phases, chosen from the PR's draft state:

1. **Phase A — while the PR is a draft.** Inspect failing checks with `gh`, pull
   the failing GitHub Actions logs, and fix failures **in PR scope only** — never
   weakening CI config to greenwash. Rebase/merge the base branch when failures
   are upstream drift. Loop until CI is green (then stop) or report blockers.
2. **Phase B — after the PR is ready-for-review.** AI review is gated on
   `draft == false`, so it only runs once the PR is ready-for-review (flipped by
   `promoteOnGreen` or a human). Fetch the
   **unresolved** review threads (bundled `scripts/review-threads.mjs` returns
   minimal JSON), validate each finding against the codebase before changing
   anything, fix the valid ones, decline the invalid ones with technical
   reasoning, then loop back through Phase A.

**By default the skill promotes a cleanly-green draft to ready** (`promoteOnGreen` is
on) — `promoteOnGreen` is the single control for the flip, and an enabled config *is*
the human authorisation for it, so the skill runs `gh pr ready` once Phase A proves CI
green and carries on into Phase B without seeking a separate sign-off. Set
`promoteOnGreen: false` (or pass `--no-promote`) to opt out and stop at green; an
explicit user prompt — or `--promote` / `--no-promote` — overrides the config per run.
Promotion is gated on proven-green CI, no unresolved human review threads, and no
unresolved base drift, and merge to `main` stays a human action. It actions only the
configured `reviewBots`; human review comments are surfaced in the report but left for
the human.

The review-discipline rules folded into Phase B (verify before implementing, no
sycophancy, evidence before claims) live in
[`references/review-discipline.md`](references/review-discipline.md).
