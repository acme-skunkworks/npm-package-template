---
description: Bundle uncommitted work, write a Changesets entry, push the branch, open or update a PR.
allowed-tools: Write, Read, Edit, Glob, Grep, Bash(git:*), Bash(gh:*), Bash(pnpm:*), Bash(node:*), mcp__linear-server__get_issue, mcp__linear-server__save_issue, mcp__linear-server__list_issue_statuses
---

Bundle uncommitted work into atomic commits, author or update a `.changeset/<slug>.md` file, push the branch, and open (or update) a pull request against `main`. Transition any linked Linear issues to **In Review**.

## Your Task

1. Branch guard (with auto-create on `main`).
2. Refresh the lockfile if `package.json` drifted.
3. Commit any uncommitted changes into logical atomic commits.
4. Fetch `origin/main` and analyse the full branch diff.
5. Author or update the changeset entry (`.changeset/<slug>.md`).
6. Validate via `pnpm changeset status`.
7. Commit the changeset, push the branch, open or update a PR.
8. Transition linked Linear issues to **In Review**.

This command intentionally does NOT run lint, typecheck, tests, or format checks. CI handles those.

## Prerequisites

- `gh` CLI installed and authenticated (`gh auth status`).
- `pnpm install` has been run; `@changesets/cli` is wired up and `pnpm changeset status` works.

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

`/send-it` is the all-in-one finisher: you finish coding, run it, and it gets the work into a PR. So whatever's uncommitted at this point should be committed before the changeset work begins — but only what belongs to _this_ branch's work.

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

### Step 5: Author or update the changeset

> **Gated on Changesets being installed.** Run `pnpm changeset --version`. If the command fails (Changesets not yet wired up in this repo — tracked in **ASW-70**), skip Steps 5 and 6 entirely, print `/send-it: Changesets not installed yet — skipping changeset step. Tracked in ASW-70.`, and continue at Step 7. The gate auto-opens when ASW-70 lands `@changesets/cli`; no further spec edit is needed at that point.

Versioning lives in [Changesets](https://github.com/changesets/changesets). `/send-it` writes a single `.changeset/<slug>.md` per branch describing the user-facing change and the bump level. The release pipeline (`changesets/action` on `main`) reads these files, bumps versions, writes `CHANGELOG.md`, and tags the release — `/send-it` does **not** do any of that.

1. **Compute the slug** from the current branch name: lowercase, replace non-alphanumeric runs with `-`, trim leading/trailing `-`, truncate to ~60 chars at a word boundary. Examples:
   - `asw-49-fold-in-send-it-claude-slash-command` → `asw-49-fold-in-send-it-claude-slash-command` (43 chars, no truncation).
   - `feature/very-long-branch-name-that-keeps-going-and-going-and-eventually-stops` → `feature-very-long-branch-name-that-keeps-going-and-going` (truncated at a word boundary).

2. **Check for an existing entry** at `.changeset/<slug>.md`. If present, you're in **update mode** — preserve the bump line, rewrite the body. If absent, create a new file.

3. **Derive the bump level** from commits on the branch (in order — first match wins):
   - `BREAKING CHANGE:` trailer on any commit, OR a `!` in any conventional-commit subject (e.g. `feat!:`, `refactor!:`) → **major**.
   - First commit's subject starts with `feat:` or `feat(<scope>):` → **minor**.
   - Otherwise → **patch**.

   The deterministic bits live in `infrastructure/send-it/derive-changeset.ts` — invoke it to get the slug, bump level, and a draft body:

   ```bash
   pnpm tsx infrastructure/send-it/derive-changeset.ts
   ```

   It prints JSON to stdout: `{ "slug": "...", "bump": "...", "body": "..." }`. Unit tests live alongside (`pnpm test infrastructure/tests/derive-changeset.test.ts`). The slash command then writes the file.

4. **Decide whether a changeset is required.** A changeset is required **only** if the branch diff touches any of:
   - any file under `src/`
   - `package.json`, **and** the diff modifies any of these keys: `name`, `version`, `main`, `module`, `exports`, `types`, `dependencies`, `peerDependencies`, `peerDependenciesMeta`, `files`, `publishConfig`

   These are the only paths whose changes reach consumers. `files: ["dist"]` in `package.json` plus npm's auto-bundling of `README.md` / `LICENSE` / `package.json` defines the shippable surface, and everything inside `dist/` is compiled from `src/**`. Verify with `git diff --name-only origin/main...HEAD`; for `package.json`, also run `git diff origin/main...HEAD -- package.json` and check whether any of the listed keys appear in the hunks.

   Otherwise — including pure docs (`README.md`), CI / infra (`.github/`, `.husky/`, `infrastructure/` (including `infrastructure/scripts/`, `infrastructure/send-it/`, `infrastructure/tests/`), `.actrc`, `.yamllint.yml`, `.npmrc`, `.editorconfig`, top-level `eslint.config.ts`, `tsconfig.json`, `vitest.config.ts`), agent tooling (`.claude/`, `.agents/`, `skills-lock.json`, `.changeset/`), or a single `chore: update lockfile` commit — **skip the changeset step entirely**. Do **not** create a `.changeset/*.md` file. **Not even one with empty frontmatter.**

   > ⚠️ **Why empty changesets are toxic.** An empty `.changeset/*.md` (frontmatter `---\n---`, no package bumps) is not a no-op. `changesets/action` reads it as "there are pending changesets," refuses to open a Version Packages PR (no bumps to apply), and refuses to fall through to the "publish unpublished packages" path. The workflow logs `All changesets are empty; not creating PR` and exits clean while the next release silently stalls. This jammed v1.0.1 between May 8 and May 14, 2026 — see PR #16 / ASW-170. **An empty changeset is strictly worse than no file.**

   When skipped, the PR body should note `no changeset (developer-tooling only change)` so reviewers can confirm the skip was intentional.

5. **Frontmatter format** (Changesets standard):

   ```markdown
   ---
   "@acme-skunkworks/npm-package-template": patch
   ---

   One-line user-facing summary of the change.
   ```

   The body is a single paragraph (or short bullet list) phrased as a release-note line. Keep it factual — what changed, not why or how.

   Substitute `minor` or `major` for `patch` based on Step 5.3.

6. **On update**, preserve the bump level (don't downgrade a `major` to `patch` because a later commit was a docs tweak), rewrite only the body.

### Step 5b: Author or update the dated changelog entry

> **Same gate as the changeset.** Write a `changelog/` entry **only when Step 5 wrote a changeset** (the branch touches a shippable path per Step 5.4). Skip it whenever the changeset was skipped — the dated changelog mirrors the published-change surface, not every PR, so each entry stays tied to a version bump. If Step 5 was skipped, skip this step too.

The `changelog/` directory holds one dated Markdown file per shippable change — a browsable, per-change companion to the root `CHANGELOG.md`. Full schema in `changelog/README.md`. `/send-it` writes the PR-time fields; the Changesets **version PR** finalises the entry at release — enriching `merged_at`/`commit`/`pr`/`merge_strategy`/`stats` from the merged PR and stamping `version` (via `changeset:version` → `finalise-changelog.ts`). No separate workflow or push to `main` is involved.

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

   - `category`: derive from the changeset bump / conventional-commit types (`feat`→`feature`, `fix`→`fix`, `perf`→`perf`, `refactor`→`refactor`, `docs`→`docs`, else `chore`). `breaking: true` iff the bump is `major`.
   - `co_authors`: emails from any `Co-authored-by:` trailers on the branch commits, else `[]`.
   - Wrap all ISO timestamps in quotes (YAML would otherwise parse them into Date objects — see `changelog/README.md`).

3. **Body** — `## Added` / `## Changed` / `## Fixed` sections (only those with content), mirroring the changeset body. If `breaking: true`, a `## Breaking` section MUST come first.

4. **Validate** — run `pnpm validate:changelog`; it must pass before committing.

### Step 6: Validate locally

> **Skipped if Step 5 was skipped** (either by the Changesets-not-installed gate at the top of Step 5, or by the non-shippable-paths allowlist in Step 5.4).

Run `pnpm changeset status`. If it fails (no changesets when one is expected, or the file is malformed), surface the error and abort. Don't auto-fix; the user resolves.

If Step 5 was skipped because the branch is non-shippable per the Step 5.4 allowlist, `pnpm changeset status` may report "no changesets" — that's expected. The release-pipeline policy on whether unchangesetted PRs are allowed is governed by CI's `changesets/action` config, not by `/send-it`.

### Step 7: Commit the changeset and changelog entry

```bash
git add .changeset/<slug>.md changelog/<YYYYMMDD-HHMMSS>-<slug>.md
git commit -m "docs(changeset): <one-line summary>"
```

If Steps 5 and 5b were both skipped (non-shippable branch), there's nothing to commit here — continue. Stage only the files that were actually written.

### Step 8: Push the branch

```bash
git push -u origin <branch>
```

### Step 9: Create or update the PR

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

- `--dry-run` — print what would be written/submitted (changeset preview, branch, PR title), make no commits, no push, no `gh` calls. Exit 0.
- `--branch=<name>` — override the auto-derived branch name when running on `main` with uncommitted changes.
- `--issue=<ID>` — prefix the auto-derived slug with a Linear issue ID (e.g. `--issue=ASW-7` → `ASW-7-<slug>`). Ignored if `--branch` is also given.
- `--ready` — open the PR as ready-for-review instead of draft (default is draft).
- `--merge-when-ready` — after creating or updating the PR, run `gh pr merge --auto --squash <number>` so it merges automatically once approvals + CI requirements are met.
- `--worktree=<branch-or-path>` — `cd` into a worktree before running. Accepts either a branch name (e.g. `ASW-7-as-acquired`) or an absolute path. Resolved via `git worktree list --porcelain`. Errors out if the value doesn't match any worktree.

## Arguments

$ARGUMENTS

## Notes

- **Trunk-based:** PRs target `main`.
- **Idempotent:** running `/send-it` again updates the existing changeset and PR.
- **`/send-it` does not bump versions or write the root `CHANGELOG.md`.** The `changesets/action` workflow on `main` handles version bumps, root-CHANGELOG generation, npm publish, and release tagging. `/send-it` _does_ write a dated `changelog/<ts>-<slug>.md` entry (Step 5b) — the per-change companion — which is finalised (enriched + version-stamped) inside the Changesets version PR at release.
- **Single-package repo.** Changeset frontmatter always names `@acme-skunkworks/npm-package-template` (rename this to the generated package's name). If this repo ever splits into multiple packages, the derive script needs an updated affected-package detector.
- **Linear `In Review` writeback** runs after PR creation/update. Linked issues in Triage/Backlog/Todo/In Progress are transitioned; already-In-Review and Done/Canceled/Duplicate are skipped. Re-runs are idempotent.

## Steps Summary

0. (If `--worktree=` set) cd into the resolved worktree.
1. Branch guard (auto-create from `main` with smart slug if needed).
2. Refresh lockfile if `package.json` drifted.
3. Commit any uncommitted changes as logical atomic commits.
4. Fetch `origin/main`; confirm commits ahead.
5. Author or update `.changeset/<slug>.md` (slug from branch; bump from commits). **Gated** on `pnpm changeset --version` succeeding (skipped until ASW-70 installs Changesets — see gate at Step 5). Also skipped when the branch diff doesn't touch any shippable path (Step 5.4 allowlist) — in that case **no `.changeset/*.md` is written at all**, not even an empty one.
   - **5b.** Author or update the dated `changelog/<ts>-<slug>.md` entry, gated identically (only when a changeset was written). Validate with `pnpm validate:changelog`.
6. `pnpm changeset status`. Skipped if Step 5 was skipped.
7. Commit `docs(changeset): <title>` (staging the changeset **and** the changelog entry).
8. Push branch.
9. `gh pr create --draft` (or `--ready`) / `gh pr edit`; `--merge-when-ready` enables auto-merge.
10. Transition linked Linear issues to **In Review**.
11. Return PR URL.

## Error Handling

- **`gh auth status` fails** — run `gh auth login` first; abort `/send-it` until authenticated.
- **`pnpm changeset status` fails** — surface the error; don't auto-fix. The user resolves the changeset and re-runs.
- **No commits ahead of `main`** — exit with "No commits ahead of `main`. Nothing to ship."
- **Branch push fails** — verify push access; ensure remote is configured.
- **PR create/update fails** — verify the PR isn't closed; verify branch is pushed.
