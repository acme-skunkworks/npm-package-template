---
description: Bundle uncommitted work, write a dated changelog entry, set a Conventional Commits PR title, push the branch, open or update a PR.
allowed-tools: Write, Read, Edit, Glob, Grep, Bash(git:*), Bash(gh:*), Bash(pnpm:*), Bash(node:*), mcp__linear-server__get_issue, mcp__linear-server__save_issue, mcp__linear-server__list_issue_statuses
---

Bundle uncommitted work into atomic commits, author or update the dated `changelog/<ts>-<slug>.md` entry, compose a **Conventional Commits PR title** (the squash subject release-please reads to decide the version bump), push the branch, and open (or update) a pull request against `main`. Transition any linked Linear issues to **In Review**.

## Your Task

1. Branch guard (with auto-create on `main`).
2. Refresh the lockfile if `package.json` drifted.
3. Commit any uncommitted changes into logical atomic commits.
4. Fetch `origin/main` and analyse the full branch diff.
5. Decide shippability and compose the Conventional Commits PR title; author or update the dated `changelog/<slug>.md` entry.
6. Validate the changelog entry via `pnpm validate:changelog`.
7. Commit the changelog entry, push the branch, open or update a PR.
8. Transition linked Linear issues to **In Review**.

This command intentionally does NOT run lint, typecheck, tests, or format checks. CI handles those.

## Prerequisites

- `gh` CLI installed and authenticated (`gh auth status`).
- `pnpm install` has been run.

## Process

### Step 0: Worktree resolution (only if `--worktree=` is set)

If `--worktree=<branch-or-path>` was passed, resolve and `cd` into that worktree before any other step runs. Skip this step otherwise.

1. Run `git worktree list --porcelain` to get a list of worktrees with their paths and branches.
2. Resolve the argument:
   - **Absolute path** (starts with `/`): match against the `worktree <path>` field.
   - **Otherwise**: treat as a branch name and match against the `branch refs/heads/<name>` field.
3. **No match** — exit immediately with: `No worktree found for <arg>. Available: <comma-separated paths>`.
4. **Match** — `cd` into the resolved worktree path. The `cwd` persists for the rest of the workflow, so all subsequent `git` and `gh` calls operate on the worktree.
5. Continue to Step 1.

This step does nothing when `--worktree` is omitted — no-arg `/send-it` keeps working unchanged from whatever directory the session is in.

### Step 1: Branch guard

1. Get the current branch: `git branch --show-current`.
2. **If on `main`:**
   - Run `git status --porcelain`. If clean, exit with: "Nothing to ship from `main`. Create a feature branch first."
   - If there are uncommitted changes:
     - Inspect the diff (`git diff` and `git diff --cached`) and the changed file paths.
     - Derive a short kebab-case slug summarising the change (~3 words, lowercase, max ~40 chars). Examples: `add-readme-section`, `fix-config-typo`, `update-docs-headers`.
     - **Branch name resolution (in order):**
       1. `--branch=<name>` — use as-is.
       2. `--issue=<ID>` — use `<ID>-<slug>` (upper-case the team key, e.g. `ASW-7-as-acquired`).
       3. Otherwise — just `<slug>` (no `wip/` prefix).
     - If the chosen branch already exists locally or on `origin`, append `-2`, `-3`, ... until unused.
     - Run `git checkout -b <branch>` to move the working tree onto it.
     - Inform the user: "Was on `main` with uncommitted changes; created `<branch>` and continuing."
   - Continue with the rest of the workflow on the new branch.
3. **If on a feature branch:** continue.

### Step 2: Refresh lockfile if `package.json` drifted

Skip this step if no `package.json` was touched on the branch.

1. `git diff --name-only origin/main...HEAD | grep -E '(^|/)package\.json$'`. If empty, skip.
2. Run `pnpm install --frozen-lockfile`. If it succeeds, the lockfile is already in sync — continue.
3. If it fails, run `pnpm install` to update the lockfile.
4. If `pnpm-lock.yaml` changed, stage and commit it before any other commits go in:

   ```bash
   git add pnpm-lock.yaml
   git commit -m "chore: update lockfile"
   ```

This keeps CI's `--frozen-lockfile` install green.

### Step 3: Commit uncommitted changes

`/send-it` is the all-in-one finisher: you finish coding, run it, and it gets the work into a PR. So whatever's uncommitted at this point should be committed before the changelog/PR-title work begins — but only what belongs to _this_ branch's work.

1. `git status --porcelain`. If clean, skip this step.
2. Inspect uncommitted files: `git status --porcelain` for the list, `git diff` and `git diff --cached` for hunks.
3. **Filter for branch relevance.** Multi-worktree and multi-agent setups can leave stray files in the working tree that belong to other branches. Decide which uncommitted files are in scope:
   - Compute the merge base: `git merge-base HEAD origin/main`.
   - Files the branch already touches: `git diff --name-only <merge-base>...HEAD`.
   - **In scope** by default: any uncommitted file that's already touched on the branch, or that sits in a directory the branch already touches, or any uncommitted file when the branch has no commits yet (first run on a fresh branch).
   - **Out of scope** (suspicious): uncommitted files in directories the branch hasn't touched, when the branch already has its own commits.
4. Show the user the staging plan: in-scope files grouped by proposed commit, plus an explicit list of **out-of-scope files** flagged as "uncertain — possibly from another branch/worktree." Ask: "Stage in-scope files and create the commits below? (yes / no / customise)". Out-of-scope files are never staged automatically — the user has to opt them in.
5. Group in-scope files into **logical atomic commits**:
   - One commit per coherent unit (a feature, a bug fix, a refactor, a docs change, a tooling tweak).
   - Don't bundle unrelated edits into one commit — split by intent and area.
   - Use Conventional Commits–style subjects: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `perf:`, `test:`. Include a scope when one is obvious (`feat(auth): ...`).
6. On confirmation, create the commits with `git add <specific files>` (never `git add -A` — keeps unintended files out) and `git commit -m "<subject>"`.

If a pre-commit hook reformats files, the commit still succeeds with the formatted content.

### Step 4: Fetch main and confirm there's something to ship

```bash
git fetch origin main
```

If `git log origin/main..HEAD` is empty, exit with: "No commits ahead of `main`. Nothing to ship."

### Step 5: Decide shippability and compose the Conventional Commits PR title

Versioning is driven by [release-please](https://github.com/googleapis/release-please) reading **Conventional Commits**. The repo squash-merges, so the **squash subject is the PR title** — and that single conventional title is what release-please parses to decide the bump. `/send-it`'s job here is to compose a correct conventional PR title and (for shippable changes) write the dated `changelog/` entry. It does **not** bump versions, write any `CHANGELOG.md`, or tag — release-please (in the version PR) and `release.yml` (on `main`) do that.

1. **Compute the slug** from the current branch name: lowercase, replace non-alphanumeric runs with `-`, trim leading/trailing `-`, truncate to ~60 chars at a word boundary. Examples:
   - `asw-49-fold-in-send-it-claude-slash-command` → `asw-49-fold-in-send-it-claude-slash-command` (43 chars, no truncation).
   - `feature/very-long-branch-name-that-keeps-going-and-going-and-eventually-stops` → `feature-very-long-branch-name-that-keeps-going-and-going` (truncated at a word boundary).

2. **Derive the bump level and a draft body** from the branch commits. The deterministic bits live in `infrastructure/send-it/derive-changeset.ts` — invoke it:

   ```bash
   pnpm tsx infrastructure/send-it/derive-changeset.ts
   ```

   It prints JSON to stdout: `{ "slug": "...", "bump": "...", "body": "..." }`, where `bump` is `major` / `minor` / `patch` (first match wins: `BREAKING CHANGE:` trailer or a `!` in any conventional subject → major; first commit `feat:`/`feat(<scope>):` → minor; else patch) and `body` is the first commit's subject with its conventional prefix stripped. Unit tests live alongside (`pnpm test infrastructure/tests/derive-changeset.test.ts`).

3. **Decide whether this change is shippable.** A change is **shippable** (reaches consumers, so it must trigger a release) **only** if the branch diff touches any of:
   - any file under `src/`
   - `package.json`, **and** the diff modifies any of these keys: `name`, `version`, `main`, `module`, `exports`, `types`, `dependencies`, `peerDependencies`, `peerDependenciesMeta`, `files`, `publishConfig`

   These are the only paths whose changes reach consumers. `files: ["dist"]` in `package.json` plus npm's auto-bundling of `README.md` / `LICENSE` / `package.json` defines the shippable surface, and everything inside `dist/` is compiled from `src/**`. Verify with `git diff --name-only origin/main...HEAD`; for `package.json`, also run `git diff origin/main...HEAD -- package.json` and check whether any of the listed keys appear in the hunks.

   Everything else is **non-shippable** — pure docs (`README.md`), CI / infra (`.github/`, `.husky/`, `infrastructure/`, `.actrc`, `.yamllint.yml`, `.npmrc`, `.editorconfig`, top-level `eslint.config.ts`, `tsconfig.json`, `tsconfig.tools.json`, `tsconfig.eslint.json`, `vitest.config.ts`), agent tooling (`.claude/`, `.agents/`, `skills-lock.json`), release-please config (`release-please-config.json`, `.release-please-manifest.json`), or a lone `chore: update lockfile` commit.

4. **Compose the PR title** as a single Conventional Commits subject — this is the release-please bump signal and is enforced by CI's PR-title lint:
   - **Shippable** → a **release-triggering** type derived from the bump: `major` → `feat!: <body>` (or a normal type plus a `BREAKING CHANGE:` footer in the PR body); `minor` → `feat: <body>`; `patch` → `fix: <body>`.
   - **Non-shippable** → a **non-release-triggering** type that matches the change, never `feat`/`fix`: `docs:`, `chore:`, `ci:`, `refactor:`, `test:`, `build:`, `style:`, `perf:`. Pick by the dominant changed area / first commit's conventional type (e.g. a `.github/` or `infrastructure/` change → `ci:` or `chore:`; a `README.md` change → `docs:`).

   > ⚠️ **The PR title is the version.** A mistyped prefix silently ships the wrong semver — a `feat:` on a docs PR cuts a needless minor release; a `chore:` on a real fix ships nothing. There is no `.changeset/*.md` file to cross-check against any more: the title **is** the declaration. Match the type to Step 5.3's shippability decision exactly. CI's conventional-PR-title lint guards the format; the changelog-completeness gate guards that a `feat`/`fix`/breaking title carries a `changelog/` entry.

   When non-shippable, note `no release (developer-tooling/docs only)` in the PR body so reviewers can confirm the non-release type was intentional.

### Step 5b: Author or update the dated changelog entry

> **Gated on shippability.** Write a `changelog/` entry **only when the change is shippable** (the branch touches a shippable path per Step 5.3 — i.e. you composed a release-triggering `feat`/`fix`/breaking PR title). Skip it for non-shippable changes — the dated changelog mirrors the published-change surface, not every PR, so each entry stays tied to a version bump. This is the same coupling Changesets gave for free (no changeset → no release); under release-please it is re-enforced here **and** by CI's changelog-completeness gate.

The `changelog/` directory holds one dated Markdown file per shippable change — the curated, per-change, machine-readable record (there is no longer a root `CHANGELOG.md`; release-please runs with `skip-changelog`). Full schema in `changelog/README.md`. `/send-it` writes the PR-time fields; the release-please **release PR** finalises the entry at release — enriching `merged_at`/`commit`/`pr`/`merge_strategy`/`stats` from the merged PR and stamping `version` (the orchestrator runs `finalise-changelog.ts` after release-please each tick). No separate workflow or push to `main` is involved.

1. **Filename + timestamps.** `changelog/<YYYYMMDD-HHMMSS>-<slug>.md`, where `<slug>` is the same slug from Step 5.1 and the timestamp is UTC now:

   ```bash
   TS=$(date -u +"%Y%m%d-%H%M%S")          # filename prefix
   CREATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")  # created_at frontmatter
   ```

   **On update** — find an existing entry by matching the `branch` frontmatter field (not the filename; the timestamp won't match). If found, preserve its filename and `created_at`; rewrite only `title`/`release_note`/`category`/`breaking`/`issues` and the body.

2. **Frontmatter** — PR-time fields populated, enrichment fields left as empty placeholders:

   ```yaml
   ---
   title: "<concise summary>"
   release_note: "<one-line user-facing summary>"
   version:
   created_at: "<CREATED_AT>"
   merged_at:
   branch: "<current branch>"
   pr:
   commit:
   merge_strategy:
   author: "<git config user.email>"
   co_authors: []
   category: <feature|fix|chore|docs|refactor|perf>
   breaking: <true|false>
   issues: [<Linear IDs from Step 10>]
   stats:
     files_changed:
     loc_added:
     loc_removed:
   ---
   ```

   - `category`: derive from the PR-title type / bump (`feat`→`feature`, `fix`→`fix`, `perf`→`perf`, `refactor`→`refactor`, `docs`→`docs`, else `chore`). `breaking: true` iff the bump is `major`.
   - `co_authors`: emails from any `Co-authored-by:` trailers on the branch commits, else `[]`.
   - Wrap all ISO timestamps in quotes (YAML would otherwise parse them into Date objects — see `changelog/README.md`).

3. **Body** — `## Added` / `## Changed` / `## Fixed` sections (only those with content), mirroring the PR-title summary. If `breaking: true`, a `## Breaking` section MUST come first.

4. **Validate** — run `pnpm validate:changelog`; it must pass before committing.

### Step 6: Validate locally

> **Skipped for non-shippable branches** (no `changelog/` entry was written in Step 5b).

If a `changelog/` entry was written, run `pnpm validate:changelog`. It must pass before committing — if it fails, surface the error and abort. Don't auto-fix; the user resolves.

### Step 7: Commit the changelog entry

```bash
git add changelog/<YYYYMMDD-HHMMSS>-<slug>.md
git commit -m "docs(changelog): <one-line summary>"
```

If Step 5b was skipped (non-shippable branch), there's nothing to commit here — continue. Stage only the file that was actually written.

### Step 8: Push the branch

```bash
git push -u origin <branch>
```

### Step 9: Create or update the PR

`<title>` is the Conventional Commits PR title composed in Step 5.4 — release-please reads it as the squash subject to decide the bump, so it must be set on **both** create and update (re-derive it on every run so it stays in sync with the branch's commits).

1. Check for an existing PR: `gh pr view --json number,url 2>/dev/null`.
2. **If creating:** `gh pr create --base main --draft --title "<title>" --body "<body>"`. Use `--ready` (the flag) instead of `--draft` if the user passed `--ready`.
3. **If updating:** `gh pr edit <number> --title "<title>" --body "<body>"`.
4. **If `--merge-when-ready` was passed:** after creating or updating the PR, run `gh pr merge --auto --squash <number>` to enable auto-merge once requirements are met.
5. Return the PR URL via `gh pr view --json url -q '.url'`.

**PR body template:**

```markdown
## Summary

- Comprehensive summary of all changes on this branch
- What changed and why

## Related Issues

<!-- Linear identifiers extracted from the branch and commits -->

- ASW-123

## Test Plan

- [ ] <test>
```

Drop the `## Related Issues` section if no issues were found.

### Step 10: Transition linked Linear issues to **In Review**

1. Extract Linear issue IDs from the branch name and commit messages: regex `[A-Z]{2,}-\d+` against the upper-cased branch and against commit subjects/bodies. Deduplicate.
2. Call `mcp__linear-server__list_issue_statuses` with `team: "ACME Skunkworks"` **once** to resolve the live state for `In Review`. Pass the team _name_ rather than the key — Linear state IDs are per-team and the workspace's team has been renamed multiple times, so a hardcoded key (CAT → WTF → AKW → ASW) goes stale; the team _name_ hasn't moved.
3. For each ID (regex-only — no extra validation pass; bogus IDs simply error and are skipped with a warning):
   1. Call `mcp__linear-server__get_issue` to read the issue's current state.
   2. If state is `Triage`, `Backlog`, `Todo`, or `In Progress` → call `mcp__linear-server__save_issue` with `state: "In Review"`.
   3. If state is `In Review`, `Done`, `Canceled`, or `Duplicate` → skip silently.

## Flags

- `--dry-run` — print what would be written/submitted (changelog entry preview, branch, conventional PR title), make no commits, no push, no `gh` calls. Exit 0.
- `--branch=<name>` — override the auto-derived branch name when running on `main` with uncommitted changes.
- `--issue=<ID>` — prefix the auto-derived slug with a Linear issue ID (e.g. `--issue=ASW-7` → `ASW-7-<slug>`). Ignored if `--branch` is also given.
- `--ready` — open the PR as ready-for-review instead of draft (default is draft).
- `--merge-when-ready` — after creating or updating the PR, run `gh pr merge --auto --squash <number>` so it merges automatically once approvals + CI requirements are met.
- `--worktree=<branch-or-path>` — `cd` into a worktree before running. Accepts either a branch name (e.g. `ASW-7-as-acquired`) or an absolute path. Resolved via `git worktree list --porcelain`. Errors out if the value doesn't match any worktree.

## Arguments

$ARGUMENTS

## Notes

- **Trunk-based:** PRs target `main`.
- **Idempotent:** running `/send-it` again updates the existing PR title and changelog entry.
- **`/send-it` does not bump versions or write any `CHANGELOG.md`.** release-please (run by the orchestrator) reads the merged Conventional-Commit PR titles, bumps `package.json` + `.release-please-manifest.json` in the release PR, and `release.yml` on `main` handles npm publish + release tagging. There is no root `CHANGELOG.md` (release-please uses `skip-changelog`); `/send-it` _does_ write a dated `changelog/<ts>-<slug>.md` entry (Step 5b) — the curated per-change record — which is finalised (enriched + version-stamped) inside the release PR at release.
- **Single-package repo.** The PR title always describes the single `@acme-skunkworks/npm-package-template` package. If this repo ever splits into multiple packages, both the derive script and the PR-title convention need an updated affected-package detector.
- **Linear `In Review` writeback** runs after PR creation/update. Linked issues in Triage/Backlog/Todo/In Progress are transitioned; already-In-Review and Done/Canceled/Duplicate are skipped. Re-runs are idempotent.

## Steps Summary

0. (If `--worktree=` set) cd into the resolved worktree.
1. Branch guard (auto-create from `main` with smart slug if needed).
2. Refresh lockfile if `package.json` drifted.
3. Commit any uncommitted changes as logical atomic commits.
4. Fetch `origin/main`; confirm commits ahead.
5. Decide shippability (Step 5.3 allowlist) and compose the Conventional Commits PR title (Step 5.4): shippable → `feat!:`/`feat:`/`fix:` from the bump; non-shippable → a non-release type (`docs:`/`chore:`/`ci:`/…).
   - **5b.** Author or update the dated `changelog/<ts>-<slug>.md` entry, gated on shippability (only when the PR title is release-triggering). Validate with `pnpm validate:changelog`.
6. `pnpm validate:changelog`. Skipped if Step 5b was skipped.
7. Commit `docs(changelog): <title>` (staging the changelog entry, when written).
8. Push branch.
9. `gh pr create --draft` (or `--ready`) / `gh pr edit` with the Step 5.4 title; `--merge-when-ready` enables auto-merge.
10. Transition linked Linear issues to **In Review**.
11. Return PR URL.

## Error Handling

- **`gh auth status` fails** — run `gh auth login` first; abort `/send-it` until authenticated.
- **`pnpm validate:changelog` fails** — surface the error; don't auto-fix. The user resolves the changelog entry and re-runs.
- **No commits ahead of `main`** — exit with "No commits ahead of `main`. Nothing to ship."
- **Branch push fails** — verify push access; ensure remote is configured.
- **PR create/update fails** — verify the PR isn't closed; verify branch is pushed.
