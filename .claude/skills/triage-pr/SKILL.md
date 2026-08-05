---
name: triage-pr
description: >-
  Drive a pull request from draft with failing CI to merge-ready. While the PR
  is a draft, inspect and fix in-scope CI failures (lint, manifest-lint, build,
  tests) using the gh CLI and GitHub Actions logs — never
  weakening CI config to greenwash, and never editing lint config or adding an
  ignore directive unprompted (those are gated for the developer's sign-off and
  reported, not applied). After the PR is marked ready-for-review,
  wait for AI reviewers, verify each finding, then — by default — halt for a
  human envelope before applying dispositions (accept / decline / defer→Linear);
  with --auto-apply, fix high-impact findings and defer the rest as before. Use
  when asked to triage a PR, fix failing CI or red checks on a PR, address or
  respond to PR review comments, action Bugbot or Claude review feedback, get a
  PR green, or take a draft PR to merge-ready. Handles base-branch drift and
  in-scope merge conflicts; escalates ambiguous ones.
license: MIT
compatibility: >-
  Requires the `gh` CLI (authenticated — `gh auth status` must pass) and `git`.
  The bundled review-thread fetcher needs Node.js >=22 (ES modules).
  Designed for repositories whose AI review runs only on
  ready-for-review PRs (draft-gated), so Phase A and Phase B do not overlap.
metadata:
  version: 0.11.0
  author: Rob Easthope
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(gh:*), Bash(git:*), Bash(node:*), Bash(pnpm:*), Bash(npx:*), mcp__linear-server__save_issue, mcp__linear-server__list_issue_statuses, mcp__linear-server__list_projects
---

# triage-pr

Take a pull request from **draft + failing CI** to **merge-ready**, in two
phases, choosing the phase from the PR's draft state:

- **Phase A — while the PR is a draft:** inspect failing checks, pull GitHub
  Actions logs, and fix failures **in PR scope only**. Loop until CI is green or
  report blockers. Phase A runs unattended — no human gate except hard blockers.
- **Phase B — after the PR is ready-for-review:** AI review is gated on
  `draft == false`, so once the PR is flipped to ready — by `promoteOnGreen` or a
  human — wait for configured reviewers (Claude Code Review, Bugbot, CodeRabbit)
  to post feedback, **verify-then-propose** dispositions for every finding, then
  — when `humanEnvelope` is on (the default) — **halt** for one batch approval
  before applying accepts, declines, or Linear follow-ups. With `--auto-apply` /
  `humanEnvelope: false`, restore the legacy auto path (fix high-impact now,
  defer the rest for a Linear-only gate). After apply, re-watch CI and
  **re-envelope** if new bot findings appear.

This skill complements `/send-it` (which **opens or updates** the pull request) and,
since send-it 0.8.0, is **invoked** by it as its final step (A-1151): send-it opens or
updates the PR, waits
for at least one check to register, then hands off here — forwarding `--ci-only`,
`--no-promote`, and `--auto-apply` verbatim. Running `/triage-pr` directly stays fully
supported for mid-flight re-runs.

The draft→ready
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

The first eight govern the **CI + review** loop:

| Key | Meaning | Default |
| --- | --- | --- |
| `reviewBots` | GitHub login names whose comments and threads are treated as first-class AI review feedback. Matched against `author.login`; the `[bot]` suffix is normalised, so `claude` and `claude[bot]` both match (the GraphQL API returns the bare form). Edit to match your install — review-bot logins vary per repo. `github-actions` is deliberately excluded by default: it posts CI status and release-PR comments, not code review, so Phase B would otherwise action them as findings; add it only if your install genuinely posts review-type comments via the Actions bot. | `["claude", "cursor", "coderabbitai"]` |
| `maxCiRounds` | Maximum Phase-A re-watch iterations before stopping and reporting blockers. Bounds the fix-and-watch loop so it can't spin forever. | `5` |
| `replyOnAccept` | Whether an **accepted** finding gets a factual thread reply referencing the fixing commit before the thread is resolved (the audit trail). `false` resolves accepted threads silently for maintainers who dislike bot-reply noise — declines always reply with reasoning regardless. | `true` |
| `promoteOnGreen` | The single control for the draft→ready flip. When `true`, after Phase A finishes with **every** required check genuinely green on a **draft** PR, run `gh pr ready <pr>` to flip it to ready-for-review (the gate that turns AI review on), then continue into Phase B — instead of stopping at green. **Default-on**, and an enabled config *is* the human authorisation for the flip: proceed on proven green without seeking a separate sign-off. Set `false` (or pass `--no-promote`) to opt out and stop at green. Promotion is suppressed unless the green is *proven* (Step 6's watched rollup, never "no failures yet"), there are **no unresolved human review threads**, and `mergeStateStatus` shows no unresolved base drift (`BEHIND` / `DIRTY`). An explicit user prompt — or `--promote` / `--no-promote` — overrides this per run; `--ci-only` and `--dry-run` never promote. | `true` |
| `deferNonBlocking` | When `true` (the default), a valid **in-scope** finding is proposed as **accept** only if it is **high-impact**; otherwise it is proposed as **defer** (same path as out-of-scope). High-impact means any of: it **blocks later work** on this PR or stacked work; it touches **Claude Code / agent-skill logic / CI or release infrastructure**; or it is **critical/high severity** (correctness, security, data-loss). You classify each finding yourself against those criteria — do **not** trust bot severity labels (CodeRabbit ⚠️/🧹, Bugbot grades). Set `false` to restore scope-only behaviour (every valid in-scope finding is proposed as accept; only out-of-scope findings defer). | `true` |
| `humanEnvelope` | When `true` (the default), Phase B **halts** after verify-then-propose with a full disposition plan (accept / decline / defer→Linear) and waits for one batch `[y/N]` (default no) before code changes, Linear create, or resolving replies. Proposed-defer threads get a non-resolving `defer-pending` mark when the plan is presented so restarts do not re-emit them. Same gate covers findings from later AI re-reviews on this PR. Set `false` (or pass `--auto-apply`) to restore legacy auto Phase B (impact-gated fix-now; mark `defer-pending` on classify; Linear-only gate for defers). An explicit user prompt overrides the config per run. | `true` |
| `reviewIdleMinutes` | Hybrid review-settle idle window: after at least one configured bot has reported, treat reviews as settled when there is **no new** bot headline / unresolved-thread activity for this many minutes. | `5` |
| `reviewWaitMaxMinutes` | Hard cap on the hybrid wait after the ready flip (or Phase B entry on an already-ready PR). If bots are still missing when this expires, run the **slow-bot micro-gate** (proceed / wait longer / abort) before the disposition envelope. | `20` |

The remaining five configure the **follow-up capture** path — turning a deferred
finding into a tracked Linear issue. Under `humanEnvelope`, capture is part of
the same envelope approval (not a second prompt). Under `--auto-apply` /
`humanEnvelope: false`, capture keeps its own Step 12 batch gate. Capture is
**opt-in**: when `linearTeamName` is empty, it is disabled (no Linear MCP calls);
skip silently when the Linear MCP server is unavailable.

| Key | Meaning | Default |
| --- | --- | --- |
| `linearTeamName` | Linear team **name** (not the key — the key is renamed over time, the name is stable) the follow-up issues are created under. Empty disables capture entirely. | `""` |
| `issueKeys` | Team-key prefixes that may appear in branch names, used to recognise issue ids the same way `linear-sync` does. Mirrors the established `issueKeys` convention. | `[]` |
| `followUpLabel` | Optional label applied to each created follow-up issue (e.g. `follow-up`). Empty = no label. | `""` |
| `followUpProject` | Linear project (name, id, or slug) the follow-up issues are filed under. **Required when `linearTeamName` is set** — empty or unresolved must refuse create (never file with no project). | `""` |
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

**Auto-apply Phase B** — skip the human envelope and restore legacy auto Phase B
for this run (impact-gated fix-now; Linear-only gate for defers). Overrides
`humanEnvelope: true`:

```bash
triage-pr --auto-apply
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

### Step 3 — Phase A: classify each failure (in-scope vs upstream vs gated)

```bash
git fetch origin <base>
git diff --name-only origin/<base>...HEAD   # files this PR actually touches
```

- **In-scope** — the failure names files in this PR's diff, or is a lint / test /
  build failure reproducible on the branch head. Fix it (Step 4) — **unless** its
  only remedy would change lint / format / static-analysis config or add an ignore
  or disable directive, in which case **Lint-surface gated** (below) takes
  precedence, regardless of how clearly the failure belongs to this PR.
- **Upstream / base drift** — the job also fails on `origin/<base>` independent of
  this diff, **or** `mergeStateStatus == BEHIND`, **or** the error names files the
  PR never touched. Remedy is to rebase/merge the base (Step 5), **not** to edit
  the failing code.
- **Lint-surface gated** — the only remedy available is a change to lint / format /
  static-analysis **config**, or a new **ignore / disable directive**. That is a
  **developer decision**, so it is not in-scope and you do not make it. Record a
  **gated item** — the file, the change you would have made, why no code fix was
  available, and the preferred alternative (fix the offending code, or raise the rule
  change in the shared config package) — then carry on with the rest of the round and
  report it at the next natural stopping point (Step 6 / Step 13). The full surface
  list is in
  [`references/review-discipline.md`](references/review-discipline.md#lint-surfaces-are-a-developer-decision).
- A failure that can only be "fixed" by weakening a gate is never in-scope — that is
  the hard ban in **Important rules**; the gated bucket above is its human-decided
  grey zone.

### Step 4 — Phase A: fix in-scope failures, one at a time

- Apply the smallest fix that addresses the **root cause** within the PR's scope.
- **Fix the code, never the lint surface.** For a lint / format / static-analysis
  failure the preference order is: (1) fix the offending **code**; (2) if the rule
  itself is genuinely wrong, the remedy is a change to the **shared config package**
  (`@acme-skunkworks/eslint-config`, `@acme-skunkworks/markdownlint-config`, …),
  proposed to the developer — not landed here; (3) a local config override or an
  ignore / disable directive only with the developer's sign-off. You never take (2)
  or (3) on your own initiative — classify it as gated (Step 3) and keep going.
  *Carve-out:* when the PR's own diff already contains a developer-authored lint
  config or ignore change, you may repair a genuine error in it (e.g. a syntax or
  schema error breaking the lint job), but never loosen a rule or widen an ignore.
- Re-run the **specific** failing command locally and read its exit code before
  claiming it fixed (e.g. `pnpm lint`,
  `npx --yes skills-ref@0.1.5 validate ./skills/<name>`, the failing test). Pin the
  version so the local check matches CI exactly and can't be rug-pulled. Evidence
  before claims — never assert a fix on "should" or "probably".
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
  Step 2 — **unless** every remaining red check is a Step 3 **gated** item, which
  ends Phase A immediately (see the gated-exit rule below).
- **No early "done".** Do not tell the user the run is complete, green, or ready
  for attention until `gh pr checks --watch` (or an equivalent fresh rollup) has
  **exited** and every required check is **terminal** (success or failure). Queued,
  pending, or in-progress checks are non-terminal — "no failures yet", an empty
  rollup, or mixed pending+pass is **not** proven green and **not** a completion
  signal (same discipline as the promotion gate below, applied to every end-of-run
  claim).
- **Stay quiet while watching.** Prefer a silent wait / background watch over
  interim "still waiting" pings that interrupt other work. Surface the human only
  at a **natural stopping point**: the **human envelope** (Step 10 — actionable
  dispositions to approve), the Step 13 report (when the loop converged), a
  documented Phase-A early stop in this step (promotion disabled / promotion gate
  failed / gated lint-surface items outstanding / `--ci-only` / `--dry-run`), the
  slow-bot micro-gate (Step 7), or a hard blocker / `maxCiRounds` exhaustion that
  needs a decision. The envelope *is* actionable — do not treat A-1178's "don't
  pull attention" rule as a reason to skip it.
- **Gated lint-surface items end the loop.** When every remaining red check is a
  Step 3 **gated** item, stop **immediately** — do not spend `maxCiRounds` re-watching
  a failure you have decided not to fix. Report each gated item (file, the change you
  would have made, the preferred alternative) as a Phase-A early stop and hand the
  decision to the developer. CI is not green, so the promotion gate below cannot pass
  either; name the gated items as the specific reason it wasn't promoted.
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

### Step 7 — Phase B: hybrid wait for AI reviewers

Stay in the same session. After the ready flip (or when entering Phase B on an
already-ready PR), poll the fetcher until reviews settle — or until the hard cap
forces the slow-bot micro-gate. Resolve the skill directory as in Step 8.

```bash
node scripts/review-threads.mjs <pr> --bots "claude,cursor,coderabbitai"
```

Use the JSON settle fields:

- `botsReported` — configured bots that have a **sticky-marker** headline in
  `aiSummaryComments` (e.g. `use_sticky_comment` / `BUGBOT_REVIEW`) **and/or** at
  least one unresolved or deferred thread. A bare ack kept only as
  `selectSummaryComments`' first-candidate fallback does **not** count.
- `botsMissing` — configured bots still without a sticky headline or thread.

**Settled when any of:**

1. **All reported** — `botsMissing` is empty (every `reviewBots` entry has
   reported), **or**
2. **Idle** — at least one bot has reported, and there has been **no new** bot
   sticky-headline / unresolved-thread activity for `reviewIdleMinutes`, **or**
3. **Max wait** — `reviewWaitMaxMinutes` since Phase B wait started.

Poll quietly (e.g. every 60s); do **not** ping the human while waiting unless the
slow-bot gate fires. Record a fingerprint of `{botsReported, unresolvedThread
ids, aiSummary comment ids}` each poll to detect "new activity" for the idle
window.

**Slow-bot micro-gate** — only when max wait expires with `botsMissing`
non-empty. List arrived vs outstanding bots and ask **once** in this session:

```text
Review wait timed out after <N> minutes.
  Reported: claude, coderabbitai
  Still outstanding: cursor
Proceed with what we have / wait longer / abort? [proceed|wait|abort]
```

- **proceed** → continue to Step 8 with the findings so far (note missing bots in
  the envelope report).
- **wait** → reset the max-wait clock (or extend by another `reviewWaitMaxMinutes`)
  and return to the poll loop.
- **abort** → stop; leave threads untouched; no disposition envelope.

Do **not** open the disposition envelope until this gate is answered (or reviews
settled via headlines/idle).

### Step 8 — Phase B: fetch unresolved review feedback

Run the bundled fetcher (path **relative to this skill's own directory**):

```bash
node scripts/review-threads.mjs <pr> --bots "claude,cursor,coderabbitai"
```

This fetcher is **read-only**. The write side is `respond-threads.mjs` (Step 11).

It prints minimal JSON including:

- `unresolvedThreads` — inline review threads (`isResolved == false`) raised by a
  configured `reviewBot`, trimmed to `{threadId, path, line, isOutdated, author,
  comments}`. This is the actionable set.
- `deferredThreads` — bot threads already carrying our **non-resolving defer
  marker** (from a prior pass). Do not re-triage these in Step 9; include them in
  the envelope's defer set when rediscovering pending capture.
- `humanThreads` — unresolved threads **not** raised by a review bot. Surface in
  the report; do not auto-action.
- `aiSummaryComments` — headline summary per review bot (sticky issue comment
  and/or Bugbot `<!-- BUGBOT_REVIEW -->` review body). At most **one per bot**.
- `botsReported` / `botsMissing` — settle helpers (Step 7).

Resolved threads are filtered out. Empty `unresolvedThreads`, no AI summary,
**and** no `deferredThreads` → report "no actionable AI review feedback" and skip
to Step 13. If only `deferredThreads` remain under `humanEnvelope`, fold them into
the envelope plan; under `--auto-apply`, go to Step 12's Linear path.

### Step 9 — Phase B: verify-then-propose dispositions

Apply READ → UNDERSTAND → VERIFY → EVALUATE for every actionable finding (full
rules in [`references/review-discipline.md`](references/review-discipline.md)).
**Do not** IMPLEMENT, create Linear issues, or resolve threads yet — build a
numbered **disposition plan** only:

For each finding record:

- source bot + path:line (or issue-level summary item)
- verification sketch (real? in-scope? high-impact?)
- proposed disposition: `accept` | `decline` | `defer` | `outdated` | `gated`
- for `accept`: concrete fix sketch
- for `decline`: technical reasoning
- for `defer`: draft Linear title + rationale

Impact classification still follows `deferNonBlocking` (propose accept only when
high-impact when that knob is on).

**Lint-surface findings are gated, whatever their impact.** When a finding's fix
would edit lint / format / static-analysis config or add an ignore / disable
directive, mark the plan item `[gated]` — naming the surface it would touch and the
preferred alternative (code fix, or a change to the shared config package). `[gated]`
**displaces every other disposition**, not just `accept`: classify the surface
*before* applying `deferNonBlocking`, so a valid but low-impact lint-surface finding
is gated rather than routed to `defer` and the Linear follow-up flow. Under
`humanEnvelope` it rides the **same** envelope so the developer
sees it in one batch — never a second prompt, and never applied without their explicit
go-ahead. Under `--auto-apply` / `humanEnvelope: false` there is no envelope, so a
gated item is simply reported at Step 13 and left unapplied.

**When `humanEnvelope` is true** (default) → continue to Step 10. As soon as the
plan includes any per-thread `defer`, **immediately** mark those threads with the
non-resolving `defer-pending` decision (below) so a restart or overlapping run
does not re-emit them as fresh findings while the human decides. Do **not**
resolve them yet — Step 11 finalises after approval.
**When `humanEnvelope` is false / `--auto-apply`** → skip Step 10; proceed to
Steps 11–12 using today's auto behaviour (fix accepts now; mark `defer-pending`
as soon as you classify a defer, then the Linear-only gate at Step 12).

### Step 10 — Phase B: human envelope (same-session gate)

Present the full disposition plan as one batch and ask **once** (**default no**):

```text
Phase B disposition plan (nothing applied yet):
  1. [accept] Fix null guard in src/api.ts:42 — …
  2. [decline] Suggested rewrite is YAGNI — …
  3. [defer] Extract retry helper — draft: "Add retry backoff to fetch layer"
  4. [gated] Would need `eslint.config.mjs` rule change — your call; prefer a
     change to @acme-skunkworks/eslint-config
  Bots still outstanding at wait end: cursor (if any)
Apply this plan? [y/N]
  (optional overrides: "yes except decline #1, defer #2 as …")
```

Keep the session open for the answer — this gate **is** the actionable interrupt.
Proposed-defer threads should already carry the `defer-pending` marker from
Step 9 (durable, still open).

- **No / empty** → leave remaining threads untouched (optional: decline
  `defer-pending` threads with `deferred; not tracked` if you want them closed);
  stop; no Step 13 "all done" claim beyond "envelope declined; nothing applied".
- **Yes** (with optional per-item overrides) → apply the approved plan in Step 11.
- Under `--dry-run`, print the plan that *would* be proposed and create nothing.

The same envelope covers findings from **later** AI re-reviews on this PR
(Step 12 re-envelope) — one gate for all dispositions, including new Linear
follow-ups.

### Step 11 — Phase B: apply approved dispositions

Execute the approved plan (or the auto-apply path) one finding at a time:

- **Accept** → IMPLEMENT, prove locally, commit/push, re-watch CI (Step 6), then
  reply+resolve via `respond-threads.mjs` only once that fix's CI round is green.
- **Decline** / **outdated** → reply+resolve immediately (no code).
- **Defer (auto-apply path)** → as soon as you classify the finding as defer,
  mark it with `defer-pending` (non-resolving) so it is not re-triaged on the next
  pass; after the Linear-only `[y/N]` at Step 12 (or on capture disabled / no),
  post the final `defer` reply+resolve (or decline `deferred; not tracked`).
- **Defer (envelope path)** → thread should already be `defer-pending` from
  Step 9; on approval create the Linear issue (when capture enabled) then final
  `defer` reply+resolve; when capture is disabled or the human excluded a defer,
  fall back to decline (`deferred; not tracked`).
- **Gated (lint surface)** → apply **only** when the developer explicitly approved
  that item in the envelope. Their sign-off is what turns it into an accept, so from
  there it runs the **Accept** path exactly: IMPLEMENT the signed-off config or ignore
  change, prove locally, commit/push, re-watch CI (Step 6), then reply+resolve once
  that fix's CI round is green — with `--decision accept`, referencing the fixing
  commit. `gated` is a **plan label only**; `respond-threads.mjs` has no such decision
  (its set is `accept` / `decline` / `defer` / `defer-pending` / `outdated`) and
  passing one would throw. **Except `.github/workflows/*`** — approval never
  authorises a workflow edit. **Never greenwash** bans those outright, and this gate
  does not relax it: when a signed-off item would touch a workflow (e.g. a CI
  lint-step severity knob), report that the developer must make the change
  themselves, and reply+resolve without a code change. Without sign-off, leave the
  thread untouched and carry the
  item into the Step 13 report. If it only becomes clear **mid-apply** that an approved
  accept needs a lint-config edit or an ignore directive, stop that item, apply
  nothing, and re-present it as `[gated]` in the Step 12 re-envelope. The gate holds
  under `--auto-apply` / `humanEnvelope: false` too — there it is reported, never
  auto-applied.

```bash
node scripts/respond-threads.mjs thread --thread <PRRT_id> --decision accept --sha <sha> --bots "claude,cursor,coderabbitai"
node scripts/respond-threads.mjs thread --thread <PRRT_id> --decision decline --reason "<technical reasoning>" --bots "claude,cursor,coderabbitai"
# mark a defer candidate without resolving (envelope Step 9, or auto-apply as you classify):
node scripts/respond-threads.mjs thread --thread <PRRT_id> --decision defer-pending --bots "claude,cursor,coderabbitai"
# after Linear mint (or envelope/auto-apply capture approval):
node scripts/respond-threads.mjs thread --thread <PRRT_id> --decision defer --reference <issue-id> --bots "claude,cursor,coderabbitai"
```

Linear create details (team by **name**, state by **type**, links, labels,
**project**) match the previous capture contract — resolve via
`list_issue_statuses` / `list_projects` and fail loudly on typos.

**Fail closed on project.** When capture is enabled (`linearTeamName` set),
`followUpProject` is required. Before minting any issue:

1. If `followUpProject` is empty → **do not** call `save_issue`. Abort capture
   loudly (tell the human to set `followUpProject` in `config.json`), and fall
   back to decline / `deferred; not tracked` for each defer candidate.
2. If set → resolve it with `list_projects` (name, id, or slug). On a miss →
   **do not** call `save_issue`; fail loudly with the unresolved value (same
   decline fallback).
3. On a hit → always pass the resolved `project` on every `save_issue` create.
   Never omit `project`.

### Step 12 — Phase B: issue-level ack + re-envelope

Acknowledge headline summary findings with one consolidated comment once the
approved plan has been applied:

```bash
node scripts/respond-threads.mjs summary --pr <pr> --findings '[{"title":"…","status":"accepted","reference":"<sha>"}]'
```

Then re-fetch (Step 8). If **new** unresolved bot findings appear (fresh review
after the apply push), return to Step 7 → envelope again (full disposition batch,
including any new Linear candidates). Bound by `maxCiRounds`. If CI is terminal
green and there are no new bot findings, continue to Step 13.

Under auto-apply, if only `deferredThreads` / defer candidates remain without an
envelope, present the legacy Linear-only batch `[y/N]` here (default no), then
ack summaries.

### Step 13 — Report

This is the completion alert for a full run. Emit it only after every required
check is **terminal**, or after a hard blocker / budget exhaustion / envelope
decline / abort — never while checks are still pending. Phase-A early stops
report at their Step 6 exit instead.

Summarise:

- Checks fixed, each with the failing command it addressed.
- Envelope outcome (approved / declined / auto-apply) and any slow-bot decisions.
- Findings accepted and fixed (with the resolving commit).
- Findings declined, each with the technical reasoning given.
- **Gated lint-surface items** awaiting the developer's decision — each with the
  file, the change that would have been made, why no code fix was available, and the
  preferred alternative (fix the code, or raise it in the shared config package).
  Nothing on this list was applied.
- Follow-up issues created (each with its Linear id/URL), or deferred candidates
  that were not tracked.
- Issue-level findings acknowledged in the consolidated comment.
- Base merges/rebases performed.
- Remaining blockers (if `maxCiRounds` was exhausted).
- Final CI state, with the proving command's **fresh** exit evidence — check names
  and their terminal states.
- Any **human** review comments, surfaced for the human to handle.
- The PR's draft/ready state: when promotion fired, report the flip (draft → ready)
  and that Phase B then ran; otherwise a reminder that the state is unchanged —
  and, if promotion was enabled but a gate blocked it, the specific reason.

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
- **Lint surfaces are a developer decision.** Never edit lint / format /
  static-analysis config, and never add an ignore or disable directive, on your own
  initiative — not even a plausible, narrowly scoped one. Greenwashing (weakening a
  gate purely to pass CI) is the **hard ban** above; everything else that touches a
  lint surface is the **human-gated grey zone** — it may well be legitimate, but it is
  the **developer's** call, not yours. Classify it as **gated** (Step 3), keep fixing
  everything else, and report it at the next natural stopping point: the Step 6
  Phase-A early stop, the Step 10 envelope (as a `[gated]` plan item), or Step 13 —
  never a mid-loop prompt. Prefer fixing the offending code; if the rule is genuinely
  wrong, propose the change in the shared config package rather than a local override.
  The one exception is Step 4's carve-out: you may repair a genuine syntax or schema
  error in a lint config the developer already put in this PR's diff — never loosening
  a rule or widening an ignore. Surface list in
  [`references/review-discipline.md`](references/review-discipline.md#lint-surfaces-are-a-developer-decision).
- **In-scope only.** Fix what this PR's diff is responsible for; don't fix
  unrelated repo problems.
- **Validate before implementing.** Never apply a review suggestion without first
  verifying it against the codebase.
- **AI bots only.** Action only the configured `reviewBots`; surface human
  comments but leave them for the human.
- **No sycophancy.** Decline with technical reasoning, not flattery.
- **Evidence before claims.** Never say CI is green or a fix works without freshly
  running the proving command and reading its exit code. Never claim the run is
  complete, done, or ready for attention while any required check is still
  non-terminal (queued / pending / in progress) — "no failures yet" is not green
  and not done. Alert the human only at a natural stopping point: the **human
  envelope** (Step 10), Step 13, a documented Step 6 Phase-A early stop
  (promotion disabled / gate failed / gated lint-surface items outstanding /
  `--ci-only` / `--dry-run`), the slow-bot micro-gate, or a hard blocker / budget
  exhaustion — never with interim "still waiting" pings mid-watch.
- **Human envelope is on by default.** When `humanEnvelope` is true, do not
  apply Phase B dispositions (code, resolving replies, Linear creates) until the
  same-session batch `[y/N]` succeeds — except the non-resolving `defer-pending`
  mark on proposed-defer threads when the plan is presented. `--auto-apply` /
  `humanEnvelope: false` restores legacy auto Phase B. Re-envelope when new bot
  findings appear after apply.
- **Draft → ready is guarded, and on by default.** `promoteOnGreen` is the single
  control for the flip, and an enabled config *is* the authorisation: with it on (the
  default) the skill flips the PR — **only** after a *proven*-green Phase A, with **no
  unresolved human threads** and no unresolved base drift — then continues into Phase B,
  without seeking a separate human sign-off for the flip. Set `promoteOnGreen: false` / pass
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
