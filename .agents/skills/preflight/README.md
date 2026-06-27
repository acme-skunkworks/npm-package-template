# preflight

Change-gated, branch-scoped lint preflight: lint only the categories a branch
touched (ESLint / markdownlint / actionlint) on `origin/<base>...HEAD` changed
paths, classify each violation as **introduced** vs **pre-existing**, and drive a
fix/defer loop via an exit-code contract (0 pass, 1 introduced/blocking, 2
pre-existing only).

## Install

From any consumer repo:

```bash
npx skills add https://github.com/acme-skunkworks/agent-skills --skill preflight --agent claude-code --agent cursor --copy
```

`--copy` writes real files so the bundle is portable. Don't use `-g` / `--global`
— the install should live in the consumer repo.

## Requirements

- Node.js ≥22 (per the package's `engines`) for the bundled scripts — **no npm
  dependencies**, Node built-ins only, no build step.
- The `git` CLI, for the branch/diff analysis.
- The consumer repo's own **ESLint** and **markdownlint-cli2** (invoked via
  `pnpm exec`), with their configs in place. preflight lints with your toolchain;
  it does not bundle linters.
- **actionlint** is optional: preflight warns and skips workflow linting if the
  binary isn't on `PATH`.
- The Linear MCP server is **optional**: the deferred-debt-issue step is skipped
  silently when it is unavailable.

## Configure

Both repo-specific inputs **auto-detect**, so most repos configure nothing:

- **Linted workspaces** come from `pnpm-workspace.yaml` + each package's `lint`
  script (a workspace without a `lint` script is excluded automatically).
- **Base branch** comes from `origin/HEAD`, falling back to `main`.

To override either, drop a `preflight.config.json` at your **repo root**. A
[`config.example.json`](config.example.json) ships as a template:

```json
{
  "baseBranch": "main",
  "workspaces": {
    "web": { "filter": "@acme/web", "prefix": "apps/web/" }
  }
}
```

Either key may be supplied on its own; the other is still auto-detected. Use the
override for non-pnpm repos, deliberate exclusions, or nested workspace globs the
detector does not expand.

## What it does

Run from the repo root:

```bash
node skills/preflight/scripts/preflight.mjs            # the gate
node skills/preflight/scripts/preflight.mjs --dry-run  # report scope only
node skills/preflight/scripts/lint-fix.mjs             # scoped --fix pass
```

`preflight.mjs` writes `.preflight-summary.json` (categories run, introduced vs
pre-existing counts) and exits `0` / `1` / `2` per the contract above. See
[`SKILL.md`](SKILL.md) for the full loop, including how a standalone `/preflight`
run differs from the lint gate inside a ship flow.
