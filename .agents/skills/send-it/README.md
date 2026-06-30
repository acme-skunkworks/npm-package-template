# send-it

The all-in-one ship finisher. Finish coding, then run send-it: it commits
uncommitted work into atomic commits, runs the change-gated lint preflight,
authors or updates the dated `changelog/<ts>-<slug>.md` entry, composes a
**Conventional Commits PR title** (the squash subject release-please reads to
decide the version bump), pushes the branch, opens or updates a pull request, and
transitions the linked Linear issues to **In Review**.

It is a thin orchestrator: the lint gate, the changelog authoring, and the Linear
transition are delegated to the standalone [`preflight`](../preflight),
[`changelog`](../changelog), and [`linear-sync`](../linear-sync) skills. send-it
owns only the glue no sibling does — the branch guard, worktree resolution, atomic
commits, the release-type decision (by category), the PR-title composition, push, and
the PR.

## Install

From any consumer repo:

```bash
npx skills add https://github.com/acme-skunkworks/agent-skills --skill send-it --agent claude-code --agent cursor --copy
```

`--copy` writes real files so the bundle is portable. Don't use `-g` / `--global`
— the install should live in the consumer repo.

**Install the sibling skills too.** send-it delegates to `preflight`, `changelog`,
and `linear-sync`; install them alongside it (the changelog/Linear steps no-op
gracefully if a sibling is absent, but the flow assumes they are present):

```bash
npx skills add https://github.com/acme-skunkworks/agent-skills --skill preflight --skill changelog --skill linear-sync --agent claude-code --agent cursor --copy
```

## Configure

The shipped [`config.json`](config.json) parameterises the ship flow for this repo.
A neutral [`config.example.json`](config.example.json) ships alongside it as a
template — copy it over `config.json` and fill in your values, or edit `config.json`
directly.

| Key | Meaning | Default |
| --- | --- | --- |
| `baseBranch` | The trunk the branch diff is taken against (`origin/<baseBranch>`) and the PR base. | `"main"` |
| `shippablePaths` *(advisory)* | The published surface, as a documentation hint for reviewers — **not** the release decision (release-type is decided by the change's semantic category; see below). Kept for the optional publish-surface cross-check note. | `["skills/"]` |
| `shippableManifestKeys` *(advisory)* | `package.json` keys that form the published-`files` surface — same advisory role as `shippablePaths`, no longer a release gate. | `["name", "version", "files", "publishConfig"]` |
| `bundleVersioning` *(optional)* | For repos that ship many independently-versioned skill bundles. An object `{ root, manifest, skillFile }` that turns on the per-bundle version-bump check: when a bundle's content changed but its version didn't, send-it offers to bump its `manifest` `version` + `skillFile` `metadata.version` in lockstep. **Omit it in single-package repos** — the check no-ops. | unset (disabled) |
| `changelog` *(optional)* | Whether to author a dated `changelog/` entry at all. Set `false` only for repos with no changelog flow (no `changelog/` dir, no `changelog` skill). | `true` |

**Release-type is decided by category, not path (A-598).** send-it reads the
Conventional-Commit type of the work it committed: `feat`/`fix`/`perf` — or any
breaking change — cut a release; `docs`/`refactor`/`chore`/`ci`/`build`/`test`/`style`
do not, wherever the files live. So a docs-only edit under `skills/` is `docs:` (no
release), not `feat:`. `shippablePaths`/`shippableManifestKeys` are advisory only.

**Every PR gets a `changelog/` entry** when `changelog` isn't `false` — the
"record everything, filter later" model. Release notes filter the dated changelog to
the version-stamped (release-triggering) entries at release time. The old
`changelogScope` knob was removed (A-600); only the `changelog: true|false` master
switch remains.

The team name, issue-ID prefixes, and workspace slug are **not** configured here —
they live in the `linear-sync` and `changelog` skills' own `config.json` files,
which send-it's delegated steps read.

## Requirements

- `git` and `gh` CLIs (`gh` authenticated — `gh auth status`).
- Node.js ≥22 for the bundled `derive-bump.mjs` / `check-skill-bumps.mjs` helpers
  (Node built-ins only — no npm dependencies, no build step, no `tsx`).
- The sibling skills `preflight` and `changelog` installed in the consumer repo;
  `linear-sync` is recommended but optional — the In Review writeback is skipped
  if it (or the Linear MCP server) is unavailable.
- The Linear MCP server for the In Review writeback (delegated to `linear-sync`);
  skipped if unavailable.

## What it does not do

- It does **not** run typecheck, tests, or format checks — CI handles those. The
  only gate it runs is the change-gated `preflight` lint.
- It does **not** bump the repo/npm version or write any root `CHANGELOG.md` —
  release-please does that from the merged Conventional-Commit PR title. send-it only
  writes the dated `changelog/<ts>-<slug>.md` entry (the curated per-change record),
  which the release step finalises. (With `bundleVersioning` configured it *does*
  offer to bump a changed skill bundle's own `metadata.version` — a per-bundle label,
  separate from the repo release.)
