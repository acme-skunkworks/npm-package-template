# triage-pr

Take a pull request from **draft + failing CI** to **merge-ready**: fix in-scope
CI failures while the PR is a draft, then — by default — promote the cleanly-green
draft to ready (`promoteOnGreen`), wait for AI reviewers, verify-then-propose
dispositions, and **halt for a human envelope** before applying accepts, declines,
or Linear follow-ups. Opt out of the envelope with `--auto-apply` (or
`humanEnvelope: false`) to restore legacy auto Phase B. Opt out of promotion with
`--no-promote` (or `promoteOnGreen: false`) to stop at green for a human to flip;
the final merge to the trunk always stays with a human.

## Install

From any consumer repo:

```bash
npx skills add https://github.com/rheged-studio/agent-skills --skill triage-pr --agent claude-code --agent cursor --copy
```

`--copy` writes real files so the bundle is portable. Don't use `-g` / `--global`
— the install should live in the consumer repo.

## Configure

This skill ships only [`config.example.json`](config.example.json), a template —
the per-skill `config.json` is generated on install, not vendored. Run the
`initialise-skills` skill to generate `config.json`, or copy the example to
`config.json`, then edit it in your installed copy:

| Key | Meaning | Default |
| --- | --- | --- |
| `reviewBots` | GitHub login names whose comments and threads are treated as first-class AI review feedback (matched on `author.login`; the `[bot]` suffix is normalised). Edit to match your install. `github-actions` is excluded by default. | `["claude", "cursor", "coderabbitai"]` |
| `maxCiRounds` | Maximum Phase-A re-watch iterations before stopping and reporting blockers. | `5` |
| `replyOnAccept` | Whether an **accepted** finding gets a factual thread reply referencing the fixing commit before resolve. | `true` |
| `promoteOnGreen` | Draft→ready flip after proven-green Phase A. **Default-on.** | `true` |
| `deferNonBlocking` | Propose accept only for high-impact in-scope findings; otherwise defer. | `true` |
| `humanEnvelope` | Halt Phase B for a full disposition batch `[y/N]` before applying. **Default-on.** Escape with `--auto-apply`. | `true` |
| `reviewIdleMinutes` | Hybrid review-settle idle window (minutes). | `5` |
| `reviewWaitMaxMinutes` | Hard cap on waiting for review bots; then slow-bot micro-gate. | `20` |

## Requirements

- `gh` CLI, authenticated (`gh auth status` must pass) — used for checks, logs,
  review threads, and thread resolution.
- `git`.
- Node.js >=22 (ES-module support), for the bundled review-thread fetcher.

## What it does

Two phases, chosen from the PR's draft state:

1. **Phase A — while the PR is a draft.** Inspect failing checks with `gh`, pull
   the failing GitHub Actions logs, and fix failures **in PR scope only** — never
   weakening CI config to greenwash. A failure whose only fix would edit lint
   config or add an ignore directive is classified **gated** and reported for the
   developer's sign-off, never applied. Rebase/merge the base branch when failures
   are upstream drift. Loop until CI is green or report blockers — and stop
   **immediately** once every remaining red check is gated, leaving CI red and
   promotion blocked. Unattended.
2. **Phase B — after the PR is ready-for-review.** Hybrid-wait for configured
   `reviewBots` (sticky headlines and/or threads via `botsReported` /
   `botsMissing`),
   verify-then-propose dispositions, then — by default — **human envelope** before
   applying. Re-envelope when new bot findings appear after apply. With
   `--auto-apply`, fix high-impact findings immediately and keep a Linear-only
   gate for defers.

**By default the skill promotes a cleanly-green draft to ready** and continues into
Phase B. Promotion is gated on proven-green CI, no unresolved human review threads,
and no unresolved base drift. Merge to `main` stays a human action.

The review-discipline rules folded into Phase B (verify before implementing, no
sycophancy, evidence before claims, human envelope) live in
[`references/review-discipline.md`](references/review-discipline.md).
