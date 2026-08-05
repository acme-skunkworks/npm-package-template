# triage-pr — review discipline

The Phase B triage in [`../SKILL.md`](../SKILL.md) compresses two well-worn
review-handling disciplines into a short step list. The full rules live here, so
the body stays lean and an agent can load this on demand. They are adapted from
the community `receiving-code-review` and `verification-before-completion` skills
(obra/superpowers).

## Human envelope (default)

When `humanEnvelope` is `true` (the default), run READ → UNDERSTAND → VERIFY →
EVALUATE for every finding and produce a disposition plan — then **halt** for one
same-session batch `[y/N]` before IMPLEMENT / Linear create / resolving replies.
Proposed-defer threads are marked `defer-pending` (non-resolving) when the plan is
presented so a restart does not re-emit them while the human decides. The
envelope covers accept, decline, and defer→Linear in one gate, including findings
from later AI re-reviews on the same PR. `--auto-apply` / `humanEnvelope: false`
skips the envelope and restores legacy auto Phase B (impact-gated fix-now; mark
`defer-pending` as soon as a defer is classified; Linear-only gate for defers).

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
   When it is valid and in-scope **and** `deferNonBlocking` is `true`, also
   classify **impact** (see **When to fix now vs defer** below) — propose accept
   only if high-impact; otherwise propose defer even though it is in scope. When
   `deferNonBlocking` is `false`, every valid in-scope finding is proposed as
   accept.
5. **RESPOND** — only **after** the human envelope approves (or under
   `--auto-apply`). Symmetrically, every actioned thread ends replied-to **and**
   resolved:
   - *Decline* → reply with the technical reasoning, then resolve.
   - *Accept* → reply referencing the fixing commit (`Addressed in <sha>.`), then
     resolve — but only once that fix is proven (and, on a ready PR, CI-green; see
     **Resolve timing** below). When `replyOnAccept` is `false`, resolve without
     the reply.
   - *Outdated* (cited code is gone) → resolve, no reply.
   - *Defer* (valid but **out of scope** for this PR, **or** — when
     `deferNonBlocking` is on — **in-scope but not high-impact**) → mark
     `defer-pending` as soon as the finding is classified (envelope: when the
     plan is presented; auto-apply: on classify). Linear create + final defer
     reply happen only after envelope approval, or under auto-apply after the
     Linear-only gate.

   The reply is the durable, per-finding audit trail reviewers and humans skimming
   the PR rely on; a silently-resolved accept loses it.
6. **IMPLEMENT.** Apply accepted findings **one at a time**, verifying each before
   the next — only after envelope approval (or under auto-apply). Batching changes
   hides which one broke something.

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

## When to fix now vs defer

After a finding clears EVALUATE (correct, not YAGNI/architecture), choose
**accept** vs **defer** for the disposition plan:

- **Out of scope** → always defer (regardless of `deferNonBlocking`).
- **In scope**, `deferNonBlocking` is `false` → accept and fix now (legacy
  scope-only behaviour).
- **In scope**, `deferNonBlocking` is `true` (the default) → accept and fix now
  only when **high-impact**. Otherwise defer.

A finding is **high-impact** when **any** of these hold (classify yourself — do
**not** trust bot severity labels such as CodeRabbit ⚠️/🧹 or Bugbot grades):

- it **blocks later work** on this PR or stacked work;
- it touches **Claude Code / agent-skill logic / CI or release infrastructure**; or
- it is **critical/high severity** (correctness, security, data-loss).

Low-impact nits that are still valid and in-scope become follow-up candidates so
the PR can land high-impact work without accumulating churn.

## Lint surfaces are a developer decision

Changing how a linter is configured — or telling it to look away — is a **developer
decision**, never the agent's. It sits beside **Never greenwash** as the pair:
weakening a gate purely to make a check pass is a **hard ban**; anything else that
touches a lint surface is the **human-gated grey zone**. A plausible, narrowly scoped
tweak is exactly the case this covers: it may well be right, but it is not yours to
land.

Two reasons it stays with the human:

- **The shared-config model.** Estate lint rules live in packages
  (`@acme-skunkworks/eslint-config`, `@acme-skunkworks/markdownlint-config`, …). A
  per-repo override is usually the wrong place for a rule change — it forks the
  estate's lint behaviour one repo at a time.
- **Cumulative surface degradation.** Every ignore line and every loosened local rule
  permanently weakens the check for that file or path. CI goes green; the underlying
  problem stays. One at a time it always looks reasonable; the sum does not.

### Surfaces covered

**Lint / format / static-analysis config:**

- `eslint.config.*`, `.eslintrc*`
- `.markdownlint*` (`.markdownlint.jsonc`, `.markdownlint-cli2.*`)
- `.yamllint*`
- `.prettierrc*`, `.prettierignore`
- `.shellcheckrc`
- actionlint config (`.github/actionlint.yaml`)
- repo **extends** of shared config packages (swapping, narrowing, or overriding what
  the shared config sets)
- CI lint-step knobs that change rule severity (`--max-warnings`, `continue-on-error`
  on a lint step, a severity flag on the linter invocation)

> **The workflow ban is not relaxed by this gate.** Those CI lint-step knobs live in
> `.github/workflows/*`, which **Never greenwash** forbids the agent from editing
> **at all**. Listing them here means such a failure is *reported* to the developer
> like any other gated item — it does **not** open a sign-off path for the agent to
> edit a workflow. Where the two rules overlap, the stricter one wins: the agent
> never touches it, and the developer makes the change themselves.

**Ignore / disable directives** — inline, block, or file-level:

- `eslint-disable`, `eslint-disable-next-line`, `eslint-disable-line`
- `markdownlint-disable` / `markdownlint-disable-next-line`
- `# yamllint disable` / `disable-line`
- `prettier-ignore`
- `shellcheck disable=`
- per-linter file-level ignore lists (`ignores:` / `ignorePatterns` entries,
  `.eslintignore`, `.prettierignore`, `.markdownlintignore`)

### Preference order

1. **Fix the offending code.** Nearly always available, and it's the only option that
   leaves the lint surface intact.
2. **Propose the rule change upstream** in the shared config package, for the
   developer to take forward. Report it — do not open it yourself as part of this run.
3. **Local override or ignore** — only with the developer's explicit sign-off, and
   only after 1 and 2 have been ruled out.

### What to report

A gated item is reported, never applied. Give the developer enough to decide without
re-deriving your analysis:

- the **file** (and rule) the change would touch;
- the **change you would have made** — the exact config edit or ignore directive;
- **why the code fix wasn't available** — this is the part that justifies the gate;
- the **preferred alternative** — the code fix you'd write, or the shared-config change
  you'd propose.

Report at the natural stopping points only (Phase A's Step 6 early stop, the Step 10
envelope as a `[gated]` plan item, or the Step 13 report) — never as a mid-loop prompt.

### Carve-out — repairing what the developer already wrote

The gate targets the agent **introducing** a lint-surface change. When the PR's own
diff already contains a developer-authored lint config or ignore change, you may
repair a genuine error in it — a syntax or schema error breaking the lint job, a
malformed rule id, a misspelt glob that matches nothing. What you may **never** do,
under this carve-out or any other, is loosen a rule or widen an ignore beyond what the
developer wrote.

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
consolidated comment is **edited in place** rather than re-posted. Under
`humanEnvelope`, new findings after apply trigger another full envelope (not
silent auto-apply). A run converges when CI is green and every bot thread is
handled (resolved-by-us, declined+resolved, human-and-left-alone, or deferred with
a ticket) with no accepted fix still awaiting CI-green — all bounded by
`maxCiRounds`.

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
| Manifest valid | `npx --yes skills-ref@0.1.5 validate ./skills/<name>` exiting `0` |
| CI green | `gh pr checks <pr>` showing every required check passed |
| Bug fixed | the original failing symptom now passing |
