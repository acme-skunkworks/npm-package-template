---
name: release-status
description: >-
  Diagnose the release-please release pipeline, read-only. Preview the next
  version from the merged Conventional-Commit PR titles since the last tag
  (feat→minor, fix/perf/revert→patch, !/BREAKING→major; docs/chore/ci/refactor/
  test/build/style→none), show the open release-please--branches--main PR and its
  required-check (🔬 Build & Lint) status, detect the recurring stale
  `autorelease: pending` stall on the last merged release PR (where release-please
  aborts and releases silently stop firing), and confirm tag-vs-version parity
  (does a v<package.json version> tag already exist, or is publishing pending — the
  release.yml version-vs-tag gate). Use when asked why a release didn't fire, what
  version would cut next, whether the release PR is green, whether the pipeline is
  stalled, or to check release health. Advisory only — it inspects post-merge main
  and changes nothing.
license: MIT
compatibility: >-
  Requires the `gh` CLI (authenticated — `gh auth status` must pass) and `git`.
  The bundled diagnosis helper needs Node.js >=22 (ES modules, Node built-ins
  only — no npm dependencies, no build step, no tsx). Designed for repos whose
  releases run through release-please via an external orchestrator (the
  road-runner-bot `release-orchestrator`), with a publish-only `release.yml`
  gated on a version-vs-tag check.
metadata:
  version: 0.1.4
  author: Rob Easthope
allowed-tools: Read, Glob, Grep, Bash(gh:*), Bash(git:*), Bash(node:*)
---

# release-status

Diagnose the **release-please** pipeline and report why a release did or didn't
fire — **read-only**. The skill gathers four independent signals via `gh` and
`git`, prints a structured report, and surfaces the remediation for each. It
**writes nothing**: no commits, no labels, no PR edits, no releases.

## Relationship to `/send-it`

This is a **sibling of `send-it`, not invoked by it**. `send-it` is the pre-merge
ship flow — it stops at **In Review** (opens the PR, transitions the Linear
issue). `release-status` picks up **after merge**: it inspects the state of
`main`, the release PR, and the tags to explain what the release machinery is
doing. The two never call each other. This skill may reference `send-it` in prose
(e.g. "the PR title `send-it` composed is the bump signal"), but it never runs it.

## What it inspects

| Signal | What it answers | How to read / fix it |
| --- | --- | --- |
| **Version preview** | What bump and version would the merged Conventional-Commit PR titles since the last tag produce? | `feat:`→minor, `fix:`/`perf:`/`revert:`→patch, `!`/`BREAKING CHANGE:`→major; `docs`/`chore`/`ci`/`refactor`/`test`/`build`/`style`→none. The strongest wins. `none` means nothing release-triggering has merged since the last tag — no release will cut. |
| **Release PR** | Is the `release-please--branches--main` PR open, and is its required check (`🔬 Build & Lint`) green? | If open and green, the orchestrator can squash-merge it. If the check is pending/red, the merge is blocked — chase that check. If none is open, release-please hasn't opened one (often because nothing release-triggering merged, or the pipeline is stalled — see below). |
| **Stale `autorelease: pending`** | Does the **last merged** release PR still carry the `autorelease: pending` label? | This is the recurring stall: when a merged release PR keeps that label, release-please **aborts the next release** and the pipeline silently stops firing. Remediation: remove the label from that PR, then re-run the orchestrator (or wait for its cron tick). |
| **Tag-vs-version parity** | Does a `v<package.json version>` tag already exist? | This is the `release.yml` **version-vs-tag gate**. Tag exists → clean no-op (this version is already published). Tag missing → **publishing is pending** for that version (the gate would run the publish path on the next `main` push). |

## Configuration

Four knobs live in `config.json` beside this file, vendored from the tracked
[`config.example.json`](config.example.json) template (the runtime `config.json`
is generated per consumer and is not itself tracked). Read `config.json` at the
start of a run and use its values throughout. Edit your copied `config.json` to
match the consuming repo.

| Key | Meaning | Default |
| --- | --- | --- |
| `mainBranch` | The trunk release-please releases from. | `main` |
| `releaseBranch` | The branch release-please opens its release PR on. | `release-please--branches--main` |
| `requiredCheck` | The exact name (incl. emoji) of the required status check the orchestrator polls before merging the release PR. | `🔬 Build & Lint` |
| `stalePendingLabel` | The label release-please applies to a release PR while a release is in flight; **stale** when it lingers on a *merged* PR. | `autorelease: pending` |

## Usage

Run the bundled helper. Its path is **relative to this skill's own directory**
(the one holding this `SKILL.md` and `config.json`) — resolve it from there, not
from the consuming repo's root, or the run fails with `ENOENT`.

**Human-readable report** — the default:

```bash
node scripts/release-status.mjs
```

**Machine-readable JSON** — for piping into another step:

```bash
node scripts/release-status.mjs --json
```

**Explicit repo** — when not run from inside the target checkout:

```bash
node scripts/release-status.mjs --repo acme-skunkworks/agent-skills
```

**Self-test** — run the bundled offline assertions (no network, no `gh`); a quick
way to confirm the script is healthy after install:

```bash
node scripts/release-status.mjs --self-test
```

`--help` (alias `-h`) prints the full usage.

## Process

### Step 1 — Confirm prerequisites

`gh auth status` must pass, and you must be inside (or pass `--repo` for) the target
repository. The helper reads the root `package.json` version, the local tags, and
queries `gh` for the release PR and merged PRs.

### Step 2 — Run the helper and read the four signals

```bash
node scripts/release-status.mjs
```

Read each block in order: **version preview**, **release PR**, **stale
`autorelease: pending`**, **tag-vs-version parity**. The helper only fetches and
prints — running it never changes anything.

### Step 3 — Interpret and advise (do not act)

Map the signals to a diagnosis. The common shapes:

- **"A release should have fired but didn't."** Check the stale-pending block
  first — a lingering `autorelease: pending` on the last merged release PR is the
  usual culprit (release-please aborts). If that's clear, check whether the version
  preview is `none` (nothing release-triggering merged) or whether the release PR
  is open-but-its-check-is-red (blocked at the gate).
- **"What version cuts next?"** Read the version-preview block: the bump and the
  resulting `next` version. `none` means no release.
- **"Is publishing pending?"** Read the parity block: a missing `v<version>` tag
  means the next `main` push runs the publish path; a present tag means a clean
  no-op.

### Step 4 — Report, with remediation

Summarise the diagnosis and surface the **remediation** the helper prints, but
**do not perform it** — this skill is advisory. For the stale-pending stall, the
fix is to remove the label from the merged release PR and re-run the orchestrator;
state that as the recommended next action and leave it to the human (or a
write-capable skill) to carry out.

## Important rules

- **Read-only / advisory.** Never remove a label, edit a PR, push a tag, or
  trigger a release. Gather, diagnose, and recommend — the human or a
  write-capable tool acts.
- **Not a `send-it` step.** This skill is never invoked by `send-it` and never
  invokes it. It inspects post-merge `main`; `send-it` stops at In Review.
- **Evidence, not guesses.** Report what the helper actually returned. If `gh`
  fails (auth, rate limit, permissions), report the failure — never treat
  "couldn't fetch" as "no release PR" or "no stall".
- **Mirror, don't import.** The bump rules are re-implemented here to keep the
  bundle standalone (ADR-0001 self-containment); they mirror `send-it`'s
  `derive-bump.mjs` and CLAUDE.md but never reach into a sibling skill.

## Error handling

- `gh auth status` fails → stop and tell the user to run `gh auth login`.
- The helper exits non-zero (rate limit, permissions, GraphQL/REST error) → report
  it; do not fabricate signals. Fall back to a manual `gh pr list --state merged
  --head <releaseBranch> --json labels` to inspect the stale-pending label by hand.
- No tags yet (a never-released repo) → the version preview counts **all** merged
  PRs, and the parity block reports the first `v<version>` tag as pending. That is
  expected for the bootstrap release.

## Arguments

$ARGUMENTS
