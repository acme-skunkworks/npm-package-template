# Changelog entry contract

The full frontmatter schema and field-ownership rules the `changelog` skill
enforces. The bundled `scripts/validate-changelog.mjs` is the executable form of
this contract.

## Frontmatter schema

Preserve this field order. Emit `affected_packages: []` as a placeholder — the
enrichment script fills it in place.

```yaml
---
title: "Concise summary"
release_note: "One-sentence user-facing summary"
created_at: "2026-04-26T13:24:00Z"
merged_at:
branch: "<current-branch>"
pr:
commit:
merge_strategy:
author: "you@example.com"
co_authors: []
category: feature
breaking: false
issues: ["A-123"]
affected_packages: []
stats:
  files_changed:
  loc_added:
  loc_removed:
---
```

## Required fields

`validate-changelog.mjs` requires exactly four fields: `title`, `created_at`,
`category`, and `breaking`. Every other field — including `branch`, `author`,
`co_authors`, and `stats` — is validated **by type when present** but may be
omitted or left as a blank placeholder until enrichment.

## Field types and rules

| Field | Rule |
| ----- | ---- |
| `title` | Non-empty string. |
| `release_note` | String or `null`/blank when present. |
| `created_at` | ISO 8601 UTC with `Z` suffix, quoted. **Set once; never overwritten.** |
| `merged_at` | ISO 8601 UTC with `Z` suffix when set; blank until release. |
| `branch` | Non-empty string — the stable lookup key for enrichment. |
| `pr` | Integer when set; blank until the PR exists. |
| `commit` | 7-char hex SHA when set; blank until merge. |
| `merge_strategy` | One of `merge`, `rebase`, `squash`; blank until merge. |
| `author` | Non-empty string (an email). |
| `co_authors` | Array of strings (`[]` when none). |
| `category` | One of `feature`, `fix`, `chore`, `docs`, `refactor`, `perf`. |
| `breaking` | Boolean. If `true`, the body MUST contain a `## Breaking` section. |
| `issues` | Array of strings, each matching `[A-Z]+-\d+` (a one-or-more-letter team key, e.g. `A-123`). |
| `affected_packages` | Array of strings (`[]` when unpopulated). Monorepo-gated — emitted only when `affectedPackages: true` in `config.json`; absent (and clean) for single-package repos. |
| `stats.{files_changed,loc_added,loc_removed}` | Non-negative integers when set; blank until release. |

The filename must match `YYYYMMDD-HHMMSS-<slug>.md` (slug `[a-z0-9-]+`), and the
body must contain at least one of `## Breaking` / `## Added` / `## Changed` /
`## Fixed`.

## Field ownership boundaries

Four owners, never overlapping:

1. **The author (this skill).** `title`, `release_note`, `category`, `breaking`,
   `issues`, `co_authors`, `author`. Re-derived on every run.
2. **The enrichment scripts (deterministic, pre-merge).** `affected_packages` —
   when `affectedPackages: true`, `set-affected-packages.mjs` always overwrites it
   from the latest branch diff, so it tracks added commits; when `false` (the
   single-package default) the field is never emitted and the script is a no-op.
   `add-links.mjs` rewrites bare issue IDs in the body to Linear links.
3. **The release-orchestrator (post-merge, privileged).** `merged_at`, `commit`,
   `merge_strategy`, and authoritative `stats`, plus the published `version` where
   a consumer adds one. Emit these as blank placeholders; never hand-edit them —
   so an in-flight PR never shows numbers that drift as commits land.
4. **The ship flow (`/send-it`).** `pr` — back-filled when the PR is opened; left
   blank by the author and untouched by enrichment until then.

`branch` is set by the author at create time and is the stable lookup key for
enrichment.

`created_at` is **sacred**: set once at create time, preserved verbatim on every
update. The release step refuses to finalise an entry without it.

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

## Notes for adopters

- **Single-package repos** leave `affectedPackages: false` (the `config.json`
  default), which omits `affected_packages` and makes `set-affected-packages.mjs`
  a no-op — there is only one package, so the field is write-only noise. The
  validator treats `affected_packages` as optional-when-present, so leaving it out
  is fine. As shipped, `validate-changelog.mjs` requires only `title`, `created_at`,
  `category`, and `breaking`; `branch`, `author`, `co_authors`, and `stats` are
  validated by type when present but are not required.
- **Adding a `version` field.** A single-versioned package may add `version` to
  record the release each entry shipped in; that is owned by the release step,
  alongside the other post-merge fields.
- The `issueKeys`, `linearWorkspaceSlug`, and `baseBranch` knobs in `config.json`
  are the only repo-specific inputs; everything else in the contract is generic.
