---
name: triage-pr
description: >-
  Drive a pull request from draft with failing CI to merge-ready. While the PR
  is a draft, inspect and fix in-scope CI failures (lint, manifest-lint, build,
  tests) using the gh CLI and GitHub Actions logs — never
  weakening CI config to greenwash. After the PR is marked ready-for-review,
  fetch the unresolved AI review threads (Claude Code Review, Bugbot), validate
  each finding against the codebase before changing anything, fix the valid
  ones, decline the invalid ones with technical reasoning, then re-watch CI
  until green. Use when asked to triage a PR, fix failing CI or red checks on a
  PR, address or respond to PR review comments, action Bugbot or Claude review
  feedback, get a PR green, or take a draft PR to merge-ready. Handles
  base-branch drift and in-scope merge conflicts; escalates ambiguous ones.
license: MIT
compatibility: >-
  Requires the `gh` CLI (authenticated — `gh auth status` must pass) and `git`.
  The bundled review-thread fetcher needs Node.js >=22 (ES modules).
  Designed for repositories whose AI review runs only on
  ready-for-review PRs (draft-gated), so Phase A and Phase B do not overlap.
metadata:
  version: 0.5.0
  author: Rob Easthope
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(gh:*), Bash(git:*), Bash(node:*), Bash(pnpm:*), Bash(npx:*), mcp__linear-server__save_issue, mcp__linear-server__list_issue_statuses, mcp__linear-server__list_projects
---

# triage-pr

Take a pull request from **draft + failing CI** to **merge-ready**, in two
phases, choosing the phase from the PR's draft state:

- **Phase A — while the PR is a draft:** inspect failing checks, pull GitHub
  Actions logs, and fix failures **in PR scope only**. Loop until CI is green or
  report blockers.
- **Phase B — after the PR is ready-for-review:** AI review is gated on
  `draft == false`, so once the PR is flipped to ready — by `promoteOnGreen` or a
  human — reviewers (Claude Code Review, Bugbot) post feedback. Fetch the
  **unresolved** findings, validate each
  against the codebase before changing anything, fix the valid ones, decline the
  invalid ones with technical reasoning, then loop back through Phase A.

This skill complements `/send-it` (which **opens** the draft PR). The draft→ready
flip is governed by a single control — `promoteOnGreen` in [`config.json`](config.json)
— and **an enabled config *is* the authorisation** for it: when `promoteOnGreen` is
`true` (the default), human authorisation for the flip is **already acquired via the
repo config**, so after a cleanly-green Phase A the skill flips the PR to ready and
continues into Phase B without stopping to seek a separate sign-off (the ready-flip is
the gate that turns AI review on; see Step 6). The flip stays **guarded** — gated on
proven-green CI, **no unresolved human review threads**, and no unresolved base drift.
Set `promoteOnGreen: false` (or pass `--no-promote`) to opt out and stop at green; an
explicit user prompt — or the `--promote` / `--no-promote` flags — overrides the config
for that run. Merge to `main` is never automated; that stays a human action. See
[`references/review-discipline.md`](references/review-discipline.md) for the full
review-reception and verification rules folded into Phase B.

## Configuration

The knobs live in [`config.json`](config.json) beside this file. Read it at the
start of a run and use its values throughout. Edit your copied `config.json` to
match the consuming repo's review bots and (optionally) its Linear workspace.

The first four govern the **CI + review** loop:

| Key | Meaning | Default |
| --- | --- | --- |
| `reviewBots` | GitHub login names whose comments and threads are treated as first-class AI review feedback. Matched against `author.login`; the `[bot]` suffix is normalised, so `claude` and `claude[bot]` both match (the GraphQL API returns the bare form). Edit to match your install — review-bot logins vary per repo. `github-actions` is deliberately excluded by default: it posts CI status and release-PR comments, not code review, so Phase B would otherwise action them as findings; add it only if your install genuinely posts review-type comments via the Actions bot. | `["claude", "cursor", "coderabbitai"]` |
| `maxCiRounds` | Maximum Phase-A re-watch iterations before stopping and reporting blockers. Bounds the fix-and-watch loop so it can't spin forever. | `5` |
| `replyOnAccept` | Whether an **accepted** finding gets a factual thread reply referencing the fixing commit before the thread is resolved (the audit trail). `false` resolves accepted threads silently for maintainers who dislike bot-reply noise — declines always reply with reasoning regardless. | `true` |
| `promoteOnGreen` | The single control for the draft→ready flip. When `true`, after Phase A finishes with **every** required check genuinely green on a **draft** PR, run `gh pr ready <pr>` to flip it to ready-for-review (the gate that turns AI review on), then continue into Phase B — instead of stopping at green. **Default-on**, and an enabled config *is* the human authorisation for the flip: proceed on proven green without seeking a separate sign-off. Set `false` (or pass `--no-promote`) to opt out and stop at green. Promotion is suppressed unless the green is *proven* (Step 6's watched rollup, never "no failures yet"), there are **no unresolved human review threads**, and `mergeStateStatus` shows no unresolved base drift (`BEHIND` / `DIRTY`). An explicit user prompt — or `--promote` / `--no-promote` — overrides this per run; `--ci-only` and `--dry-run` never promote. | `true` |

The remaining five configure the **follow-up capture** step (Step 10) — turning a
valid-but-out-of-scope finding into a tracked Linear issue. They are **opt-in**:
when `linearTeamName` is empty, capture is disabled and the step is skipped
silently (no Linear MCP calls). Capture also needs the Linear MCP server; skip it
silently when it is unavailable.

| Key | Meaning | Default |
| --- | --- | --- |
| `linearTeamName` | Linear team **name** (not the key — the key is renamed over time, the name is stable) the follow-up issues are created under. Empty disables capture entirely. | `""` |
| `issueKeys` | Team-key prefixes that may appear in branch names, used to recognise issue ids the same way `linear-sync` does. Mirrors the established `issueKeys` convention. | `[]` |
| `followUpLabel` | Optional label applied to each created follow-up issue (e.g. `follow-up`). Empty = no label. | `""` |
| `followUpProject` | Optional Linear project (name, id, or slug) the follow-up issues are filed under. Empty = no project. | `""` |
| `followUpState` | Optional initial workflow state (type, name, or id — e.g. `Backlog`) for created issues. Empty = the team's default state. | `"Backlog"` |

Only the configured `reviewBots` are actioned in Phase B. Human review comments
are surfaced in the final report but never auto-actioned, replied to, or
resolved — leave those for the human.

## Usage modes

**Auto** — detect the current branch's PR and its phase, then run:

```bash
triage-pr
```

**Explicit PR** — operate on a specific PR by number or URL:

```bash
triage-pr 123
```

**CI only** — run Phase A and stop, even if the PR is ready:

```bash
triage-pr --ci-only
```

**Dry run** — report failing checks and unresolved findings and propose fixes,
but change nothing (no commits, no pushes, no thread replies):

```bash
triage-pr --dry-run
```

**Promote on green** — opt in to flipping the draft to ready once Phase A is cleanly
green (then continue into Phase B). Overrides `promoteOnGreen` for this run;
`--no-promote` forces the default stop-at-green:

```bash
triage-pr --promote
```

## Process

### Step 1 — Locate the PR and detect the phase

```bash
gh pr view <pr> --json number,isDraft,state,headRefName,baseRefName,mergeable,mergeStateStatus,statusCheckRollup
```

- Resolve the PR from the argument, or from the current branch when none is
  given. If `gh pr view` finds no PR, stop and tell the user to open one with
  `/send-it` first.
- `isDraft == true` → **Phase A**. When CI is green, promotion (`promoteOnGreen`,
  default on) flips the cleanly-green draft to ready at Step 6 and the run continues
  into Phase B. With promotion disabled (`--no-promote` / `promoteOnGreen: false`),
  report and stop instead — AI review has not run yet, and the skill leaves the flip
  to the human.
- `isDraft == false` → **Phase A** (confirm/clear CI), then **Phase B**.
- Record `baseRefName` for the drift checks and `mergeStateStatus` for conflict
  detection.

### Step 2 — Phase A: inspect failing checks

```bash
gh pr checks <pr>
```

For each failed Actions check, resolve its run ID from the check's `detailsUrl`
(in `statusCheckRollup`) and read the failing step's logs:

```bash
gh run view <run-id> --log-failed
```

Capture the **actual failing command and error lines**, not just the check name.
You are diagnosing a root cause, not pattern-matching a label.

### Step 3 — Phase A: classify each failure (in-scope vs upstream)

```bash
git fetch origin <base>
git diff --name-only origin/<base>...HEAD   # files this PR actually touches
```

- **In-scope** — the failure names files in this PR's diff, or is a lint / test /
  build failure reproducible on the branch head. Fix it (Step 4).
- **Upstream / base drift** — the job also fails on `origin/<base>` independent of
  this diff, **or** `mergeStateStatus == BEHIND`, **or** the error names files the
  PR never touched. Remedy is to rebase/merge the base (Step 5), **not** to edit
  the failing code.
- A failure that can only be "fixed" by weakening a gate is never in-scope — see
  **Important rules**.

### Step 4 — Phase A: fix in-scope failures, one at a time

- Apply the smallest fix that addresses the **root cause** within the PR's scope.
- Re-run the **specific** failing command locally and read its exit code before
  claiming it fixed (e.g. `pnpm lint`,
  `npx skills-ref validate ./skills/<name>`, the failing test). Evidence before
  claims — never assert a fix on "should" or "probably".
- Commit with a Conventional Commit subject, then push. One fix → one
  verification → next fix.

### Step 5 — Phase A: handle base-branch drift

Only when Step 3 classified the failure as upstream/behind:

```bash
git fetch origin <base>
git merge origin/<base>      # or rebase, per the repo's convention
```

- Clean merge → push and re-watch (Step 6).
- Conflict → go to **Merge conflicts** below.

### Step 6 — Phase A: re-watch CI until green or budget exhausted

```bash
gh pr checks <pr> --watch
```

- After each push, watch the rollup to completion. Still red → loop back to
  Step 2.
- **Bound the loop** by `maxCiRounds`. When exhausted, stop and report the
  remaining failures as blockers rather than looping forever.
- Green **and ready** → continue to Phase B.
- Green **and draft**, promotion **disabled** (`--no-promote` / `promoteOnGreen: false`)
  → report green and **stop**.
- Green **and draft**, promotion **enabled** (default, or `--promote`) → run
  the **promotion gate** before flipping. All three must hold:
  1. **Proven green** — the green is *this step's* watched-rollup green (not pending /
     "no failures yet"); apply the same exit-code discipline Phase A already enforces,
     never greenwash to reach the flip.
  2. **No unresolved human threads** — run
     `node scripts/review-threads.mjs <pr> --bots "<config.reviewBots joined by commas>"`
     and require `humanThreads` empty. (On a draft, `unresolvedThreads` is empty
     anyway — AI review hasn't run — so this gate is specifically about humans who
     reviewed the draft.)
  3. **No unresolved base drift** — re-fetch `mergeStateStatus` **fresh** right before
     the flip (`gh pr view <pr> --json mergeStateStatus`), not the Step 1 snapshot: an
     intervening Phase A push can have changed it. Require it not `BEHIND` / `DIRTY`
     (Phase A's Step 5 resolves in-scope drift; if it persists, do **not** promote —
     report it as a blocker).

  All three pass → `gh pr ready <pr>`, report the flip, then **continue to Phase B**
  (Step 7). The ready-flip and Phase B's pushes re-fire CI + AI review, and the whole
  loop stays bounded by `maxCiRounds`. Any gate fails → **do not flip**; report green
  plus the specific reason it wasn't promoted, and stop. Under `--dry-run`, report
  that it *would* promote (or why not) and flip nothing. Under `--ci-only`, never
  promote — stop at green regardless of the knob.

### Step 7 — Phase B: fetch unresolved review feedback

Run the bundled fetcher. Its path is **relative to this skill's own directory**
(the one holding this `SKILL.md` and `config.json`) — resolve it from there, not
from the consuming repo's root, or the run fails with `ENOENT`. The `--bots`
value is `config.reviewBots` joined by commas:

```bash
node scripts/review-threads.mjs <pr> --bots "claude,cursor,coderabbitai"
```

This fetcher is **read-only** (it only fetches and prints), so it has no
`--dry-run` flag — running it never changes anything. The write side is
`respond-threads.mjs` (Step 8), which is where `--dry-run` lives.

It prints minimal JSON with three groups:

- `unresolvedThreads` — inline review threads (`isResolved == false`) raised by a
  configured `reviewBot`, trimmed to `{threadId, path, line, isOutdated, author,
  comments}`. This is the actionable set.
- `humanThreads` — the same shape, for unresolved threads **not** raised by a
  review bot. Surface these in the report for the human; do not auto-action them.
- `aiSummaryComments` — the sticky issue-level summary the review action posts via
  `track_progress` / `use_sticky_comment`. At most **one per review bot** is kept:
  the bot's first issue comment, upgraded to a later one carrying a sticky marker
  (walkthrough / `use_sticky_comment` / `track_progress` / "Summary by …") if the
  first had none — so an "I'll review" ack, command acknowledgements, and chatter
  don't masquerade as the headline review. Surface it **separately**: it is an
  issue comment, **not** a review thread, so it has no `isResolved` and never
  appears in `unresolvedThreads`. Missing it would mean missing the headline
  review.

Resolved threads are filtered out so the context stays small. Empty
`unresolvedThreads` **and** no AI summary → report "no actionable AI review
feedback" and skip to Step 12.

### Step 8 — Phase B: validate each finding before touching code

Apply the six-step reception (full rules in
[`references/review-discipline.md`](references/review-discipline.md)):

1. **READ** the finding in full — body plus the cited file and line.
2. **UNDERSTAND** what it claims and why; restate it for yourself.
3. **VERIFY** it against the actual codebase. Open the cited lines and confirm
   the issue is real and not already handled. Never trust the bot's framing.
4. **EVALUATE** — is it correct, in-scope, and not a YAGNI or architecture
   violation?
5. **RESPOND** symmetrically — every actioned thread ends **replied-to and
   resolved**, so nothing is resolved silently:
   - **Decline** → reply with concise **technical reasoning**, then resolve.
   - **Accept** → resolve only **after** the fix is pushed and its proving
     command passes (and, when the PR is ready, that fix's CI round is green —
     see Step 9), with a factual reply referencing the fixing commit
     (`Addressed in <sha>.`). When `replyOnAccept` is `false`, resolve without the
     reply.
   - **Outdated** (cited code is gone) → resolve without a reply.
   - **Defer** (the finding is **valid but out of scope** for this PR — a
     worthwhile follow-up, not a change to make here) → **do not** resolve it now.
     Set it aside as a follow-up **candidate**, recording
     `{title, rationale, threadId, path, line}`, and leave the thread unresolved.
     Candidates are captured as tracked Linear issues — **only on explicit human
     approval** — at Step 10, which then posts the defer reply and resolves the
     thread. Never create an issue here.

   No sycophancy ("You're absolutely right!", "Great point!") — state facts.
6. **IMPLEMENT** accepted findings one at a time (Step 9), then reply+resolve.

The bundled `respond-threads.mjs` is the write side (its path is **relative to
this skill's directory**, like `review-threads.mjs`). It builds the reply body
(carrying a hidden idempotency marker), honours `replyOnAccept`, and skips any
thread already bearing our marker, then runs the reply + resolve mutations. Pass
`--bots` (the same `config.reviewBots` list) so it classifies the thread's author
and **refuses to action a human thread** even if its id is passed by mistake. Add
`--dry-run` to preview without writing:

```bash
# accepted finding, after its fix is pushed and proven/green:
node scripts/respond-threads.mjs thread --thread <PRRT_id> --decision accept --sha <sha> --bots "claude,cursor,coderabbitai"
# declined finding:
node scripts/respond-threads.mjs thread --thread <PRRT_id> --decision decline --reason "<technical reasoning>" --bots "claude,cursor,coderabbitai"
# deferred finding, after Step 10 mints its follow-up ticket:
node scripts/respond-threads.mjs thread --thread <PRRT_id> --decision defer --reference <issue-id> --bots "claude,cursor,coderabbitai"
```

`respond-threads.mjs --help` prints the full subcommand/flag usage, and
`respond-threads.mjs --self-test` runs the bundled offline assertions (no
network, no `gh`) — a quick way to confirm the script is healthy after install.

Resolving uses GitHub's GraphQL `resolveReviewThread` — the only per-thread
programmatic resolve, idempotent on an already-resolved thread. Do **not** use the
bulk `@coderabbitai resolve`: it resolves *every* CodeRabbit thread at once,
including declined or not-yet-handled ones (see
[`references/review-discipline.md`](references/review-discipline.md)).

### Step 9 — Phase B: apply accepted fixes, then re-run Phase A

- Implement each accepted finding on its own; after each, freshly run the proving
  command and read its output and exit code before claiming it works.
- Commit and push, then **return to Step 2** — a new push re-fires CI, and AI
  review re-fires too (the PR is ready), producing fresh threads and an updated
  sticky comment.
- **Resolve an accepted thread only once that fix's CI round is green** (Step 6),
  not optimistically on push — a fix that regresses in CI must not leave a
  resolved thread behind. Decline/outdated threads resolve immediately (no code
  rides on them).
- **Convergence.** Loop Phase B ↔ Phase A until CI is green **and** every bot
  thread is *handled* — resolved-by-us (accept, post-CI-green), declined+resolved,
  a human thread (never auto-actioned), or **flagged as a follow-up candidate**
  (a recognised transient state — left unresolved on purpose, settled at Step 10) —
  with **no accepted fix still awaiting CI-green**. Because each push re-triggers
  review, the idempotency marker is what makes this terminate: already-handled
  threads are skipped on the next pass, so only genuinely new findings are
  actioned. The whole loop stays bounded by `maxCiRounds`.

### Step 10 — Phase B: capture out-of-scope findings as follow-up issues

Once the thread loop has converged, gather every follow-up **candidate** flagged
during Step 8 — both per-thread defers **and** issue-level findings judged
valid-but-out-of-scope. If there are none, skip to Step 11.

**Capture is opt-in and gated on explicit human approval — nothing is created
otherwise.** It is disabled when `config.linearTeamName` is empty or the Linear MCP
server is unavailable; in that case (and whenever the human declines below), fall
back without creating anything: **decline** each per-thread candidate with concise
technical reasoning (`out of scope; not tracked`) and resolve it, and map each
issue-level candidate as `out-of-scope` with **no** ticket in the Step 11 summary.

When capture is enabled, present **all** candidates as a single batch and ask once
for explicit approval (**default no** — mirrors `cleanup-repo`'s two-pass gate):

```text
Proposed follow-up issues (none created yet):
  1. Refactor fetch layer — thread on src/api.ts:42
  2. Add retry backoff — CodeRabbit summary
Create these 2 issues in Linear? [y/N]
```

On a single explicit **yes**, create one Linear issue per candidate with
`mcp__linear-server__save_issue` — resolve the team by **name** and the state by
**type**, never a stale key (the renamed-team gotcha; see
[`skills/linear-sync/SKILL.md`](../linear-sync/SKILL.md)):

- `team` = `config.linearTeamName`; `title` derived from the finding.
- `description` = the bot's rationale, a back-link to the PR **and** the specific
  thread/comment URL, and the originating `path:line` (literal newlines, British
  English).
- `links` = `[{ url: <PR url>, title: "Source PR" }]`.
- `labels` = `[config.followUpLabel]` when set; `project` = `config.followUpProject`
  when set; `state` = `config.followUpState` when set (else the team default).
  Use `list_issue_statuses` / `list_projects` to resolve a configured state/project
  and fail loudly on a typo rather than filing in the wrong place.

Then write each created issue's id/URL back:

- **Per-thread** candidate → post the defer reply and resolve via the `defer`
  decision:

  ```bash
  node scripts/respond-threads.mjs thread --thread <PRRT_id> --decision defer --reference <issue-id> --bots "claude,cursor,coderabbitai"
  ```

- **Issue-level** candidate → carry it into Step 11 as
  `{ "title": "…", "status": "out-of-scope", "reference": "<issue-id>" }`.

Under `--dry-run`, list the candidates that *would* be proposed and create nothing.

### Step 11 — Phase B: acknowledge issue-level review comments

Findings that arrive as **issue-level comments** — Claude's whole-review comment,
CodeRabbit's sticky summary (`aiSummaryComments` from Step 7) — have no resolvable
per-finding thread, so the thread machinery above never touches them. Once the
thread loop has converged (and Step 10's capture has minted any follow-up tickets),
acknowledge them on the PR with **one consolidated comment** mapping each finding →
`accepted (<sha>)` / `declined (<reason>)` / `out-of-scope (<ticket>)`:

```bash
node scripts/respond-threads.mjs summary --pr <pr> --findings '[{"title":"…","status":"accepted","reference":"<sha>"}]'
```

It carries a hidden marker and is **upserted in place** — a re-run edits the same
comment rather than posting a duplicate. Acknowledge each issue-level finding only
once here (not per sub-point of a checklist review — that is noise). Skip this step
entirely when there were no issue-level findings to map.

### Step 12 — Report

Summarise:

- Checks fixed, each with the failing command it addressed.
- Findings accepted and fixed (with the resolving commit).
- Findings declined, each with the technical reasoning given.
- Follow-up issues created (each with its Linear id/URL), or candidates that were
  proposed and **declined** (so nothing was created).
- Issue-level findings acknowledged in the consolidated comment.
- Base merges/rebases performed.
- Remaining blockers (if `maxCiRounds` was exhausted).
- Final CI state, with the proving command's output.
- Any **human** review comments, surfaced for the human to handle.
- The PR's draft/ready state: when promotion fired, report the flip (draft → ready)
  and that Phase B then ran; otherwise a reminder that the state is unchanged — the
  human flips it (and, if promotion was enabled but a gate blocked it, the specific
  reason).

## Merge conflicts

- Resolve **only** when the resolution is unambiguous and within the PR's scope
  (e.g. both sides touched disjoint hunks, or this branch's intent clearly
  supersedes).
- **Abort and ask the human** when intent is ambiguous: both sides changed the
  same logical thing, the conflict reaches files outside the PR's scope, or
  resolving needs a product decision. Run `git merge --abort` and report the
  conflicting files.
- Never resolve a conflict by deleting the other side's work just to make it
  compile.

## Important rules

- **Never greenwash.** Never edit `.github/workflows/*`, disable or loosen a lint
  rule, delete or skip a test, or relax a CI threshold to make a check pass. Fix
  the code, or report the failure as a blocker.
- **In-scope only.** Fix what this PR's diff is responsible for; don't fix
  unrelated repo problems.
- **Validate before implementing.** Never apply a review suggestion without first
  verifying it against the codebase.
- **AI bots only.** Action only the configured `reviewBots`; surface human
  comments but leave them for the human.
- **No sycophancy.** Decline with technical reasoning, not flattery.
- **Evidence before claims.** Never say CI is green or a fix works without freshly
  running the proving command and reading its exit code.
- **Draft → ready is guarded, and on by default.** `promoteOnGreen` is the single
  control for the flip, and an enabled config *is* the authorisation: with it on (the
  default) the skill flips the PR — **only** after a *proven*-green Phase A, with **no
  unresolved human threads** and no unresolved base drift — then continues into Phase B,
  without seeking a separate human sign-off. Set `promoteOnGreen: false` / pass
  `--no-promote` to stop at green; an explicit user prompt or `--promote` /
  `--no-promote` overrides the config per run. Never greenwash to reach the flip;
  `--ci-only` never promotes. Merge stays a human action.
- **Bounded loops.** Stop after `maxCiRounds` and escalate.

## Error handling

- `gh auth status` fails → stop and tell the user to run `gh auth login`.
- No PR for the branch → stop with "open one with `/send-it` first".
- `gh run view --log-failed` unavailable (logs expired or run purged) → report
  the failing check by name without guessing its cause; do not fabricate a fix.
- The review-thread fetcher exits non-zero (rate limit, permissions, GraphQL
  error) → report it and fall back to `gh pr view <pr> --json reviews,comments`.
  Never treat "couldn't fetch" as "no findings".
- A finding cites a file or line that no longer exists (outdated thread) → note it
  as outdated and resolve it without a code change (`--decision outdated`).
- `respond-threads.mjs` exits non-zero (reply or resolve mutation fails on
  permissions) → fall back to a manual `gh api graphql` reply with the reasoning
  rather than aborting; the marker convention still applies so a later run skips it.
- The consolidated `summary` upsert can't find prior comments (REST page cap, ~100)
  → it posts a fresh comment; harmless, just avoid hand-deleting the marker so the
  next run can find and edit it.

## Arguments

$ARGUMENTS
