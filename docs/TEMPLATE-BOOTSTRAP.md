# Template repo bootstrap checklist

The one-time setup that turns `acme-skunkworks/npm-package-template` into a working
GitHub **Template repository**, plus the org/repo settings every spawned repo inherits.

These settings were proven on the `eslint-config` testbed (A-311 / A-312 / A-313 /
A-314) and reconciled to the current estate (release-please, the `go/no-go` aggregator
check-run, and shared reusable CI callers — A-371 / A-413 / A-424 / A-447 / A-432).

> **Important:** branch protection, rulesets, and repo/org settings are **not** copied by
> GitHub's "Use this template". Each spawned repo must re-apply the [repo-level](#repo-level-this-repo-and-each-spawned-repo)
> section itself, then run the [spawned-repo quick checklist](#spawned-repo-quick-checklist).

## Org-level (`acme-skunkworks`)

Set once for the organisation; these protect the release identity across every repo.

- [ ] `ROADRUNNER_PRIVATE_KEY` (org **secret**) → **Selected repositories = `release-orchestrator` only**.
      Never "all" / "public repositories". The App private key never expires and is
      org-compromise-grade, so it must never be readable from public CI.
- [ ] `ROADRUNNER_APP_ID` (org **variable**) → non-sensitive (App IDs are public); share as needed.
- [ ] road-runner-bot App granted access to the repo (the org-installed App's repository
      selection) with `contents: write` **+** `pull-requests: write`.
- [ ] Actions → "Allow GitHub Actions to create and approve pull requests" → **off**.
- [ ] Default workflow token permissions → **read**.
- [ ] "Require approval for all external contributors" (fork-PR workflows) → **on**.
- [ ] "Require actions to be pinned to a full-length commit SHA" (SHA-pin enforcement) → **on**.
- [ ] Remove the org `main`-ruleset bot `bypass: always` entry — auto-merge respects branch
      protection once the required check is green.

## Repo-level (this repo and each spawned repo)

- [ ] **Template repository flag enabled** (Settings → General → "Template repository").
- [ ] "Allow auto-merge" **on**; squash merges allowed.
- [ ] Secret scanning + push protection **on**.
- [ ] npm OIDC Trusted Publishing configured (no `NPM_TOKEN` in CI — see below).
- [ ] `main` ruleset configured (see [the required-check ruleset](#the-required-check-ruleset)).
- [ ] `npm-release` environment configured (see [npm-release environment](#the-npm-release-environment)).

### The required-check ruleset

`ci.yml` ends with a single **`go/no-go`** aggregator job whose intrinsic **check-run** is the
one stable required gate. Require it on `main` via a ruleset:

- [ ] PR required before merging.
- [ ] **0 required approvals.** ⚠️ A non-zero count blocks the orchestrator's own release-PR merge.
- [ ] Required status check: **`go/no-go`** — **not** the retired `🔬 Build & Lint`. The caller
      swap (A-447) replaced it with `lint / Lint` + `build-test / Build & Test`, and `go/no-go`
      aggregates them all.
- [ ] Ruleset **pinned to the GitHub Actions integration** (`integration_id: 15368`), so nothing
      but this repo's Actions can satisfy it.
- [ ] No bot bypass.

Footguns (A-418):

- The gate must be a **check-run, not a commit status** — a commit status is forgeable by any
  push-scoped token; a check-run can only be minted by a GitHub App (the repo's own Actions run).
- **Never path-filter** the gate — a path-filtered required check sits Pending forever and blocks
  merges. `ci.yml` keeps it on `always()`.

### The `npm-release` environment

Configured server-side (not in YAML), gating both privileged release jobs:

```bash
gh api -X PUT repos/<owner>/<repo>/environments/npm-release \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/<owner>/<repo>/environments/npm-release/deployment-branch-policies \
  -f 'name=main'
```

- [ ] Deployment-branch policy permits deployments **only from `refs/heads/main`**.
- [ ] **No required reviewers** — releases stay hands-off; this is a structural ref gate, not a
      manual approval (A-326).

## npm OIDC Trusted Publishing

npm has no pending-Trusted-Publisher flow, so bootstrap is always: manual first publish →
configure Trusted Publisher → CI takes over from publish #2.

- [ ] Manual first publish from a laptop (passkey/WebAuthn approval in the browser). The full
      runbook is in [CLAUDE.md → "Bootstrap publish"](../CLAUDE.md#bootstrap-publish--read-this-when-setting-up-a-new-package).
- [ ] Configure the Trusted Publisher at `https://www.npmjs.com/package/<name>/access` →
      GitHub Actions → org, repo, workflow filename `release.yml`, environment **blank**.
      (Blank accepts any environment in `release.yml`; the form also accepts `npm-release` to
      narrow the OIDC subject claim further. Blank is the verified default — see CLAUDE.md.)
- [ ] Confirm publish #2 onwards flows through `release.yml` (OIDC, no token, no OTP) + provenance.

## Release-orchestrator onboarding (hands-off releases)

Releases are driven by the **private** `acme-skunkworks/release-orchestrator` repo, which holds
the bot key, runs `release-please release-pr` + `finalise-changelog.ts`, and merges the release PR.

- [ ] Install road-runner-bot (perms in [Org-level](#org-level-acme-skunkworks)).
- [ ] Add the repo to the orchestrator's `matrix.repo`.
- [ ] Confirm the CI callers run on the `release-please--*` branch (they do — no skip), so the
      changelog lane validates the finalised entries before the release PR merges.
- [ ] The required check the orchestrator waits on is **`go/no-go`** (the orchestrator's
      `🔬 Build & Lint` → `go/no-go` transition is A-419 / A-420).

> The old A-309 "exclude `CHANGELOG.md` from markdown lint" step no longer applies:
> release-please runs with `skip-changelog`, so there is no root `CHANGELOG.md` — the dated
> `changelog/` directory is the only changelog.

## Enable the Release workflow

`release.yml` is intentionally **disabled on this template repo** (its placeholder `src/` is never
published). A spawned repo needs it on:

```bash
gh workflow enable Release
```

## Spawned-repo quick checklist

After "Use this template", in the new repo:

1. Apply the [repo-level](#repo-level-this-repo-and-each-spawned-repo) settings (rulesets are
   not copied).
2. Run the per-package generation steps in [CLAUDE.md](../CLAUDE.md#repo) — rename `package.json`,
   replace `src/`, point `infrastructure/repo-config.yaml` at the new package, and **re-seed
   `.release-please-manifest.json`** so `"."` matches the starting version (the #1 release-please
   failure mode).
3. Onboard the [release-orchestrator](#release-orchestrator-onboarding-hands-off-releases).
4. Complete the [npm OIDC](#npm-oidc-trusted-publishing) bootstrap, then `gh workflow enable Release`.
