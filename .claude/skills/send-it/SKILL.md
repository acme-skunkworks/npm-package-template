---
name: send-it
description: >-
  The all-in-one ship finisher — bundle uncommitted work into atomic commits, run
  the change-gated lint preflight, author or update the dated changelog entry,
  compose a Conventional Commits PR title (the release-please bump signal), push,
  open or update a PR, and transition linked Linear issues to In Review. Use when
  asked to ship, send it, finish a branch, open or update a PR for the current
  work, or wrap up and push. A thin orchestrator that delegates the lint gate to
  the `preflight` skill, the changelog to the `changelog` skill, and the Linear
  writeback to the `linear-sync` skill; it owns the branch guard, atomic commits,
  shippability decision, PR-title composition, push, and PR. Shippable paths and
  the published surface are read from config.json so one skill serves monorepos
  and single-package repos alike.
license: MIT
compatibility: >-
  Requires the `git` and `gh` CLIs (`gh` authenticated). Node.js ≥22 for the
  bundled `derive-bump.mjs` / `check-skill-bumps.mjs` helpers (Node built-ins only —
  no npm dependencies, no build step, no tsx). Delegates to the `preflight`,
  `changelog`, and
  `linear-sync` skills — install them alongside this one. The In Review writeback
  needs the Linear MCP server (via `linear-sync`); it is skipped if unavailable.
metadata:
  version: 0.3.5
  author: Rob Easthope
allowed-tools: Write, Read, Edit, Glob, Grep, Bash(git:*), Bash(gh:*), Bash(pnpm:*), Bash(node:*), mcp__linear-server__get_issue, mcp__linear-server__save_issue, mcp__linear-server__list_issue_statuses
---

# send-it

Bundle uncommitted work into atomic commits, run the change-gated lint
[`preflight`](../preflight/SKILL.md), author or update the dated
`changelog/<ts>-<slug>.md` entry (via the [`changelog`](../changelog/SKILL.md)
skill), compose a **Conventional Commits PR title** (the squash subject
release-please reads to decide the version bump), push the branch, open or update
a pull request against the base branch, and transition any linked Linear issues to
**In Review** (via the [`linear-sync`](../linear-sync/SKILL.md) skill).

This skill is the single source of truth for the **ship flow**. It is a thin
orchestrator: it owns only the glue no sibling skill does — the branch guard,
worktree resolution, atomic commits, the shippability decision, PR-title
composition, push, and the PR — and delegates the rest:

- **Lint gate** → the `preflight` skill (change-gated; no-ops when nothing
  lint-relevant changed).
- **Changelog** → the `changelog` skill (author/update + validate; gated on
  shippability, and skipped entirely when `config.json` sets `changelog: false`).
- **Linear In Review** → the `linear-sync` skill (resolve state by team name,
  idempotent transition).

The delegated skills auto-detect their own scope, so monorepo features
(per-workspace ESLint fan-out, changelog `affected_packages`) no-op cleanly in a
single-package repo. send-it configures nothing about them.

> **Install the delegated skills alongside `send-it`.** This bundle invokes and
> links its siblings by relative path (`../preflight/SKILL.md`,
> `../changelog/SKILL.md`, `../linear-sync/SKILL.md`), so a `--skill send-it`-only
> install leaves the lint, changelog, and Linear steps unavailable and those links
> dangling. Install them together:
>
> ```bash
> npx skills add https://github.com/acme-skunkworks/agent-skills \
>   --skill send-it --skill preflight --skill changelog --skill linear-sync \
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
| `shippablePaths` | Path prefixes whose changes reach consumers. A change touching any makes the PR **shippable**. | `["skills/"]` |
| `shippableManifestKeys` | `package.json` keys whose change is itself shippable (the published-`files` surface). | `["name", "version", "files", "publishConfig"]` |
| `changelog` *(optional)* | Whether to author a dated `changelog/` entry at all (Steps 7–8). Set `false` for repos with **no changelog flow** — no `changelog/` directory and no `changelog` skill installed (e.g. a `private` repo with no release pipeline). When `false`, send-it skips changelog authoring entirely regardless of shippability, and the shippability decision continues to drive only the PR title. **Omit it (or set `true`) whenever the `changelog` skill is installed** — the default path stays shippability-gated. | `true` |
| `bundleVersioning` *(optional)* | Enables the per-bundle version-bump check (Step 6) for repos that ship many independently-versioned skill bundles. An object `{ root, manifest, skillFile }` naming the bundle parent dir and the manifest / skill-manifest filenames each bundle carries. **Omit it entirely in single-package repos** — the check then no-ops. | unset (disabled) |

The team name, issue-ID prefixes, and workspace slug are **not** configured here —
they live in the `linear-sync` and `changelog` skills' own `config.json` files,
read by the delegated steps.

## Prerequisites

- `gh` CLI installed and authenticated (`gh auth status`).
- The sibling skills (`preflight`, `changelog`, `linear-sync`) installed.

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

### Step 3: Commit uncommitted changes

send-it is the all-in-one finisher: whatever's uncommitted should be committed
before the changelog/PR work begins — but only what belongs to *this* branch.

1. `git status --porcelain`. If clean, skip this step.
2. Inspect uncommitted files: `git status --porcelain` for the list, `git diff` and
   `git diff --cached` for hunks.
3. **Filter for branch relevance.** Multi-worktree and multi-agent setups can leave
   stray files in the working tree that belong to other branches. Decide which
   uncommitted files are in scope:
   - Compute the merge base: `git merge-base HEAD origin/<base>`.
   - Files the branch already touches: `git diff --name-only <merge-base>...HEAD`.
   - **In scope** by default: any uncommitted file already touched on the branch,
     or sitting in a directory the branch already touches, or any uncommitted file
     when the branch has no commits yet (first run on a fresh branch).
   - **Out of scope** (suspicious): uncommitted files in directories the branch
     hasn't touched, when the branch already has its own commits.
4. Show the user the staging plan: in-scope files grouped by proposed commit, plus
   an explicit list of **out-of-scope files** flagged as "uncertain — possibly from
   another branch/worktree." Ask: "Stage in-scope files and create the commits
   below? (yes / no / customise)". Out-of-scope files are never staged
   automatically.
5. Group in-scope files into **logical atomic commits**:
   - One commit per coherent unit (a feature, a bug fix, a refactor, a docs change,
     a tooling tweak). Don't bundle unrelated edits.
   - Use Conventional Commits–style subjects (`feat:`, `fix:`, `chore:`, `docs:`,
     `refactor:`, `perf:`, `test:`), with a scope when one is obvious.
6. On confirmation, create the commits with `git add <specific files>` (never
   `git add -A`) and `git commit -m "<subject>"`.

If a pre-commit hook reformats files, the commit still succeeds with the formatted
content.

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

### Step 6: Decide shippability and compose the Conventional Commits PR title

Versioning is driven by [release-please](https://github.com/googleapis/release-please)
reading **Conventional Commits**. The repo squash-merges, so the **squash subject is
the PR title** — and that single conventional title is what release-please parses to
decide the bump. send-it composes a correct conventional title and (for shippable
changes) writes the dated changelog entry. It does **not** bump versions, write any
`CHANGELOG.md`, or tag.

1. **Derive the slug, bump level, and a draft body** from the branch commits via the
   bundled helper (zero-dep — no tsx):

   ```bash
   node skills/send-it/scripts/derive-bump.mjs
   ```

   It prints JSON: `{ "slug": "…", "bump": "…", "body": "…" }`, where `bump` is
   `major` / `minor` / `patch` (first match wins: a `BREAKING CHANGE:` trailer or a
   `!` in any conventional subject → major; first commit `feat:`/`feat(<scope>):` →
   minor; else patch) and `body` is the first commit's subject with its conventional
   prefix stripped.

2. **Decide whether this change is shippable.** Read `shippablePaths` and
   `shippableManifestKeys` from [`config.json`](config.json). A change is
   **shippable** (reaches consumers, so it must trigger a release) iff the branch
   diff touches **either**:
   - any path under a `shippablePaths` prefix, **or**
   - `package.json`, **and** the diff modifies any of the `shippableManifestKeys`.

   Verify with `git diff --name-only origin/<base>...HEAD`; for `package.json`, also
   run `git diff origin/<base>...HEAD -- package.json` and check whether any listed
   key appears in the hunks. Everything else — pure docs, CI/infra, agent tooling,
   ADRs, the dated `changelog/` itself, release-please config, or a lone
   `chore: update lockfile` — is **non-shippable**.

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

4. **Compose the PR title** as a single Conventional Commits subject — this is the
   release-please bump signal and is enforced by CI's PR-title lint. If `--title` was
   passed, use it verbatim (still run the shippability decision above for the
   changelog gate, and **warn** — don't block — if its type contradicts that
   decision). Otherwise:
   - **Shippable** → a **release-triggering** type from the bump: `major` →
     `feat!: <body>`; `minor` → `feat: <body>`; `patch` → `fix: <body>`. Add a scope
     when one is obvious (`feat(<scope>): …`).
   - **Non-shippable** → a **non-release-triggering** type that matches the change,
     never `feat`/`fix`: `docs:`, `chore:`, `ci:`, `refactor:`, `test:`, `build:`,
     `style:`, `perf:`. Pick by the dominant changed area / first commit's type.

   > ⚠️ **The PR title is the version.** A mistyped prefix silently ships the wrong
   > semver — a `feat:` on a docs PR cuts a needless release; a `chore:` on a real
   > fix ships nothing. There is no changeset file to cross-check against: the title
   > **is** the declaration. Match the type to the shippability decision exactly.

   When non-shippable, note `no release (developer-tooling/docs only)` in the PR body
   so reviewers can confirm the non-release type was intentional.

### Step 7: Author or update the dated changelog entry — delegate to the `changelog` skill

> **Disabled entirely?** If `config.json` sets `changelog: false`, **skip Steps 7
> and 8 completely** — author nothing, run no `changelog` scripts, make no
> `docs(changelog)` commit — and note "changelog step disabled (no changelog flow in
> this repo)" in the run summary. This is for repos with no `changelog/` directory and
> no `changelog` skill installed; the shippability decision from Step 6 still drives
> the PR title. When `changelog` is unset or `true`, follow the shippability gate
> below as normal.
>
> **Gated on shippability.** Author a `changelog/` entry **only when the change is
> shippable** (you composed a release-triggering `feat`/`fix`/breaking title). Skip
> it for non-shippable changes — the dated changelog mirrors the published-change
> surface, not every PR.

Follow the [`changelog`](../changelog/SKILL.md) skill to author or update the entry:

1. Detect an existing entry for this branch (by the `branch` frontmatter field) →
   update vs create. On update, preserve the filename and `created_at`.
2. Write/refresh `changelog/<YYYYMMDD-HHMMSS>-<slug>.md` (the `<slug>` from Step 6),
   deriving `title`/`release_note`/`category`/`breaking`/`issues` from the branch.
   `category` follows the bump (`feat`→`feature`, `fix`→`fix`, etc.); `breaking:
   true` iff the bump is `major`. Leave the post-merge fields (`merged_at`,
   `commit`, `pr`, `merge_strategy`, `stats`) and `version` as blank placeholders —
   the release step finalises them.
3. Run the enrichment scripts: `node skills/changelog/scripts/set-affected-packages.mjs`
   then `node skills/changelog/scripts/add-links.mjs`.
4. **Validate:** `node skills/changelog/scripts/validate-changelog.mjs`. It must pass
   before committing — if it fails, surface the error and abort; don't auto-fix.

### Step 8: Commit the changelog entry and push

If a `changelog/` entry was written (shippable), commit only that file:

```bash
git add changelog/<YYYYMMDD-HHMMSS>-<slug>.md
git commit -m "docs(changelog): <one-line summary>"
```

Then push the branch:

```bash
git push -u origin <branch>
```

### Step 9: Create or update the PR

`<title>` is the Conventional Commits PR title from Step 6 — release-please reads it
as the squash subject, so set it on **both** create and update (re-derive it every
run so it stays in sync with the branch's commits).

1. Check for an existing PR: `gh pr view --json number,url 2>/dev/null`.
2. **If creating:** `gh pr create --base <base> --draft --title "<title>" --body
   "<body>"`. Use `--ready` (the flag) instead of `--draft` if the user passed
   `--ready`.
3. **If updating:** `gh pr edit <number> --title "<title>" --body "<body>"`.
4. **If `--merge-when-ready` was passed:** after create/update, run `gh pr merge
   --auto --squash <number>` to enable auto-merge once requirements are met.
5. Return the PR URL via `gh pr view --json url -q '.url'`.

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

## Flags

- `--dry-run` — print what would be written/submitted (changelog preview, branch,
  conventional PR title, any version-bump proposals), make no commits, no push, no
  `gh` calls. Exit 0.
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
  Conventional Commits subject (CI lints it). The shippability decision still runs for
  the changelog gate; send-it **warns** if the supplied type contradicts it.
- `--skip-preflight` — skip the Step 5 lint gate entirely, printing a bypass warning.
- `--ready` — open the PR ready-for-review instead of draft (default is draft).
- `--merge-when-ready` — after create/update, enable `gh pr merge --auto --squash`.
- `--worktree=<branch-or-path>` — `cd` into a worktree before running (Step 0).

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
  repo-level npm release stays owned by release-please via the PR title.
- **Idempotent:** re-running send-it updates the existing PR title and changelog
  entry; the Linear writeback skips issues already In Review or beyond.
- **send-it does not bump versions or write any `CHANGELOG.md`.** release-please
  reads the merged Conventional-Commit PR title, bumps the manifest in the release
  PR, and the release workflow publishes + tags. send-it only writes the dated
  `changelog/<ts>-<slug>.md` entry (Step 7), finalised at release.

## Error Handling

- **`gh auth status` fails** — run `gh auth login` first; abort until authenticated.
- **changelog validation fails** — surface the error; don't auto-fix. The user
  resolves the entry and re-runs.
- **No commits ahead of the base** — exit "No commits ahead of the base branch.
  Nothing to ship."
- **Branch push fails** — verify push access; ensure the remote is configured.
- **PR create/update fails** — verify the PR isn't closed; verify the branch is
  pushed.
