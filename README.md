# Acme Skunkworks NPM package template

A GitHub Template repository for Acme Skunkworks npm packages — a minimal, buildable
pnpm + TypeScript ESM skeleton plus the shared workflow/release shell, so a new package can be
generated and released without rebuilding the infrastructure each time. Click **Use this
template** to spawn a new package, then work through [Setup](#setup) below (the per-package code
edits live in [`CLAUDE.md`](CLAUDE.md#repo)).

## Setup

This repo is both the template and its own reference package. There are two audiences:

- **Standing up a spawned repo?** Start at the [spawned-repo quick checklist](#spawned-repo-quick-checklist).
- **Template maintainer setting up the org?** Jump to the one-time
  [org-level bootstrap](#org-level-one-time-bootstrap).

> **Important:** branch protection, rulesets, and repo/org settings are **not** copied by GitHub's
> "Use this template". Each spawned repo must re-apply the [repo-level settings](#repo-level-settings)
> itself. This checklist is the single source of truth for the non-copied setup — `CLAUDE.md`'s
> generation checklist links here rather than duplicating it.
>
> These settings were proven on the `eslint-config` testbed (A-311 / A-312 / A-313 / A-314) and
> reconciled to the current estate (release-please, the `GO/NO GO` aggregator check-run, and shared
> reusable CI callers — A-371 / A-413 / A-424 / A-447 / A-432).

### Spawned-repo quick checklist

After "Use this template", in the new repo:

> **Run the `initialise-package-repo` skill first.** It automates the setup half of steps 1–3 and
> 6's Release-enable (in-repo file edits, **shared-skills pull** via `npx skills add … --copy`,
> `initialise-skills`, the ruleset + `npm-release` environment, and `gh workflow enable Release`),
> all idempotent and dry-run-first, and verifies-and-reports steps 4–5 and the npm-OIDC bootstrap.
> **Authoring the real `src/` API stays manual** — the skill never touches `src/`. The numbered
> steps below are the reference for what it does — walk them by hand only if you're not using the
> skill. See [`CLAUDE.md` → Agent skills](CLAUDE.md#agent-skills). Committed skill bundles from the
> template are bootstrap only; the scaffolder refreshes them at pull-on-instantiation (A-776). This
> template is not a skills-push-fan-out consumer (A-774).

1. **Per-package code edits** — rename `package.json`, point `infrastructure/repo-config.yaml` at
   the new package, **re-seed `.release-please-manifest.json`** so `"."` matches the starting
   version (the #1 release-please failure mode), reset `changelog/`, **pull the shared skills**
   (`npx skills add … --copy`), and generate the skill configs (all automated by the skill).
   **Replace `src/` by hand** with the package's real API. Full steps in
   [`CLAUDE.md`](CLAUDE.md#repo).
2. Apply the [repo-level settings](#repo-level-settings) (rulesets are not copied).
3. Create the [`npm-release` environment](#the-npm-release-environment) — called out as its own
   step because it needs the `gh api` commands in that subsection, not just a settings toggle.
4. Onboard the [release-orchestrator](#release-orchestrator-onboarding) — install the bot and add
   the `matrix.repo` entry.
5. Verify the [Claude review prerequisites](#claude-review-prerequisites).
6. Complete the [npm OIDC](#npm-oidc-trusted-publishing) bootstrap, then
   [enable the Release workflow](#enable-the-release-workflow).

### Repo-level settings

Set on this repo and on each spawned repo (rulesets and environments are not copied by "Use this
template"):

- [ ] **Template repository flag enabled** (Settings → General → "Template repository") — for a
      spawned _package_ this is optional; leave it off unless the new repo is itself a template.
- [ ] "Allow auto-merge" **on**; squash merges allowed.
- [ ] Secret scanning + push protection **on**.
- [ ] npm OIDC Trusted Publishing configured (no `NPM_TOKEN` in CI — see
      [npm OIDC](#npm-oidc-trusted-publishing)).
- [ ] `main` ruleset configured (see [the required-check ruleset](#the-required-check-ruleset)).
- [ ] `npm-release` environment configured (see [the npm-release environment](#the-npm-release-environment)).

#### The required-check ruleset

`ci.yml` ends with a single **`GO/NO GO`** aggregator job whose intrinsic **check-run** is the one
stable required gate. Require it on `main` via a ruleset:

- [ ] PR required before merging.
- [ ] **0 required approvals.** ⚠️ A non-zero count blocks the orchestrator's own release-PR merge.
- [ ] Required status check: **`GO/NO GO`** — **not** the retired `🔬 Build & Lint`. The caller
      swap (A-447) replaced it with `lint / Lint` + `build-test / Build & Test`, and `GO/NO GO`
      aggregates them all.
- [ ] Ruleset **pinned to the GitHub Actions integration** (`integration_id: 15368`), so nothing
      but this repo's Actions can satisfy it.
- [ ] No bot bypass.

Footguns (A-418):

- The gate must be a **check-run, not a commit status** — a commit status is forgeable by any
  push-scoped token; a check-run can only be minted by a GitHub App (the repo's own Actions run).
- **Never path-filter** the gate — a path-filtered required check sits Pending forever and blocks
  merges. `ci.yml` keeps it on `always()`.

#### The npm-release environment

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

Without this environment the OIDC release jobs have nowhere to deploy from and the release fails.

### Release-orchestrator onboarding

Hands-off releases are driven by the **private** `acme-skunkworks/release-orchestrator` repo, which
holds the bot key, runs `release-please release-pr`, and merges the release PR. Post-merge changelog
enrichment runs in-repo via `pkg-release.yml`'s `changelog-enrich` job (`@acme-skunkworks/changelog-core`,
A-808). Without onboarding, the repo never gets its automatic release PRs.

The template already ships everything the orchestrator needs on the repo side — release-please
config + manifest, `@acme-skunkworks/changelog-core`, `.nvmrc`, a publish-only `pkg-release.yml`
(with the enricher caller), and `GO/NO GO` running on the `release-please--*` branch. So onboarding
reduces to two steps:

- [ ] **Install road-runner-bot** on the repo (org-installed App's repository selection; perms in
      the [org-level bootstrap](#org-level-one-time-bootstrap)).
- [ ] **Add the repo to the orchestrator's `matrix.repo`** (A-648).
- [ ] **Grant `ROADRUNNER_*` selected access** — org secret `ROADRUNNER_PRIVATE_KEY` and org var
      `ROADRUNNER_CLIENT_ID` must include the repo so `changelog-enrich` can mint an App token
      (A-821 / ADR 0004). The scaffolder reports this; it does not automate org secret visibility.

The required check the orchestrator waits on is **`GO/NO GO`** (the `🔬 Build & Lint` → `GO/NO GO`
cutover completed via A-419 / A-596 / A-437), and the CI callers already run on `release-please--*`
(no skip), so the changelog lane validates entries before the release PR merges.

> The old A-309 "exclude `CHANGELOG.md` from markdown lint" step no longer applies: release-please
> runs with `skip-changelog`, so there is no root `CHANGELOG.md` — the dated `changelog/` directory
> is the only changelog.

### Claude review prerequisites

`claude.yml` / `claude-code-review.yml` need **two** things, and **neither is copied** by "Use this
template":

1. **`CLAUDE_CODE_OAUTH_TOKEN`** — Anthropic model auth for the review action.
2. **The Claude GitHub App installed on the repo** — `claude-code-action` exchanges an OIDC token
   for a short-lived GitHub token, and that exchange only yields a token if the App is granted.
   Missing it, the action's internal `git fetch origin --depth=20 <branch>` runs unauthenticated
   and fails with `could not read Username` — so the review never runs **even after the secret is
   added** (A-621 / A-636).

**Preferred: provision both org-wide, then just verify per repo.** Rather than repeat this on every
spawned repo:

- [ ] `CLAUDE_CODE_OAUTH_TOKEN` as an **org secret** — new repos inherit it automatically (both the
      shared `reusable-claude.yml` caller's `secrets: inherit` and this template's explicit pass
      pick up an org secret).
- [ ] The **Claude GitHub App installed on the org** across the config-estate repos — the OIDC →
      GitHub-token exchange then works in every current/future repo with **no** per-repo grant.

> **Caveat:** the org secret alone does _not_ solve the whole problem — it fixes only the
> Anthropic-auth half; the `git fetch` failure is the **GitHub App / OIDC** half, which still needs
> the App installed. Both org-wide together is the real "zero per-repo Claude setup" answer.

**Per-repo fallback** (until org-wide provisioning is in place):

- [ ] Add the `CLAUDE_CODE_OAUTH_TOKEN` **repo secret**.
- [ ] Grant the **Claude GitHub App** to the repo. (The caller permissions — `id-token: write`,
      `contents: read`, `pull-requests: write`, `issues: read` — are already correct in the
      template; the App grant is the missing piece, not the workflow wiring.)

> **Security note on the org secret.** Unlike `ROADRUNNER_PRIVATE_KEY` (org-compromise-grade →
> deliberately scoped to `release-orchestrator` only), `CLAUDE_CODE_OAUTH_TOKEN` is an Anthropic API
> token — blast radius is API usage / billing abuse, and it is rotatable. Still, an "All
> repositories" org secret is readable by any workflow in any org repo, so **scope it to the
> config-estate repos** (or all-private) rather than truly all, and rotate on exposure. Fork-PR
> secret withholding + "require approval for external contributors" (already on) mitigate the
> `pull_request`-trigger exposure.

### npm OIDC Trusted Publishing

npm has no pending-Trusted-Publisher flow, so bootstrap is always: manual first publish →
configure Trusted Publisher → CI takes over from publish #2.

- [ ] Manual first publish from a laptop (passkey/WebAuthn approval in the browser). The full
      runbook is in [CLAUDE.md → "Bootstrap publish"](CLAUDE.md#bootstrap-publish--read-this-when-setting-up-a-new-package).
- [ ] Configure the Trusted Publisher at `https://www.npmjs.com/package/<name>/access` →
      GitHub Actions → org, repo, workflow filename `pkg-release.yml`, environment **blank**.
      (npm Trusted Publishing binds its OIDC subject to repository + workflow **filename**, so this
      must be `pkg-release.yml` — the thin caller migrated from `release.yml` under A-639. Blank
      accepts any environment in `pkg-release.yml`; the form also accepts `npm-release` to narrow the
      OIDC subject claim further. Blank is the verified default — see CLAUDE.md.)
- [ ] Confirm publish #2 onwards flows through `pkg-release.yml` (OIDC, no token, no OTP) + provenance.

### Enable the Release workflow

The Release workflow (`pkg-release.yml`) is intentionally **disabled on this template repo** (its
placeholder `src/` is never published). Its workflow **name** is `Release`, so a spawned repo
enables it by name:

```bash
gh workflow enable Release
```

### Org-level one-time bootstrap

_Template maintainer only — set once for the `acme-skunkworks` organisation. These protect the
release identity across every repo; a spawned-package owner can skip this section._

- [ ] `ROADRUNNER_PRIVATE_KEY` (org **secret**) → **Selected repositories = `release-orchestrator`
      only**. Never "all" / "public repositories". The App private key never expires and is
      org-compromise-grade, so it must never be readable from public CI.
- [ ] `ROADRUNNER_APP_ID` (org **variable**) → non-sensitive (App IDs are public); share as needed.
- [ ] road-runner-bot App granted access to the repo (the org-installed App's repository selection)
      with `contents: write` **+** `pull-requests: write`.
- [ ] `CLAUDE_CODE_OAUTH_TOKEN` provisioned org-wide and the Claude GitHub App installed across the
      config-estate repos (see [Claude review prerequisites](#claude-review-prerequisites)).
- [ ] Actions → "Allow GitHub Actions to create and approve pull requests" → **off**.
- [ ] Default workflow token permissions → **read**.
- [ ] "Require approval for all external contributors" (fork-PR workflows) → **on**.
- [ ] "Require actions to be pinned to a full-length commit SHA" (SHA-pin enforcement) → **on**.
- [ ] Remove the org `main`-ruleset bot `bypass: always` entry — auto-merge respects branch
      protection once the required check is green.
