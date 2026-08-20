# send-it

The all-in-one ship finisher. Finish coding, then run send-it: it commits
uncommitted work into atomic commits, runs the change-gated lint preflight,
authors or updates the dated `changelog/<ts>-<slug>.md` entry, composes a
**Conventional Commits PR title** (CI + humans; feature PRs merge via merge
commit and release-please ranks landed commit subjects for the bump — A-1176),
pushes the branch, opens or updates a pull request, transitions the linked
Linear issues to **In Review**, and then drives that PR to merge-ready.

It is a thin orchestrator: the commit step, the lint gate, the changelog authoring,
the Linear transition, and the post-PR triage are delegated to the standalone
[`commit`](../commit), [`preflight`](../preflight), [`changelog`](../changelog),
[`linear-sync`](../linear-sync), and [`triage-pr`](../triage-pr) skills. send-it
owns only the glue no sibling does — the branch guard, worktree resolution, the
release-type decision (by category), the PR-title composition, push, and the PR.

**From 0.8.0 the run continues past the open PR.** Its last step chains into
`triage-pr`: the Phase A CI fix loop, the promote-on-proven-green draft→ready flip,
then Phase B's review wait and verify-then-propose pass — halting at triage-pr's
human envelope. So a default run is unattended for roughly 30 minutes and ends on a
`[y/N]` prompt, not a report. The chain is **part of the run**: `--skip-triage` (or
`triage: false`) restores the older "stop at the open PR" shape, but it is for the
narrow cases where the chain cannot work — not a way to finish sooner. send-it never
arms auto-merge; merging stays a human action.

## Install

From any consumer repo:

```bash
npx skills add https://github.com/rheged-studio/agent-skills --skill send-it --agent claude-code --agent cursor --copy
```

`--copy` writes real files so the bundle is portable. Don't use `-g` / `--global`
— the install should live in the consumer repo.

**Install the sibling skills too.** send-it delegates to `commit`, `preflight`,
`changelog`, `linear-sync`, and `triage-pr`; install them alongside it (the
changelog, Linear, and triage steps no-op gracefully if a sibling is absent, but the
flow assumes they are present):

```bash
npx skills add https://github.com/rheged-studio/agent-skills --skill commit --skill preflight --skill changelog --skill linear-sync --skill triage-pr --agent claude-code --agent cursor --copy
```

## Configure

This skill ships only [`config.example.json`](config.example.json), a neutral
template — the per-skill `config.json` that parameterises the ship flow is
generated on install, not vendored. Run the `initialise-skills` skill to generate
`config.json` from the example with your repo's facts, or copy it to `config.json`
and fill it in by hand.

| Key | Meaning | Default |
| --- | --- | --- |
| `baseBranch` | The trunk the branch diff is taken against (`origin/<baseBranch>`) and the PR base. | `"main"` |
| `shippablePaths` *(advisory)* | The published surface, as a documentation hint for reviewers — **not** the release decision (release-type is decided by the change's semantic category; see below). Kept for the optional publish-surface cross-check note. | `["skills/"]` |
| `shippableManifestKeys` *(advisory)* | `package.json` keys that form the published-`files` surface — same advisory role as `shippablePaths`, no longer a release gate. | `["name", "version", "files", "publishConfig"]` |
| `bundleVersioning` *(optional)* | For repos that ship many independently-versioned skill bundles. An object `{ root, manifest, skillFile }` that turns on the per-bundle version-bump check: when a bundle's content changed but its version didn't, send-it offers to bump its `manifest` `version` + `skillFile` `metadata.version` in lockstep. **Omit it in single-package repos** — the check no-ops. | unset (disabled) |
| `changelog` *(optional)* | Whether to author a dated `changelog/` entry at all. Set `false` only for repos with no changelog flow (no `changelog/` dir, no `changelog` skill). | `true` |
| `triage` *(optional)* | Whether the run chains into [`triage-pr`](../triage-pr) once the PR is open — the CI fix loop, the promote-on-proven-green flip, then Phase B up to triage-pr's human envelope. Set `false` to stop at the open PR, or in repos where `triage-pr` isn't installed. It is also worth setting `false` where CI is gated on `draft == false`: send-it opens drafts, so no check ever registers and the chain waits out its cold-start window each run before degrading to `--no-promote`. | `true` |

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
- `triage-pr` for the final chain — optional: a missing one only warns, and the run
  finishes at the open PR.

## What it does not do

- It does **not** run typecheck, tests, or format checks — CI handles those. The
  only gate it runs is the change-gated `preflight` lint.
- It does **not** merge the PR, or arm auto-merge. It takes the PR to green, ready,
  and reviewed; landing it is a human action. (`--merge-when-ready`, which armed
  `gh pr merge --auto`, was removed in 0.8.0 — with the triage chain in play it could
  have landed a branch while its disposition plan awaited approval.)
- It does **not** bump the repo/npm version or write any root `CHANGELOG.md` —
  release-please does that from Conventional Commits on trunk (feature PRs: landed
  commit subjects under merge commits; release/fan-out squash paths: the squash
  subject). send-it only writes the dated `changelog/<ts>-<slug>.md` entry (the
  curated per-change record), which the post-merge enricher finalises. (With
  `bundleVersioning` configured it *does* offer to bump a changed skill bundle's own
  `metadata.version` — a per-bundle label, separate from the repo release.)
