# initialise-package-repo

One-shot, idempotent post-generation setup for a repo freshly created from
**npm-package-template**. It drives a spawned repo to a lint/build/release-ready
state in a single pass, so no one has to walk the manual generation checklist and
silently miss a step. Dry-run first, safe to re-run.

This is a **repo-local** skill: it lives in the template's own tree (not the shared
`agent-skills` bundle) because the settings it applies are specific to this
template's release shell. It travels into every spawned repo via "Use this
template", where it is run once.

## Use

Run it through your agent (it drives the dry-run → confirm → write flow across the
file edits, the wrapped `initialise-skills` run, and the GitHub settings), or invoke
the bundled script directly:

```bash
# Preview everything (writes nothing)
node .claude/skills/initialise-package-repo/scripts/initialise-package-repo.mjs --dry-run

# Apply just the in-repo file edits, supplying the human-authored facts
echo '{"facts":{"description":"My package","keywords":["a","b"]}}' \
  | node .claude/skills/initialise-package-repo/scripts/initialise-package-repo.mjs --write --files-only

# Apply just the GitHub settings (needs repo-admin)
node .claude/skills/initialise-package-repo/scripts/initialise-package-repo.mjs --write --github-only
```

## What it does

**In-repo file edits:** resets `changelog/` to just its `README.md` (the
changelog-poisoning fix), re-seeds `.release-please-manifest.json` to the starting
`package.json` version, rewrites the `package.json` identity and
`infrastructure/repo-config.yaml` from the repo's own facts (`gh repo view`).

**GitHub settings (via `gh api`):** creates the `npm-release` environment (main-only
policy), creates the `GO/NO GO` required-check ruleset (pinned to the GitHub Actions
integration), and enables the Release workflow.

**Wrapped:** runs the `initialise-skills` skill to generate each skill's
`config.json`.

**Reported, not automated:** authoring `src/`, release-orchestrator onboarding,
Claude review prerequisites, and the npm OIDC + first-publish bootstrap — the
steps that need org/browser/cross-repo privilege. See
[`README.md#setup`](../../../README.md#setup) for the authoritative checklist this
mirrors.

## Requirements

- `git` and `gh` CLIs; `gh` authenticated with **repo-admin** on the target repo.
- Node.js ≥22 for the bundled scripts — no npm dependencies, no build step.
- The `initialise-skills` skill installed alongside this one.

See [`SKILL.md`](SKILL.md) for the full step-by-step process and flags.
