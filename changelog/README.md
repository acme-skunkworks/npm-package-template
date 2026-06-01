# Changelog

One Markdown file per change, capturing what changed and why. Entries are written by the `/send-it` slash command at PR-creation time and finalised by GitHub Actions after merge.

This is a browsable, per-change, machine-readable companion to the root `CHANGELOG.md` (which Changesets still owns for npm release notes). Each entry carries a `version` so it can be tied back to the published release it shipped in.

## File naming

```text
changelog/YYYYMMDD-HHMMSS-<slug>.md
```

- Timestamp is UTC and matches `created_at` in the frontmatter.
- Slug: lowercase, non-alphanumerics replaced with `-`, repeats collapsed, ~60-char cap on a word boundary.

## Frontmatter schema

```yaml
---
title: "Concise summary of the change"
release_note: "One-sentence user-facing summary" # optional; string or null
version: "1.0.3" # semver; filled at release
created_at: "2026-05-23T14:55:37Z" # set once; never overwritten
merged_at: # filled at release (finalisation)
branch: "asw-123-feature-slug" # stable lookup key for finalisation
pr: # filled at release
commit: # 7-char merge SHA; filled at release
merge_strategy: # squash | merge | rebase; filled at release
author: "you@example.com"
co_authors: []
category: feature # feature | fix | chore | docs | refactor | perf
breaking: false
issues: ["ASW-123"] # Linear issue IDs
stats: # filled at release (finalisation)
  files_changed: # integer
  loc_added: # integer
  loc_removed: # integer
---
```

### Differences from octavo's schema

This package is a single, semver'd npm package — not a monorepo — so the schema is adapted:

- **`version` added.** octavo has no version numbers; here every entry records the published release it shipped in.
- **`affected_packages` removed.** There is only one package.

### Required fields

`title`, `created_at`, `category`, `breaking`.

Everything else is validated _by type when present_ but not required. This lets two kinds of entry both validate:

- **Backfilled historical entries**, which have no `branch` / `author` / `stats`.
- **In-flight entries**, which have no `version` / `merged_at` / `pr` / `commit` / `stats` until they are enriched.

`/send-it` is the guarantee that new entries get `branch` / `author` / `co_authors`; validation is the safety net, not the sole guard.

> **Note on timestamps:** wrap ISO 8601 timestamps in quotes (`"2026-05-23T14:55:37Z"`). Unquoted timestamps are auto-parsed by YAML into Date objects, which round-trip with millisecond noise on enrichment. Quoting keeps them as exact strings.

### Categories

| Category   | When to use                                     |
| ---------- | ----------------------------------------------- |
| `feature`  | New user-facing capability                      |
| `fix`      | Bug fix                                         |
| `chore`    | Tooling, build, dependency bumps                |
| `docs`     | Documentation-only change                       |
| `refactor` | Internal restructuring with no behaviour change |
| `perf`     | Performance improvement                         |

If `breaking: true`, the body MUST contain a `## Breaking` section first, describing the change and the migration path.

## Body structure

```markdown
## Breaking <!-- only when breaking: true -->

- Description and migration steps

## Added

- Description

## Changed

- ...

## Fixed

- ...
```

Only include `Added` / `Changed` / `Fixed` headings that have entries.

## Lifecycle

Two stages — and finalisation rides inside the Changesets version PR, so there's no separate workflow and nothing pushes to `main`:

1. **Create or update an entry (PR-time):** run `/send-it` from a feature branch. It writes the entry with the PR-time fields (`title`, `release_note`, `created_at`, `branch`, `author`, `co_authors`, `category`, `breaking`, `issues`) and empty placeholders for the rest. The entry merges to `main` with the feature PR and waits.
2. **Finalise (at release, inside the version PR):** `changesets/action` runs `changeset version` then `finalise-changelog.ts`. For every entry without a `version`, it resolves the merged PR from the `branch` field via `gh` — filling `merged_at`, `commit`, `merge_strategy`, `pr`, and `stats` (`files_changed`, `loc_added`, `loc_removed`) — stamps the just-bumped `version`, and rewrites Linear IDs to links. The action commits these edits into the "release: version packages" PR, which publishes through the normal flow.

**CI validation:** the `infra` job in `ci.yml` runs `pnpm validate:changelog` on every PR. Malformed entries fail the check. Run it locally with:

```bash
pnpm validate:changelog
```
