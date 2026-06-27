# triage-pr — review discipline

The Phase B triage in [`../SKILL.md`](../SKILL.md) compresses two well-worn
review-handling disciplines into a short step list. The full rules live here, so
the body stays lean and an agent can load this on demand. They are adapted from
the community `receiving-code-review` and `verification-before-completion` skills
(obra/superpowers).

## Receiving review feedback — the six steps

Run every AI finding through these in order. The point is **technical rigour, not
performative agreement**: a review bot is frequently wrong, partially right, or
missing context, and applying its suggestion blind is how a green PR ships a
regression.

1. **READ.** Absorb the whole finding — the comment body *and* the cited file and
   line — before reacting. Don't start editing on the strength of the summary.
2. **UNDERSTAND.** Restate the claim in your own words. If you can't, the finding
   is unclear; treat that as a signal to verify harder, not to guess.
3. **VERIFY.** Check the suggestion against the **actual codebase**. Open the
   cited lines. Confirm the problem is real, reproduces, and isn't already handled
   elsewhere. Never trust the bot's framing of the code — read the code.
4. **EVALUATE.** Decide whether the change is correct *for this project*: in
   scope, compatible with the stack, and not a YAGNI or architecture violation.
5. **RESPOND** — symmetrically, so no thread is resolved silently. **Every**
   actioned thread ends replied-to **and** resolved:
   - *Decline* → reply with the technical reasoning, then resolve.
   - *Accept* → reply referencing the fixing commit (`Addressed in <sha>.`), then
     resolve — but only once that fix is proven (and, on a ready PR, CI-green; see
     **Resolve timing** below). When `replyOnAccept` is `false`, resolve without
     the reply.
   - *Outdated* (cited code is gone) → resolve, no reply.

   The reply is the durable, per-finding audit trail reviewers and humans skimming
   the PR rely on; a silently-resolved accept loses it.
6. **IMPLEMENT.** Apply accepted findings **one at a time**, verifying each before
   the next. Batching changes hides which one broke something.

## No sycophancy

Do **not** open a reply with praise — "You're absolutely right!", "Great point!",
"Excellent feedback!". Actions speak: the code change itself shows the finding was
heard. Acknowledge by describing what changed ("Fixed — `line` now falls back to
`originalLine` for outdated threads") or simply implement without commentary.

## When to decline

Push back — with technical reasoning, not defensiveness — when the suggestion:

- breaks existing functionality;
- is made without the full context (the bot couldn't see a constraint you can);
- violates YAGNI (adds an unused capability "just in case");
- conflicts with the codebase's technical stack or conventions; or
- contradicts a deliberate architectural decision.

A declined finding still gets a reply explaining *why*, then the thread is
resolved so it doesn't re-surface.

## Symmetric reply + resolve — recorded decisions (A-410)

The reception above is symmetric on purpose. These are the decisions that settled
how it is implemented, recorded so the SKILL.md steps have something to point at.

### Canonical resolve mechanism

Resolve a thread with GitHub's GraphQL **`resolveReviewThread`** mutation
(`PRRT_`-prefixed thread ids). It is the *only* per-thread programmatic resolve —
there is no REST equivalent — and it is idempotent, so calling it on an
already-resolved thread is safe. We **always pair it with a reply**: the reply is
the acknowledgement reviewers (CodeRabbit included) and humans read; resolving
alone is the silent-resolve this discipline exists to prevent.

We deliberately do **not** use the bulk **`@coderabbitai resolve`** command. It
marks *every* CodeRabbit comment resolved at once, which would sweep up declined or
not-yet-handled findings and defeat the per-finding discipline. CodeRabbit's own
docs are silent on whether a GraphQL-resolve updates its internal state; pairing
the resolve with an explicit reply is the robust path either way.

### Resolve timing vs CI

For an **accepted** finding, resolve only **after** the fixing commit is pushed
*and* its proving command passes — and, on a ready PR, after that fix's CI round is
green. Resolving optimistically on push risks leaving a thread resolved when the
fix later regresses in CI. Declines and outdated threads carry no code, so they
resolve immediately.

### Idempotency + convergence

Every reply/comment we author carries a hidden HTML-comment marker
(`<!-- triage-pr:thread-ack -->` on thread replies,
`<!-- triage-pr:summary-ack -->` on the consolidated issue-level comment). Because
each fix push re-triggers review, the marker is what makes the loop terminate: on
the next pass, a thread already bearing our marker is **skipped**, and the
consolidated comment is **edited in place** rather than re-posted. A run converges
when CI is green and every bot thread is handled (resolved-by-us, declined+resolved,
or human-and-left-alone) with no accepted fix still awaiting CI-green — all bounded
by `maxCiRounds`.

### Issue-level comments — respond vs noise

Claude's review and CodeRabbit's sticky summary arrive as issue-level comments with
no resolvable per-finding thread. Acknowledge them with **one consolidated comment**
mapping each finding → accepted (`<sha>`) / declined (`<reason>`) / out-of-scope
(`<ticket>`), not a reply under every checklist sub-point — per-sub-point replies are
noise. One acknowledgement per finding, in one upserted comment.

### Verifiability

The reply/resolve **planning and formatting** (symmetry, `replyOnAccept`, the
idempotency marker, the consolidated table, upsert detection) lives in pure
functions in `scripts/respond-threads.mjs`, covered by its `--self-test` and the
root `tests/skills/triage-pr/` vitest suite. The `gh` mutations themselves are thin
wrappers, exercised only against real PRs — never unit-tested by spamming one.

## Evidence before claims

Before asserting that CI is green, a check passes, or a fix works:

1. Identify the command that **proves** the claim.
2. Run it freshly and completely — not from memory of a previous run.
3. Read the full output **and** the exit code.
4. Only then state the result, citing the evidence.

Banned until you have run the proving command: "should", "probably", "seems to",
and premature satisfaction ("Done!", "Perfect!", "All green!"). Any wording that
implies success without fresh verification breaks this rule.

Proving commands by claim:

| Claim | Proof |
| --- | --- |
| Lint clean | the lint command's output showing zero errors |
| Tests pass | the test command's output showing zero failures |
| Build succeeds | the build command exiting `0` |
| Manifest valid | `npx skills-ref validate ./skills/<name>` exiting `0` |
| CI green | `gh pr checks <pr>` showing every required check passed |
| Bug fixed | the original failing symptom now passing |
