# changelog

Author, refresh, or repair the changelog entry for the current branch under
`changelog/YYYYMMDD-HHMMSS-<slug>.md` — derive metadata, write the frontmatter and
grouped body, run the deterministic enrichment scripts, and validate against the
changelog contract.

## Install

From any consumer repo:

```bash
npx skills add https://github.com/acme-skunkworks/agent-skills --skill changelog --agent claude-code --agent cursor --copy
```

`--copy` writes real files so the bundle is portable. Don't use `-g` / `--global`
— the installation should live in the consumer repo.

## Configure

This skill ships only [`config.example.json`](config.example.json), a neutral
template — the per-skill `config.json` is generated on install, not vendored.
`issueKeys` and `linearWorkspaceSlug` are **required and have no default** — a
missing `config.json`, or either key absent, makes the scripts **fail loudly**
rather than silently inherit another org's identity (which would emit wrong
issue-ID detection and Linear links in a foreign repo). Run the
`initialise-skills` skill to generate `config.json`, or copy
[`config.example.json`](config.example.json) to `config.json` and set them for
your organisation. The remaining keys are structural and keep generic, overridable
defaults.

| Key | Meaning | Default |
| --- | --- | --- |
| `issueKeys` | Team-key prefixes used to recognise issue IDs in the branch and body. | **required** |
| `linearWorkspaceSlug` | Linear workspace slug for issue links (`https://linear.app/<slug>/issue/<id>`). | **required** |
| `baseBranch` | Trunk the branch diff is taken against (`origin/<baseBranch>`); `BASE_REF` env overrides per-run. | `"main"` |
| `changelogDir` | Directory the dated entries live in (scanned and validated). | `"changelog"` |
| `affectedPackages` | Monorepo gate. When `true`, emit and maintain `affected_packages` from the branch diff; single-package repos leave it `false`, which omits the field and makes `set-affected-packages.mjs` a no-op. | `false` |
| `packageRoots` | Monorepo dir prefixes mapping `<root>/<x>/…` → package `<x>` for `affected_packages`. | `["apps", "packages", "services"]` |
| `fallbackPackage` | Package name for changed paths matching no `packageRoots` prefix. | `"infrastructure"` |

## Requirements

- **Node.js ≥22** for the bundled scripts. They use **only Node built-ins** — no
  `npm install`, no build step.
- The **`git` CLI** for branch and diff analysis.
- **pnpm** *only* for the optional `preflight-changelog-ci.mjs` step (Node/lockfile
  CI-parity). Skip that step if your repo doesn't use pnpm.

## What it does

Detects the branch's existing entry (idempotent update-vs-create), derives the
metadata from git and the diff, writes the frontmatter + grouped/categorised body,
runs the enrichment scripts (`set-affected-packages.mjs`, `add-links.mjs`), and
validates with `validate-changelog.mjs`. `created_at` is set once and never
overwritten; `stats` and the post-merge fields are left blank for the release step.

Run standalone via `/changelog` (writes/validates, leaves the entry **uncommitted**)
or as the changelog step inside a ship flow. See [`SKILL.md`](SKILL.md) for the
six-step process and [`references/changelog-contract.md`](references/changelog-contract.md)
for the full frontmatter schema and field-ownership rules.

## Scripts and tests

The bundled scripts are the **zero-dependency `.mjs`** set (Node built-ins only),
deliberately chosen so the bundle is drop-in with no tooling. They span the whole
changelog lifecycle: the authoring scripts the skill runs (`set-affected-packages`,
`add-links`, `preflight-changelog-ci`, `validate-changelog`) and the
finalisation/CI-gate scripts the consumer wires into its `package.json` / CI /
release orchestrator (`finalise-changelog` for npm targets, `enrich-changelog` for
deploy targets, `check-changelog-completeness`) — see the SKILL.md
"Implementation" section for which actor runs each. Every script takes
`--help` (usage, exit 0) and `--self-test` (an offline smoke test of its pure
logic). Their **unit tests are maintained in the
[`agent-skills`](https://github.com/acme-skunkworks/agent-skills) repo**, not
bundled into the skill — see that repo's test suite for coverage.
