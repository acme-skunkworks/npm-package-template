---
name: changelog
description: >-
  Author, refresh, or repair the changelog entry for the current branch — derive
  metadata, write the frontmatter and grouped body, run the deterministic
  enrichment scripts, and validate against the changelog contract. Use when asked
  to write or update a changelog entry, refresh an entry after new commits, or as
  the changelog step inside a ship/PR flow. Detects an existing entry for the
  branch (idempotent update-vs-create), keeps `created_at` sacred, leaves
  post-merge fields to the release step, and validates with a zero-dependency
  Node script.
license: MIT
compatibility: >-
  Requires Node.js ≥22 for the bundled scripts (no npm dependencies — Node
  built-ins only) and the `git` CLI for branch/diff analysis. The optional
  `preflight-changelog-ci.mjs` step assumes the consumer repo uses pnpm with a
  committed lockfile; skip it if yours does not.
metadata:
  version: 0.9.5
  author: Rob Easthope
allowed-tools: Write, Read, Edit, Glob, Grep, Bash(git:*), Bash(node:*), Bash(pnpm:*)
---

# changelog

Generate or update the changelog entry for the current branch under
`changelog/YYYYMMDD-HHMMSS-<slug>.md`: derive its metadata from git and the diff,
write the frontmatter and a grouped, categorised body, run the deterministic
enrichment scripts, then validate the result.

This skill is the single source of truth for **what a valid changelog entry is**
— the frontmatter schema, the field-ownership boundaries, idempotent
update-vs-create, and the validation gate. The same contract is enforced
downstream by a consumer repo's CI and by the post-merge enricher that fills the
post-merge fields (`@rheged-studio/changelog-core`, run in-repo by
`reusable-changelog-enrich.yml` — no longer a central release-orchestrator step),
so the authoring rules live here once.

It is invoked two ways:

- **Standalone** (`/changelog`) — author, refresh, or repair this branch's entry
  and leave it **uncommitted** in the working tree for review. No commit, push,
  or PR.
- **Inside a ship flow** (e.g. a `/send-it`) — the changelog step that runs
  before push; the ship flow **commits** the entry, pushes, and opens the PR.

## Configuration

Config lives in [`config.json`](config.json) beside this file; the bundled
scripts read it automatically. Edit your copied `config.json` to match the
consuming repo (a neutral [`config.example.json`](config.example.json) ships as a
template). `issueKeys` and `linearWorkspaceSlug` are **required** — they have no
default, so a missing `config.json` or either key absent makes the scripts fail
loudly rather than silently inherit ACME's identity. The rest are structural and
keep generic, overridable defaults:

| Key | Meaning | Default |
| --- | --- | --- |
| `issueKeys` | Team-key prefixes used to recognise issue IDs in the branch and body. The issue-ID regex is built from these. | **required** |
| `linearWorkspaceSlug` | Linear workspace slug used to build issue links (`https://linear.app/<slug>/issue/<id>`). | **required** |
| `baseBranch` | The trunk the branch diff is taken against (`origin/<baseBranch>`). Overridable per-run via the `BASE_REF` env var. | `"main"` |
| `changelogDir` | Directory the dated entries live in (scanned by the enrichment + validation scripts). | `"changelog"` |
| `packageRoots` | Monorepo dir prefixes mapping `<root>/<x>/…` → package `<x>` when deriving `affected_packages`. | `["apps", "packages", "services"]` |
| `fallbackPackage` | Package name for changed paths matching no `packageRoots` prefix. | `"infrastructure"` |
| `affectedPackages` | Whether to emit the `affected_packages` field at all. Leave `false` for single-package repos (the field is write-only and redundant there — entries stay clean); set `true` in genuine monorepos. `initialise-skills` flips it on when it detects a workspace config. | `false` |

All bundled scripts use only Node built-ins — no `npm install`, no build step.
They operate on the **consumer repo's root `changelog/` directory** (run them
from the repo root).

## Running it

### Step 1 — Detect an existing entry (idempotency)

Grep `changelog/` for a file whose frontmatter contains `branch: "<current-branch>"`.
If exactly one matches, you are in **update mode**: preserve its `created_at` and
filename, rewrite the rest. Otherwise you are in **create mode**.

### Step 2 — Analyse the branch

- `git log origin/<base>..HEAD --pretty=full` — full commit list including bodies
  and trailers.
- `git diff origin/<base>...HEAD --name-only` — changed files, for grouping the
  body by package.

`<base>` is `config.json`'s `baseBranch` (default `main`). Fetch it first
(`git fetch origin <base>`) so the diff is accurate — skip the fetch if the
caller already did it (e.g. a ship flow fetches in its preflight step).

### Multi-commit and merge-commit safety (A-825)

Authoring and post-merge enrichment are safe across **multi-commit feature
branches** and **merge merges** (as well as squash/rebase merges):

- **One entry per branch, not per commit.** Step 1 looks up by `branch:` in
  frontmatter; re-running `/changelog` after intermediate commits **updates** the
  same dated file — it never spawns a second entry for the same branch.
- **Branch analysis spans the whole PR.** Step 2 uses
  `git log origin/<base>..HEAD` (and the symmetric diff), so every commit on the
  feature branch contributes to metadata and body derivation regardless of how
  many commits land before merge.
- **Post-merge `commit` is the trunk merge SHA.** Finalise/enrich sets `commit` to
  the first seven characters of the merged PR's `mergeCommit.oid` — the commit
  that actually landed on trunk. For a **merge merge** that is the two-parent
  merge commit; for **squash** it is the single squash commit (which differs
  from the feature-branch tip).
- **`stats.commits` counts authored PR work, not merge noise.** The PR commits
  REST endpoint is scanned and commits with more than one parent (branch
  `main`-merge resolution commits) are excluded, so a multi-commit branch with
  occasional merge commits reports the correct authored count.

### Step 3 — Derive metadata

| Field          | How to derive                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `issues`       | Match the issue-ID regex (built from `issueKeys`) against the branch name (upper-cased) and against commit subjects/bodies. Deduplicate.               |
| `author`       | `git config user.email`.                                                                                                                               |
| `co_authors`   | Parse `Co-authored-by: Name <email>` trailers across all branch commits. Store the email or `Name <email>` form. Empty array if none.                  |
| `category`     | Infer from commit subjects and diff: `feature`, `fix`, `chore`, `docs`, `refactor`, `perf`. If ambiguous, ask the user to confirm.                     |
| `breaking`     | Infer from `BREAKING CHANGE:` trailers, `!` in conventional-commit subjects, or removal of public surfaces. If unclear, ask the user. Default `false`. |
| `release_note` | One-sentence user-facing summary distinct from `title`. Optional — leave blank if the change has no public-facing impact (chore, internal refactor).   |

**Field ownership** — what this skill authors vs. what it must leave alone is the
crux of the contract; see [`references/changelog-contract.md`](references/changelog-contract.md)
for the full rules. In short:

- **Authored here:** `title`, `release_note`, `category`, `breaking`, `issues`,
  `co_authors`, `author`, and — **only when `affectedPackages` is on** —
  `affected_packages` (written by the enrichment script in Step 5, not
  hand-edited). Single-package repos leave `affectedPackages: false` (the
  default) and omit the field entirely.
- **`created_at` is sacred** — set once on create (UTC time of first run); on
  update, preserve it verbatim.
- **Never authored here:** `stats` (`files_changed`, `loc_added`, `loc_removed`,
  `commits`) and the post-merge fields `merged_at` / `commit` / `pr`. The post-merge
  enricher finalises them from canonical GitHub PR data after merge — `pr` included, resolved
  from the merged PR by its `branch:` (never written by the ship flow). `commit` is the
  short SHA of `mergeCommit.oid` (trunk landing commit); `stats.commits` is the
  non-merge commit count on the PR branch (see **Multi-commit and merge-commit
  safety** above). Emit post-merge fields as blank placeholders on create; leave
  existing values untouched on update.

The skill **emits the derived `issues` array** as a handoff — a ship flow reuses
it for the PR body and any Linear writeback (e.g. via a `linear-sync` skill).

### Step 4 — Generate the body

Group bullets by package, categorised under `## Added` / `## Changed` / `## Fixed`.
Only include headings that have entries. For multi-package changes use
`**<pkg-name>:**` subheaders.

If `breaking: true`, the body MUST start with a `## Breaking` section describing
the change and the migration path.

Write the `title`, `release_note`, and body prose in the consuming repo's documented
prose language. Across this estate that is **British English** (`colour`, `behaviour`,
`-ise`/`-yse`) — prose only, never identifiers, dependency names, or upstream API
field names.

### Step 5 — Write or update the file

**Filename:** `changelog/YYYYMMDD-HHMMSS-<slug>.md`, where the timestamp is
`created_at` (UTC time of first run) and the slug derives from `title` (lowercase,
non-alphanumerics → `-`, collapse repeats, ~60-char cap on a word boundary).

**Always quote timestamp strings** in YAML (`created_at: "2026-04-26T13:24:00Z"`).
Unquoted ISO timestamps parse as Date objects and gain `.000Z` millis on the
enrichment round-trip; quoting keeps them lossless.

**On update:** preserve `created_at` and the filename; rewrite `title`,
`release_note`, `category`, `breaking`, `co_authors`, `issues`, and the body;
leave `merged_at` / `commit` / `pr` / `stats` alone (the
post-merge enricher fills them, `pr` branch-resolved).

Use the frontmatter field order shown in
[`references/changelog-contract.md`](references/changelog-contract.md). **Only when
`affectedPackages` is on**, emit `affected_packages: []` as a placeholder — the
script fills it in place. When it is off (the single-package default), omit the
field; `set-affected-packages.mjs` is a no-op.

Then run the two deterministic enrichment scripts from the consumer repo root
(both idempotent; they match the entry by its `branch:` frontmatter and leave the
post-merge fields blank):

```bash
node skills/changelog/scripts/set-affected-packages.mjs   # writes affected_packages from the branch diff
node skills/changelog/scripts/add-links.mjs               # rewrites bare issue IDs in the current branch's entry to Linear URLs
```

Adjust the path prefix if you installed the skill to a different location.

Both enrichment scripts also accept `--check` (alias `--dry-run`) — a read-only
preview that reports what would change and writes nothing, exiting `0` when the
entry is already up to date and `1` when a rewrite is needed (prettier-`--check`
style, so CI can gate on it):

```bash
node skills/changelog/scripts/set-affected-packages.mjs --check   # current branch's entry only
node skills/changelog/scripts/add-links.mjs --check               # ALL entries in the changelog dir
```

Both enrichers are **branch-scoped by default** (A-603): `add-links.mjs` with no
arguments rewrites only the entry/entries whose `branch:` frontmatter matches the
current git branch, so authoring a new entry never churns unrelated, already-merged
ones. Two modes still scan the **whole** directory: `--all` (a deliberate
full-directory rewrite) and `--check`/`--dry-run` (the completeness gate, which can
exit `1` on a historical entry). Use `--check` to confirm the directory is fully
enriched; use the default for the per-PR pass on one branch's entry. (When git is
unavailable the default falls back to the full sweep.)

### Step 6 — Validate against the contract

This is the gate:

```bash
node skills/changelog/scripts/preflight-changelog-ci.mjs   # optional: checks Node vs engines/.nvmrc, then pnpm install --frozen-lockfile
node skills/changelog/scripts/validate-changelog.mjs       # validates frontmatter schema, filename format, field types, ISO timestamps, Breaking section, issue IDs
```

`preflight-changelog-ci.mjs` is optional and pnpm-specific — skip it if the
consumer repo doesn't use pnpm. On failure, stop and fix the entry before
continuing — do not hand a malformed entry to the ship flow.

## Standalone vs inside a ship flow

- **Standalone (`/changelog`)** runs Steps 1–6 and then **reports**, leaving the
  entry **uncommitted** in the working tree for the user to review and commit. It
  never pushes or opens a PR.
- **Inside a ship flow** the same steps run before push; the ship flow then
  commits the entry (`docs(changelog): <title>`), pushes, and opens or updates the
  PR. It leaves `pr` blank — the post-merge enricher fills it,
  branch-resolved from the merged PR.

## Implementation

All the scripts the changelog lifecycle needs live under [`scripts/`](scripts/)
in this bundle and run on plain Node (no npm dependencies, no build step). They
cover the **whole lifecycle the bundle owns** — authoring (run by this skill) and
the post-merge finalisation/CI logic (see the note below on where that logic now
runs). Each takes `--help` (usage, exit 0) and `--self-test` (an offline smoke
test of its pure logic); the file-writing scripts also take `--check` /
`--dry-run` (report, write nothing).

**Authoring — run by this skill (the `/changelog` flow):**

- `scripts/set-affected-packages.mjs` — writes `affected_packages` from the branch diff (monorepo consumers only; a no-op when `affectedPackages` is off).
- `scripts/add-links.mjs` — rewrites bare issue IDs in the body to Linear URLs.
- `scripts/preflight-changelog-ci.mjs` — optional Node/lockfile CI-parity check (pnpm).
- `scripts/validate-changelog.mjs` — validates the entry against the contract.

**Post-merge finalisation and the CI gate — now run from `@rheged-studio/changelog-core`.**
The finalise/enrich/completeness logic has been extracted into the published
[`@rheged-studio/changelog-core`](https://www.npmjs.com/package/@rheged-studio/changelog-core)
package (CLI: `validate | enrich | finalise | set-affected-packages | add-links |
backfill-commits | check-completeness`). In-repo post-merge enrichment runs via the
shared-workflows `reusable-changelog-enrich.yml` (`mode: finalise` for npm targets,
`mode: enrich` for deploy targets), which invokes `changelog-core` and writes the
result back as `road-runner-bot[bot]`; CI `validate` and the completeness gate call
`changelog-core validate` / `changelog-core check-completeness`. This replaced the old
release-orchestrator inline finalise step and the retired daily `enrich-changelogs.yml`
cron (A-801) — **no central orchestrator or cron runs these any more.**

The equivalent bundled scripts below are the original zero-dependency implementation.
They remain **published skill source** (and are still `--help`/`--self-test`ed here),
so an adopter can wire them up directly, but a consumer on the shared workflow gets
this logic from `changelog-core`, not from these files:

- `scripts/finalise-changelog.mjs` — release-time enrichment + version-stamping for **npm targets**. For each un-finalised entry it resolves the merged PR via `gh`/`git`, fills the post-merge fields (`merged_at` / `commit` / `pr` / `stats`, the last including the merge-excluded `commits` count from the PR commits API), stamps `version` with the just-bumped `package.json` version, and links bare Linear IDs. It composes `lib/enrich.mjs` (the PR-metadata fill), `lib/commit-count.mjs` (the merge-excluded commit count) and `lib/stamp.mjs` (the version stamp).
- `scripts/enrich-changelog.mjs` — post-merge enrichment for **deploy targets** (octavo, shared-workflows), which are never checked out during the release flow and so can't finalise inline. It reads one merged PR's data from an env-var interface (`BRANCH_NAME` / `MERGED_AT` / `MERGE_SHA` / `PR_NUMBER` / `ADDITIONS` / `DELETIONS` / `CHANGED_FILES`), finds the entry by its `branch:`, and fills the same post-merge field group as finalise (minus `version`, which a deploy target's own tag flow owns, and minus `commits`, which the enrich path doesn't resolve). A thin wrapper over `lib/enrich.mjs`; fill-once and idempotent, so it can re-run safely. `--check` exits 1 when an entry still needs enriching; `--dry-run` previews.
- `scripts/check-changelog-completeness.mjs` — the **CI completeness gate**: a release-triggering (`feat`/`fix`/breaking) PR title must carry a dated `changelog/` entry, or the build fails.
- `scripts/backfill-commits.mjs` — a one-off backfill of `stats.commits` across the existing `changelog/` backlog (for adopting the count after the fact). Resolves each entry's merged PR via `gh`, splices in only the `commits` line (no re-serialise), and is idempotent; `--dry-run` previews. Not part of authoring or the release flow.

They share helpers under `scripts/lib/` (`changelog.mjs`, `derive-packages.mjs`,
`frontmatter.mjs`, `config.mjs`, `enrich.mjs`, `commit-count.mjs`, `stamp.mjs`). So this skill
itself stops at authoring + validation and leaves the post-merge fields blank; the
post-merge fields are filled after merge by `changelog-core` (via
`reusable-changelog-enrich.yml`), not by the `/changelog` flow.

> **Note for adopters:** unit tests for these scripts are maintained in the
> `agent-skills` repo (not bundled into the skill). See the skill's README.
