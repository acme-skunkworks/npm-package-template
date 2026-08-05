---
name: send-it
description: >-
  The all-in-one ship finisher — bundle uncommitted work into atomic commits, run
  the change-gated lint preflight, author or update the dated changelog entry,
  compose a Conventional Commits PR title (CI + humans; post-merge bump for
  feature PRs comes from landed commit subjects), push, open or update a PR, and
  transition linked Linear issues to In Review, then chain into the `triage-pr`
  skill to drive the PR to merge-ready. Use when asked to ship, send it,
  finish a branch, open or update a PR for the current work, or wrap up and push.
  A thin orchestrator that delegates the commit step to the `commit` skill, the
  lint gate to the `preflight` skill, the changelog to the `changelog` skill, the
  Linear writeback to the `linear-sync` skill, and the post-PR triage to the
  `triage-pr` skill; it owns the branch guard, the
  release-type decision (by the change's semantic category), PR-title composition,
  push, and PR. One skill serves monorepos and single-package repos alike.
license: MIT
compatibility: >-
  Requires the `git` and `gh` CLIs (`gh` authenticated). Node.js ≥22 for the
  bundled `derive-bump.mjs` / `check-skill-bumps.mjs` helpers (Node built-ins only —
  no npm dependencies, no build step, no tsx). Delegates to the `commit`,
  `preflight`, `changelog`, `linear-sync`, and `triage-pr` skills — install them
  alongside this one. A missing `linear-sync` or Linear MCP server skips the In
  Review writeback silently; a missing `triage-pr` warns and stops at the open PR.
metadata:
  version: 0.8.0
  author: Rob Easthope
allowed-tools: Write, Read, Edit, Glob, Grep, Bash(git:*), Bash(gh:*), Bash(pnpm:*), Bash(node:*), Bash(npx:*), mcp__linear-server__get_issue, mcp__linear-server__save_issue, mcp__linear-server__list_issue_statuses, mcp__linear-server__list_projects
---

# send-it

Bundle uncommitted work into atomic commits (via the
[`commit`](../commit/SKILL.md) skill), run the change-gated lint
[`preflight`](../preflight/SKILL.md), author or update the dated
`changelog/<ts>-<slug>.md` entry (via the [`changelog`](../changelog/SKILL.md)
skill), compose a **Conventional Commits PR title** (CI + humans; under the dual
merge policy, feature PRs land as merge commits and release-please ranks the
landed **commit subjects** for the bump — A-1176 / A-824), push the branch, open
or update a pull request against the base branch, and transition any linked Linear
issues to **In Review** (via the [`linear-sync`](../linear-sync/SKILL.md) skill).

This skill is the single source of truth for the **ship flow**. It is a thin
orchestrator: it owns only the glue no sibling skill does — the branch guard,
worktree resolution, the release-type decision (by category), PR-title
composition, push, and the PR — and delegates the rest:

- **Commit** → the `commit` skill (classify in-scope vs out-of-scope, atomic
  Conventional Commits, out-of-scope guard).
- **Lint gate** → the `preflight` skill (change-gated; no-ops when nothing
  lint-relevant changed).
- **Changelog** → the `changelog` skill (author/update + validate; an entry for
  **every** PR, skipped entirely only when `config.json` sets `changelog: false`).
- **Linear In Review** → the `linear-sync` skill (resolve state by team name,
  idempotent transition).
- **Post-PR triage** → the `triage-pr` skill (Phase A CI fix loop and the
  promote-on-proven-green flip, then Phase B review dispositions up to its human
  envelope — Step 11, A-1151).

The delegated skills auto-detect their own scope, so monorepo features
(per-workspace ESLint fan-out, changelog `affected_packages`) no-op cleanly in a
single-package repo. send-it configures nothing about them.

> **Install the delegated skills alongside `send-it`.** This bundle invokes and
> links its siblings by relative path (`../commit/SKILL.md`, `../preflight/SKILL.md`,
> `../changelog/SKILL.md`, `../linear-sync/SKILL.md`, `../triage-pr/SKILL.md`), so a
> `--skill send-it`-only install leaves the commit, lint, changelog, Linear, and
> triage steps unavailable and those links dangling. Install them together:
>
> ```bash
> npx skills add https://github.com/acme-skunkworks/agent-skills \
>   --skill send-it --skill commit --skill preflight --skill changelog --skill linear-sync \
>   --skill triage-pr \
>   --agent claude-code --agent cursor --copy
> ```

This flow intentionally does **not** run typecheck, tests, or format checks — CI
handles those. The only gate it runs is the change-gated `preflight` lint.

## Configuration

A few knobs live in [`config.json`](config.json) beside this file; edit your
copied `config.json` to match the consuming repo (a neutral
[`config.example.json`](config.example.json) ships as a template):

| Key | Meaning | Default |
| --- | --- | --- |
| `baseBranch` | The trunk the branch diff is taken against (`origin/<baseBranch>`) and the PR base. | `"main"` |
| `shippablePaths` *(advisory)* | Path prefixes that make up the published surface — a documentation hint for reviewers, **not** the release decision (A-598; see Step 6). Release-type is decided by the change's semantic category, so these no longer gate the title. Kept for the optional publish-surface cross-check note. | `["skills/"]` |
| `shippableManifestKeys` *(advisory)* | `package.json` keys that form the published-`files` surface — same advisory role as `shippablePaths`, no longer a release gate. | `["name", "version", "files", "publishConfig"]` |
| `changelog` *(optional)* | Whether to author a dated `changelog/` entry at all (Steps 7–8). Set `false` for repos with **no changelog flow** — no `changelog/` directory and no `changelog` skill installed (e.g. a `private` repo with no release pipeline). When `false`, send-it skips changelog authoring entirely, and the category decision continues to drive only the PR title. **Omit it (or set `true`) whenever the `changelog` skill is installed.** | `true` |
| `bundleVersioning` *(optional)* | Enables the per-bundle version-bump check (Step 6) for repos that ship many independently-versioned skill bundles. An object `{ root, manifest, skillFile }` naming the bundle parent dir and the manifest / skill-manifest filenames each bundle carries. **Omit it entirely in single-package repos** — the check then no-ops. | unset (disabled) |
| `triage` *(optional)* | Whether the run chains into the [`triage-pr`](../triage-pr/SKILL.md) skill once the PR is open (Step 11) — the CI fix loop, the promote-on-proven-green flip, then Phase B up to triage-pr's human envelope. `true` (the default) makes one `/send-it` drive the whole pipeline; set `false` in repos that want send-it to stop at the open PR, or where `triage-pr` isn't installed. `--skip-triage` does the same for a single run (A-1151). | `true` |

The team name, issue-ID prefixes, and workspace slug are **not** configured here —
they live in the `linear-sync` and `changelog` skills' own `config.json` files,
read by the delegated steps.

> **Changelog scope (was `changelogScope`).** send-it authors a dated entry for
> **every** PR — the "record everything, filter later" model. Release notes come
> from filtering the changelog to the version-stamped (release-triggering) entries
> at release time, not from gating authoring at write time. The `changelogScope`
> knob (added in 0.4.0) is **gone** (A-600); only the `changelog: true|false`
> master switch remains.

## Prerequisites

- `gh` CLI installed and authenticated (`gh auth status`).
- The sibling skills (`commit`, `preflight`, `changelog`) installed.
- `linear-sync` — optional; without it (or the Linear MCP server) the In Review
  writeback is skipped **silently** (Step 10).
- `triage-pr` — optional; without it the Step 11 chain **warns** and the run finishes
  at the open PR. The two behave differently on purpose: a skipped Linear writeback
  changes nothing about the PR, whereas a skipped triage chain leaves work undone.

## Process

### Step 0: Worktree resolution (only if `--worktree=` is set)

If `--worktree=<branch-or-path>` was passed, resolve and `cd` into that worktree
before any other step runs. Skip this step otherwise.

1. Run `git worktree list --porcelain` to list worktrees with their paths and
   branches.
2. Resolve the argument:
   - **Absolute path** (starts with `/`): match against the `worktree <path>`
     field.
   - **Otherwise**: treat as a branch name and match against the
     `branch refs/heads/<name>` field.
3. **No match** — exit immediately with: `No worktree found for <arg>. Available:
   <comma-separated paths>`.
4. **Match** — `cd` into the resolved worktree path. The `cwd` persists for the
   rest of the workflow, so all subsequent `git` and `gh` calls operate on the
   worktree.
5. **Ensure dependencies are present.** A freshly-created worktree has no
   `node_modules`. If it is absent, run `pnpm install --frozen-lockfile` now —
   before any step that invokes a bundled script or a validator — so `--worktree`
   is self-sufficient:

   ```bash
   [ -d node_modules ] || pnpm install --frozen-lockfile
   ```

6. Continue to Step 1.

This step does nothing when `--worktree` is omitted — no-arg send-it keeps working
unchanged from whatever directory the session is in.

### Step 1: Branch guard

1. Get the current branch: `git branch --show-current`.
2. **If on the base branch** (`baseBranch` from `config.json`; default `main`):
   - Run `git status --porcelain`. If clean, exit with: "Nothing to ship from the
     base branch. Create a feature branch first."
   - If there are uncommitted changes:
     - Inspect the diff (`git diff` and `git diff --cached`) and the changed file
       paths.
     - Derive a short kebab-case slug summarising the change (~3 words, lowercase,
       max ~40 chars). Examples: `add-readme-section`, `fix-config-typo`.
     - **Branch name resolution (in order):**
       1. `--branch=<name>` — use as-is.
       2. `--issue=<ID>` — use `<ID>-<slug>` **lower-cased** (e.g.
          `a-7-as-acquired`), matching Linear's `gitBranchName`.
       3. Otherwise — just `<slug>` (no `wip/` prefix).
     - If the chosen branch already exists locally or on `origin`, append `-2`,
       `-3`, … until unused.
     - Run `git checkout -b <branch>` to move the working tree onto it.
     - Inform the user: "Was on the base branch with uncommitted changes; created
       `<branch>` and continuing."
   - Continue with the rest of the workflow on the new branch.
3. **If on a feature branch:** continue.

### Step 2: Refresh lockfile if `package.json` drifted

Skip this step if no `package.json` was touched on the branch.

1. `git diff --name-only origin/<base>...HEAD | grep -E '(^|/)package\.json$'`. If
   empty, skip.
2. Run `pnpm install --frozen-lockfile`. If it succeeds, the lockfile is already in
   sync — continue.
3. If it fails, run `pnpm install` to update the lockfile.
4. If the lockfile changed, stage and commit it before any other commits go in:

   ```bash
   git add pnpm-lock.yaml
   git commit -m "chore: update lockfile"
   ```

This keeps CI's `--frozen-lockfile` install green. (Skip silently in repos that
don't use pnpm.)

### Step 3: Commit uncommitted changes — delegate to the `commit` skill

send-it is the all-in-one finisher: whatever's uncommitted should be committed
before the changelog/PR work begins — but only what belongs to *this* branch.

Follow the [`commit`](../commit/SKILL.md) skill to do this: classify uncommitted
files **in-scope vs out-of-scope** against the merge base (`git merge-base HEAD
origin/<base>`), show a staging plan flagging any out-of-scope files (never `git
add -A`; stray files from another branch/worktree are never staged silently), and
create **logical atomic Conventional Commits** (type + optional scope +
British-English body; `!` / `BREAKING CHANGE:` for breaking changes). If clean,
skip this step. Direct the `commit` skill to classify against **this** send-it
run's resolved base — `<base>` is `baseBranch` (from `config.json`), or `--base`
when passed — **not** the `commit` skill's own `config.json` `baseBranch`, which
differs on a `--base` run (the stacked-PR case). The scope classification and the
out-of-scope guard must be computed against the same base send-it ships against,
or a stacked PR would mis-classify files.

The Conventional-Commit types this step writes are the input to Step 6's release
decision (`derive-bump.mjs` reads them back out of the commits), so the honest
types and `!` / `BREAKING CHANGE:` markers matter.

This delegation covers only the *initial* commit of uncommitted work. send-it's own
later, targeted commits stay here: the lockfile refresh (Step 2), the optional
bundle-version bump (Step 6), and the changelog entry (Step 8).

### Step 4: Fetch the base branch and confirm there's something to ship

```bash
git fetch origin <base>
```

If `git log origin/<base>..HEAD` is empty, exit with: "No commits ahead of the base
branch. Nothing to ship."

### Step 5: Lint gate — delegate to the `preflight` skill

> **`--skip-preflight`** bypasses this whole step. Print a clear
> `⚠️ lint gate bypassed (--skip-preflight)` warning and jump to Step 6. Use it only
> when the gate misfires; CI still runs the repo's real linting.

Run the change-gated lint preflight, following the [`preflight`](../preflight/SKILL.md)
skill:

```bash
node skills/preflight/scripts/preflight.mjs
```

Act on its exit-code contract, reading `.preflight-summary.json` to interpret a
non-zero exit:

- **Exit 0 — pass.** No introduced violations; continue.
- **Exit 1 with `violations.introducedCount > 0` — introduced violations
  (blocking).** Run `node skills/preflight/scripts/lint-fix.mjs`, re-run preflight,
  and repeat until introduced violations clear. Commit the fixes (a `style:`/`fix:`
  commit, or fold into the relevant Step 3 commit if not yet pushed) before
  continuing.
- **Exit 1 with `introducedCount == 0` and `results.failedLinters` non-empty — a
  linter could not run (its binary is absent), not a real violation.** This is
  expected in a repo that doesn't use that toolchain (e.g. a docs/skills repo with
  no ESLint or markdownlint installed). Treat it as a **skip, not a block**: warn
  that `<linter>` was unavailable and continue. The repo's own CI owns whatever
  linting it actually runs.
- **Exit 2 — pre-existing violations only.** Not introduced by this branch — do not
  block shipping. Surface them and continue (optionally offer a debt issue per the
  preflight skill).

Preflight is **change-gated**: it lints only the categories the branch touched, so
it no-ops when nothing lint-relevant changed. Skip this step entirely only if
`preflight` isn't installed.

### Step 6: Decide release-type by category and compose the Conventional Commits PR title

Versioning is driven by [release-please](https://github.com/googleapis/release-please)
reading **Conventional Commits**. The estate uses a **dual merge policy** (A-1176 /
[ADR-0005](../../../architecture/0005-dual-merge-policy.md)):

- **Feature / ship PRs** land as **merge commits**. After merge, release-please ranks
  the landed **commit subjects** on trunk to decide the bump (A-824) — not the PR
  title alone.
- **Release-please version PRs** and **fan-out PRs** stay **squash** (orchestrator /
  fanout-spine). For those paths the squash subject remains the bump declaration.
- Both `allow_merge_commit` and `allow_squash_merge` stay enabled (A-1177) — squash
  is not disabled.

send-it still composes a correct Conventional Commits **PR title** (CI's PR-title
lint + humans; the changelog-completeness gate still keys off a release-triggering
title) and writes the dated changelog entry (for every PR — see Step 7). It does
**not** bump versions, write any `CHANGELOG.md`, or tag.

Release-type is decided by the change's **semantic category — the Conventional-Commit
type of the work send-it itself committed — not by which paths the diff touches**
(A-598). A docs-only edit is `docs:` (no release) even when it lives under a published
path like `skills/`; a `feat:` is a release wherever its files sit. (Earlier versions
keyed this off `shippablePaths`, which mis-titled a docs edit inside a published path
as `feat:`/`fix:` and cut a spurious release.)

1. **Derive the slug, body, type, and category** from the branch commits via the
   bundled helper (zero-dep — no tsx):

   ```bash
   node skills/send-it/scripts/derive-bump.mjs
   ```

   It prints JSON:
   `{ "slug", "bump", "body", "type", "breaking", "category", "releaseTriggering" }`:
   - `type` — the **dominant** Conventional-Commit type across **all** branch commits
     (`feat`/`fix`/`perf`/`docs`/`refactor`/`chore`/`ci`/… — A-387); this is the
     PR-title prefix. Merge commits are excluded from the scan (`git log --no-merges`).
   - `breaking` — `true` if any commit carries a `!` or a `BREAKING CHANGE:` trailer.
   - `category` — the dated changelog `category` enum value (`feat`→`feature`,
     `fix`→`fix`, `perf`→`perf`, `docs`→`docs`, `refactor`→`refactor`, everything else
     →`chore`).
   - `releaseTriggering` — `true` iff `breaking` or `type ∈ {feat, fix, perf}`. This is
     the release decision: `true` cuts a release, `false` does not.
   - `bump` — `major`/`minor`/`patch`, the release **magnitude** when `releaseTriggering`
     (a `BREAKING CHANGE:`/`!` → major; dominant `feat:` → minor; else patch). Ignored
     when `releaseTriggering` is `false`.

2. **(Advisory) publish-surface cross-check.** `shippablePaths` /
   `shippableManifestKeys` in [`config.json`](config.json) are a documentation hint of
   the published surface — they **do not** decide release-type any more. Optionally
   sanity-check the category against them: if `releaseTriggering` is `true` but the diff
   (`git diff --name-only origin/<base>...HEAD`) touches **no** `shippablePaths` prefix
   (nor a `shippableManifestKeys` key in `package.json`), note it in the PR body so a
   reviewer can confirm the release was intended — and likewise if a change touching a
   published path is `releaseTriggering: false`. This is a soft note only; never let it
   override the category decision or block.

3. **Check per-bundle version bumps** — only when `config.json` sets
   `bundleVersioning` (multi-artefact repos; skip this step entirely when it's
   unset). Each skill bundle carries its own version in its `package.json` +
   `SKILL.md metadata.version`, bumped by hand and decoupled from the repo release.
   CI enforces that the two **agree**, but nothing enforces they were **bumped** when
   the bundle's content changed — so an edited bundle can ship with a stale version
   label. Close that gap:

   ```bash
   node skills/send-it/scripts/check-skill-bumps.mjs
   ```

   It prints `{ "configured", "unbumped": [{ name, currentVersion, suggestedBump,
   suggestedVersion, manifestPath, skillPath }], "bumped" }`. For **each** `unbumped`
   entry, surface the proposal and apply it on confirmation:

   > `skills/<name>` changed but its version is still `<currentVersion>`. Suggested
   > bump: `<suggestedBump>` → `<suggestedVersion>` (matches the PR-title bump).
   > Apply? (yes / no / patch / minor / major)

   On `yes` (or an explicit level), edit **both** `manifestPath` (`version`) and
   `skillPath` (`metadata.version`) to the chosen version — in lockstep, so the
   parity invariant CI checks still holds — then stage and commit just those two
   files: `git commit -m "chore(<name>): release <name>@<version>"`. On `no`, leave
   it and continue. Under `--dry-run`, print the proposal and edit nothing.

4. **Compose the PR title** as a single Conventional Commits subject — CI's
   PR-title lint and the changelog-completeness gate still require it. For **feature
   PRs** (merge commits), the post-merge bump comes from the landed **commit
   subjects** (A-824); the title remains the human/CI declaration and should match
   the dominant type. For **squash** paths (release + fan-out), the squash subject
   is still the bump declaration. If `--title` was passed, use it verbatim (still
   run `derive-bump` above for the changelog `category`, and **warn** — don't block
   — if the supplied type contradicts the derived `type`/`releaseTriggering`).
   Otherwise build it straight from the derived fields:
   - **Prefix** = `type` (add a scope when one is obvious, e.g. `feat(<scope>):`), plus
     `!` when `breaking` — so `feat: <body>`, `fix: <body>`, `perf: <body>`,
     `docs: <body>`, `refactor: <body>`, `chore: <body>`, `feat!: <body>`, etc.
   - **Release-triggering** (`releaseTriggering: true`) → the prefix is already a
     release type (`feat`/`fix`/`perf`, or any `!`). Add the scope; that's it.
   - **Non-release** (`releaseTriggering: false`) → the prefix is a non-release type
     (`docs`/`refactor`/`chore`/`ci`/`build`/`test`/`style`).

   > ⚠️ **Keep the title honest with the commits.** A mistyped prefix misleads
   > reviewers and the completeness gate — a `feat:` on a docs-only branch, or a
   > `chore:` on a real fix. For feature PRs the post-merge bump follows the landed
   > commit subjects; for squash paths the title *is* the declaration. Derive the
   > title from the change's semantic category (the commit types) so they stay
   > aligned.

   When `releaseTriggering` is `false`, note `no release (<type>-only)` in the PR body
   so reviewers can confirm the non-release type was intentional.

### Step 7: Author or update the dated changelog entry — delegate to the `changelog` skill

> **Disabled entirely?** If `config.json` sets `changelog: false`, **skip Steps 7
> and 8 completely** — author nothing, run no `changelog` scripts, make no
> `docs(changelog)` commit — and note "changelog step disabled (no changelog flow in
> this repo)" in the run summary. This is for repos with no `changelog/` directory and
> no `changelog` skill installed; the category decision from Step 6 still drives the PR
> title. When `changelog` is unset or `true`, **always author an entry** (the
> `changelogScope` knob was removed — A-600).
>
> **An entry for every PR.** send-it authors a dated `changelog/` entry for **every**
> PR, release-triggering or not — the "record everything, filter later" model. The
> dated changelog is the full record of merged work; release notes filter it to the
> version-stamped (release-triggering) entries at release time, so a non-release entry
> simply carries no `version`. `changelog: false` is the only thing that suppresses
> authoring.

Follow the [`changelog`](../changelog/SKILL.md) skill to author or update the entry:

1. Detect an existing entry for this branch (by the `branch` frontmatter field) →
   update vs create. On update, preserve the filename and `created_at`.
2. Write/refresh `changelog/<YYYYMMDD-HHMMSS>-<slug>.md` (the `<slug>` from Step 6),
   deriving `title`/`release_note`/`issues` from the branch. Set `category` and
   `breaking` straight from `derive-bump`'s output (Step 6): `category` is its
   `category` field (`feature`/`fix`/`perf`/`docs`/`refactor`/`chore` — the changelog
   enum), and `breaking` is its `breaking` flag. For a non-release entry
   (`releaseTriggering: false`), `release_note` may be blank when there's no
   user-facing impact.

   Leave the post-merge fields (`merged_at`, `commit`, `pr`, `stats`)
   and `version` as blank placeholders — the post-merge enricher fills them (a non-release
   entry keeps `version` blank, as no release is cut for it). This includes `pr`: no
   step here writes it back after the PR opens; the post-merge enricher resolves it
   from the entry's `branch:`.
3. Run the enrichment scripts: `node skills/changelog/scripts/set-affected-packages.mjs`
   then `node skills/changelog/scripts/add-links.mjs`.
4. **Validate:** `node skills/changelog/scripts/validate-changelog.mjs`. It must pass
   before committing — if it fails, surface the error and abort; don't auto-fix.

### Step 8: Commit the changelog entry and push

> **`--dry-run` writes nothing from here on.** Steps 8–11 are the mutating half of the
> run. Under `--dry-run`, print what each would do and perform **none** of it: no
> `git commit`, no `git push`, no `gh pr create` / `gh pr edit`, no Linear transition
> (pass `--dry-run` down to `linear-sync` so `save_issue` is never called), and
> `--dry-run` on the Step 11 hand-off. A dry run may **read** — `gh pr view`, the
> triage-pr preview — but it never writes. Then exit 0.

If a `changelog/` entry was written in Step 7 (i.e. `changelog` is not `false`), commit
only that file:

```bash
git add changelog/<YYYYMMDD-HHMMSS>-<slug>.md
git commit -m "docs(changelog): <one-line summary>"
```

Then push the branch:

```bash
git push -u origin <branch>
```

### Step 9: Create or update the PR

`<title>` is the Conventional Commits PR title from Step 6 — set it on **both**
create and update (re-derive it every run so it stays in sync with the branch's
commits). Feature PRs are intended to merge via **merge commit**; release and
fan-out automation keep using squash outside this skill.

1. Check for an existing PR: `gh pr view --json number,url 2>/dev/null`.
2. **If creating:** `gh pr create --base <base> --draft --title "<title>" --body
   "<body>"`. Use `--ready` (the flag) instead of `--draft` if the user passed
   `--ready`.
3. **If updating:** `gh pr edit <number> --title "<title>" --body "<body>"`.
4. Return the PR URL and number via `gh pr view --json url,number`.

> **send-it never arms auto-merge.** It opens and updates the PR; landing it stays a
> human action (A-1151). The old `--merge-when-ready` flag — which armed
> `gh pr merge --auto --merge` here — is **gone as of 0.8.0**: from Step 11 onward, a
> run can be sitting at triage-pr's disposition envelope, and an armed auto-merge
> could land the branch while that plan is still awaiting approval. Merge by hand, or
> arm auto-merge yourself once you're happy with the PR.

**PR body template:**

```markdown
## Summary

- Comprehensive summary of all changes on this branch
- What changed and why

## Related Issues

<!-- Linear identifiers extracted from the branch and commits -->
- <ISSUE-ID>

## Test Plan

- [ ] <test>
```

Drop the `## Related Issues` section if no issues were found.

### Step 10: Transition linked Linear issues to In Review — delegate to the `linear-sync` skill

Follow the [`linear-sync`](../linear-sync/SKILL.md) skill with target state **In
Review**: read its `config.json` for `linearTeamName` and `issueKeys`, extract issue
IDs from the branch and commits, resolve the live state ID by team **name** (once),
and apply the transition idempotently (skip any issue already at or past In Review).
Skip silently if `linear-sync` or the Linear MCP server is unavailable.

### Step 11: Drive the PR to merge-ready — delegate to the `triage-pr` skill

send-it opens the PR; [`triage-pr`](../triage-pr/SKILL.md) takes it the rest of the
way (A-1151). **This step is part of the run — not an optional extra.** One
`/send-it` drives the whole pipeline: Phase A fixes in-scope CI failures and promotes
the proven-green draft to ready, then Phase B waits for the AI reviewers, verifies
every finding, and halts at its human envelope. This step runs **after** Step 10 so
the linked issues are already In Review before triage begins.

1. **Check the opt-out first — before anything else in this step.** If `--skip-triage`
   was passed, or `config.json` sets `triage: false`, print
   `ℹ️ triage chain skipped (--skip-triage): <reason>` — or `(triage: false)` — report
   the PR URL, and **stop the run here**. Do not run the install check, and do not
   start the cold-start poll: a skipped chain must cost nothing. That is the pre-0.8.0
   behaviour.

   > **Don't reach for it to finish sooner.** The opt-out exists for the cases where
   > the chain genuinely cannot work, not as a shortcut, and it is **never** the
   > default: `triage: true` ships in `config.example.json`, and `initialise-skills`
   > writes `true` when reconciling a consumer. Skipping leaves the PR un-triaged —
   > red CI unfixed, bot findings unread — which is the state this step exists to
   > prevent, so treat it the way Step 5 treats `--skip-preflight`: say **why** in the
   > report. The legitimate reasons are narrow: the PR changes the chain itself, so
   > the running prose and the prose on disk disagree (this bundle's own ship runs);
   > CI is gated on `draft == false`, so a draft never registers a check (prefer
   > `triage: false` in that repo's config over a per-run flag); or the user asked to
   > stop at the open PR. A missing `triage-pr` needs no flag — sub-step 2 handles it.

2. **Confirm `triage-pr` is installed** — look for `../triage-pr/SKILL.md` beside this
   bundle. If it is absent, print

   ```text
   ⚠️ triage-pr not installed — stopping at the open PR.
      Install it to chain: npx skills add <repo> --skill triage-pr --agent claude-code --copy
   ```

   and finish the run normally. A missing sibling **warns, never fails** — the same
   soft-skip contract Step 10 applies to `linear-sync`.

3. **Wait for CI to register — the cold-start gate.** Step 9 created or updated the PR
   moments ago, so GitHub Actions may not have registered a single check yet. An empty
   `statusCheckRollup` handed to a cold `triage-pr` reads as "nothing failing", and with
   `promoteOnGreen` on (its default) that would flip the draft to ready **before CI ever
   ran**. triage-pr's "no failures yet is not green" rule guards its own watch loop, not
   a cold entry — so send-it proves at least one check exists before handing off. Poll
   every **10 seconds** for up to **3 minutes**, in a **single** shell loop (not 18
   separate calls — a foreground `sleep` between tool calls is slow and some harnesses
   refuse it). Stay quiet while polling; no interim "still waiting" pings:

   Capture `gh`'s exit status separately from the count — a failed call returns an
   empty string, and treating that as "zero checks" would silently convert an auth or
   API error into a full-window wait and a bogus "CI never started" verdict:

   ```bash
   for _ in $(seq 1 18); do
     if ! checks=$(gh pr view <number> --json statusCheckRollup --jq '[.statusCheckRollup[]?] | length'); then
       echo "gh pr view failed — cannot verify CI has started" >&2
       exit 1
     fi
     [ "$checks" -gt 0 ] && break
     sleep 10
   done
   ```

   - **At least one check registered** → continue to sub-step 4.
   - **`gh` itself fails** → stop and surface the error (authentication, rate limit, a
     deleted PR). Do **not** fall through to the no-checks branch: an unverifiable
     state is not the same as a verified-empty one, and only the latter is safe to
     hand off.
   - **Still `0` when the window expires** → CI never started for this PR (a repo with
     no workflows, a `paths`-filtered or `draft == false`-gated workflow this PR doesn't
     match, or a stalled Actions queue). Report
     `⚠️ no checks registered within 3 minutes — handing off with --no-promote` and add
     `--no-promote` to the hand-off below, so an empty rollup can never be read as a
     proven green and flip the draft to ready. Nothing else about the chain changes.

4. **Hand off.** **If send-it was run with `--dry-run`, `--dry-run` goes on this
   command too — always.** A live `triage-pr` commits, pushes, and can flip the draft
   to ready, so a dry run that omits it stops being a dry run. Follow the
   [`triage-pr`](../triage-pr/SKILL.md) skill against the PR from Step 9, naming its
   number explicitly so it never re-resolves to a different PR:

   ```text
   triage-pr <number> [--dry-run] [--ci-only] [--no-promote] [--auto-apply]
   ```

   Forward `--dry-run`, `--ci-only`, `--no-promote`, and `--auto-apply` **verbatim**
   when they were passed to send-it, plus `--no-promote` when sub-step 3's cold-start
   gate added it — that one is a safety flag this step owns, not a user flag, and
   dropping it would let an unverified rollup promote a draft. Add nothing beyond
   those. `triage-pr` reads its own
   `config.json` (`promoteOnGreen`, `humanEnvelope`, `reviewBots`, `maxCiRounds`, …) —
   send-it configures nothing about it, exactly as it configures nothing about
   `commit`, `preflight`, `changelog`, or `linear-sync`.

5. **Run the full chain.** Don't stop between phases: Phase A's fix→push→watch loop,
   the promotion gate, then Phase B's review wait and verify-then-propose. Halt where
   `triage-pr` halts — its human envelope, its slow-bot micro-gate, a hard blocker, or
   `maxCiRounds` exhaustion. The envelope **is** the run's natural stopping point: don't
   answer it on the user's behalf, and don't print a send-it "all done" over the top of
   it.

6. **Report once.** `triage-pr`'s own final report is the run's report — prepend
   send-it's line items (branch, PR URL, changelog entry, Linear transitions) to it
   rather than emitting a second, competing summary. Respect triage-pr's quiet rule
   (A-1178): no interim pings around the hand-off.

> **`--dry-run` chains into `triage-pr --dry-run`.** When a PR already exists for the
> branch, hand off to `triage-pr <number> --dry-run` so the preview covers the failing
> checks and unresolved findings too. When no PR exists — a dry run creates none —
> print `no PR to triage yet` and exit 0. A dry run therefore makes **read-only** `gh`
> calls; it still writes nothing, commits nothing, and pushes nothing.
>
> **Re-runs are safe.** A second `/send-it` re-enters the chain against the same PR.
> `triage-pr` re-fetches threads every pass: resolved threads are filtered out, and
> proposed-defer threads already carry the non-resolving `defer-pending` marker (A-679),
> so they arrive as `deferredThreads`, not fresh findings. The envelope therefore
> re-prompts only for genuinely new bot findings.

## Flags

- `--dry-run` — print what would be written/submitted (changelog preview, branch,
  conventional PR title, any version-bump proposals), make no commits and no push. It
  chains into `triage-pr --dry-run` when a PR already exists for the branch (Step 11),
  so it makes **read-only** `gh` calls but still writes nothing. Exit 0.
- `--branch=<name>` — override the auto-derived branch name when running on the base
  branch with uncommitted changes.
- `--issue=<ID>` — prefix the auto-derived slug with a Linear issue ID (e.g.
  `--issue=A-7` → `a-7-<slug>`, lower-cased). Ignored if `--branch` is given.
- `--base=<branch>` — override `config.json`'s `baseBranch` for this run. Applies
  everywhere the base is used: the `git fetch`, the branch diff
  (`origin/<base>...HEAD`), the PR `--base`, and the `BASE_REF=origin/<branch>` env
  passed to `derive-bump.mjs` / `check-skill-bumps.mjs`. Use it for stacked PRs or a
  non-`main` target.
- `--title="<conventional subject>"` — set the PR title verbatim instead of deriving
  it (escape hatch for when derivation picks the wrong type). It must still be a valid
  Conventional Commits subject (CI lints it). `derive-bump` still runs (its `category`
  drives the changelog entry); send-it **warns** if the supplied type contradicts the
  derived `type`/`releaseTriggering`.
- `--skip-preflight` — skip the Step 5 lint gate entirely, printing a bypass warning.
- `--skip-triage` — end the run at the open PR: skip the Step 11 `triage-pr` chain
  (identical to `config.json` `triage: false`). Restores the pre-0.8.0
  bounded-finisher behaviour for one run. **Not a shortcut** — it leaves the PR
  un-triaged; see Step 11 for the narrow cases where it applies, and state the reason
  in the report.
- `--ci-only` — forwarded verbatim to `triage-pr` (Step 11): run its Phase A and stop
  at green, never promoting the draft. **No effect on send-it's own steps.**
- `--no-promote` — forwarded verbatim to `triage-pr`: never flip the draft to ready;
  stop at green. send-it also adds this itself when the cold-start gate times out.
  **No effect on send-it's own steps.** (`--promote` is deliberately *not* forwarded —
  promotion is already triage-pr's default.)
- `--auto-apply` — forwarded verbatim to `triage-pr`: skip its Phase B human envelope
  and restore its legacy auto path (impact-gated fix-now; Linear-only gate for
  defers). **No effect on send-it's own steps.**
- `--ready` — open the PR ready-for-review instead of draft (default is draft).
- `--worktree=<branch-or-path>` — `cd` into a worktree before running (Step 0).

`--merge-when-ready` was **removed in 0.8.0**. send-it no longer arms
`gh pr merge --auto --merge`; see the Step 9 callout.

## Notes

- **Prose follows the host repo's language convention.** Author the PR title, PR
  body, and commit messages in the consuming repo's documented prose language. Across
  this estate that is **British English** (`colour`, `behaviour`, `-ise`/`-yse`); the
  `changelog` skill applies the same rule to the entry it writes. This governs prose
  only — never identifiers, dependency names, or upstream API field names.
- **Trunk-based:** PRs target the base branch (`config.json` `baseBranch`, or
  `--base` for this run).
- **send-it bumps only per-bundle versions, never the repo version.** The optional
  Step 6 bundle-version check moves a changed skill's own `metadata.version`; the
  repo-level npm release stays owned by release-please (feature PRs: landed commit
  subjects; squash paths: squash subject / PR title).
- **send-it drives the pipeline now, not just the finish (A-1151).** Through 0.7.0 it
  was a bounded finisher: seconds of work, ending in a report and an open PR. From
  0.8.0 the default run continues into `triage-pr` (Step 11), so a single `/send-it`
  can stay unattended for roughly 30 minutes — CI fix rounds plus the review wait —
  and ends on a **prompt** (triage-pr's disposition envelope), not a report. That is a
  deliberate shift in what the command is. `--skip-triage`, or `triage: false`,
  restores the old shape.
- **send-it never merges, and never arms auto-merge.** Taking the PR to green and
  ready-for-review is the end of its remit; landing it is a human action.
- **CI gated on non-draft PRs makes the chain a tax.** send-it opens drafts by
  default, so a repo whose workflows carry `if: github.event.pull_request.draft ==
  false` registers zero checks until the PR is ready — the Step 11 cold-start gate
  then waits its full 3 minutes every run and hands off with `--no-promote` to a
  triage-pr with nothing to do. Use `--ready`, or set `triage: false`, in those repos.
- **Idempotent:** re-running send-it updates the existing PR title and changelog
  entry; the Linear writeback skips issues already In Review or beyond; the Step 11
  chain re-enters `triage-pr` against the same PR, whose `defer-pending` markers
  (A-679) keep already-dispositioned findings out of the envelope.
- **send-it does not bump versions or write any `CHANGELOG.md`.** release-please
  ranks Conventional Commits on trunk after merge (merge-commit history for feature
  PRs; squash subject for release/fan-out), bumps the manifest in the release PR, and
  the release workflow publishes + tags. send-it only writes the dated
  `changelog/<ts>-<slug>.md` entry (Step 7), finalised post-merge by the in-repo enricher.

## Error Handling

- **`gh auth status` fails** — run `gh auth login` first; abort until authenticated.
- **changelog validation fails** — surface the error; don't auto-fix. The user
  resolves the entry and re-runs.
- **No commits ahead of the base** — exit "No commits ahead of the base branch.
  Nothing to ship."
- **Branch push fails** — verify push access; ensure the remote is configured.
- **PR create/update fails** — verify the PR isn't closed; verify the branch is
  pushed.
- **`triage-pr` isn't installed** — warn and finish at the open PR (Step 11). A
  missing sibling never fails a send-it run.
- **No checks register within the cold-start window** — hand off with `--no-promote`
  and say why. An empty `statusCheckRollup` must never be read as green.
- **The triage chain fails, is aborted, or the envelope is declined** — the commits,
  changelog entry, PR, and Linear transitions from Steps 3–10 all stand. Re-run
  `/triage-pr <number>` directly rather than re-running the whole of send-it.
