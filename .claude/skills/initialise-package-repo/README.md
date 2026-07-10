# initialise-package-repo

One-shot, idempotent post-generation setup for a repo freshly created from
**npm-package-template**. It drives a spawned repo to a lint/build/release-ready
state in a single pass, so no one has to walk the manual generation checklist and
silently miss a step. Dry-run first, safe to re-run.

This is a **repo-local** skill: it lives in the template's own tree (not the shared
`agent-skills` bundle) because the settings it applies are specific to this
template's release shell. It travels into every spawned repo via "Use this
template", where it is run once. Committed shared skill bundles in the template are
**bootstrap only** — this skill **pulls** the locked set from `agent-skills` at
scaffold time (`npx skills add … --copy`, A-776) and never overwrites itself.

## Use

Run it through your agent (it drives the dry-run → confirm → write flow across the
file edits + skills pull, the wrapped `initialise-skills` run, and the GitHub
settings), or invoke the bundled script directly:

```bash
# Preview everything (writes nothing; skills pull reports pending)
node .claude/skills/initialise-package-repo/scripts/initialise-package-repo.mjs --dry-run

# Apply the in-repo file edits + shared-skills pull, supplying human-authored facts
echo '{"facts":{"description":"My package","keywords":["a","b"]}}' \
  | node .claude/skills/initialise-package-repo/scripts/initialise-package-repo.mjs --write --files-only

# Apply just the GitHub settings (needs repo-admin)
node .claude/skills/initialise-package-repo/scripts/initialise-package-repo.mjs --write --github-only
```

## What it does

**In-repo file edits:** resets `changelog/` to just its `README.md` (the
changelog-poisoning fix), re-seeds `.release-please-manifest.json` to the starting
`package.json` version, rewrites the `package.json` identity and
`infrastructure/repo-config.yaml` from the repo's own facts (`gh repo view`),
**pulls the shared skills** from `acme-skunkworks/agent-skills` into both agent
trees (`--copy`), and **clears the template-seed skill-config gitignore** (A-812)
so resolved per-skill `config.json` files are trackable and committed in the
consumer.

**GitHub settings (via `gh api`):** creates the `npm-release` environment (main-only
policy), creates the `GO/NO GO` required-check ruleset (pinned to the GitHub Actions
integration), ensures the Trunk road-runner-bot changelog bypass (ADR 0004 / A-808),
and enables the Release workflow.

**Wrapped:** runs the `initialise-skills` skill **after** the skills pull and
gitignore strip to generate each skill's `config.json` (then commit those files).

**Reported, not automated:** authoring `src/`, release-orchestrator onboarding,
`ROADRUNNER_*` selected access, Claude review prerequisites, and the npm OIDC +
first-publish bootstrap — the steps that need org/browser/cross-repo privilege. See
[`README.md#setup`](../../../README.md#setup) for the authoritative checklist this
mirrors.

## Requirements

- `git` and `gh` CLIs; `gh` authenticated with **repo-admin** on the target repo.
- Network access for `npx skills add` (shared-skills pull).
- Node.js ≥22 for the bundled scripts — no npm dependencies, no build step.
- Bootstrap skill copies from the template tree (refreshed by the pull).

See [`SKILL.md`](SKILL.md) for the full step-by-step process and flags.
