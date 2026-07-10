---
name: initialise-package-repo
description: >-
  One-shot, idempotent post-generation setup for a repo freshly created from
  npm-package-template. Drives it to a lint/build/release-ready state in a single
  pass: resets changelog/ to just its README (the changelog-poisoning fix),
  re-seeds .release-please-manifest.json to the starting package.json version,
  rewrites the package.json identity + infrastructure/repo-config.yaml from the
  repo's own facts, pulls the shared agent-skills set via npx skills add --copy
  (A-776), wraps and runs the initialise-skills skill to generate every skill's
  config.json, and applies the GitHub settings "Use this template" does not copy
  (the npm-release environment, the GO/NO GO required-check ruleset, the Trunk
  road-runner-bot changelog bypass, and enabling the Release workflow) — then
  verifies-and-reports the org/browser steps it deliberately cannot automate. Use
  right after "Use this template" on a spawned repo, or when asked to initialise /
  bootstrap / set up a newly-generated package repo. Dry-run first, safe to re-run
  (a second run is a no-op).
license: MIT
compatibility: >-
  Requires the `git` and `gh` CLIs (`gh` authenticated with repo-admin on the
  target repo — creating the environment and ruleset needs admin). Network access
  for `npx skills add` when pulling shared skills. Node.js ≥22 for the bundled
  scripts (Node built-ins only — no npm dependencies, no build step, no tsx).
  Wraps the `initialise-skills` skill — install it alongside this one; its
  Linear-facts step uses the Linear MCP server when present. Designed for a repo
  spawned from acme-skunkworks/npm-package-template; the GitHub-settings values
  (integration_id 15368, the npm-release environment, pkg-release.yml) are specific
  to that template's release shell.
metadata:
  version: 0.4.0
  author: Rob Easthope
allowed-tools: Read, Bash(node:*), Bash(git:*), Bash(gh:*), Bash(pnpm:*), Bash(npx:*), mcp__linear-server__list_teams, mcp__linear-server__get_team
---

# initialise-package-repo

Take a repo that was just created from **npm-package-template** via GitHub's "Use
this template" and drive it to a fully-configured, releasable state in one pass —
so no one has to walk the manual generation checklist and silently miss a step.

"Use this template" copies the whole default-branch tree but **not** repo/org
settings, and it copies files that must be _reset_ in the new repo. This skill owns
both halves: the in-repo file edits (including a **pull of the shared skills** from
`agent-skills` — A-776) and the deterministic GitHub settings, wrapping the
existing `initialise-skills` skill so per-package setup and per-skill `config.json`
generation happen together. It is **dry-run first** and **idempotent** — the
preview shows every pending change, writes happen only after you confirm, and a
re-run with nothing left to do is a clean no-op.

> **Why this exists (A-663).** The template dogfoods its own `changelog/`, so it
> ships dated entries documenting the _template's own_ development. Left in a
> spawned repo, the post-merge enricher would stamp the new package's first
> version onto every version-less entry and sweep them into its first release
> notes as noise — the 2026-07-02 poisoning incident that hit two live repos.
> Resetting `changelog/` is the flagship fix; the missed non-copied GitHub
> settings (npm-release env, GO/NO GO ruleset, Trunk changelog bypass) are the
> other half. The authoritative checklist this mirrors is
> [`README.md#setup`](../../../README.md#setup) (A-649).
>
> **Why it pulls skills (A-776).** Committed skill bundles in the template are
> bootstrap only — enough for this scaffolder to run after "Use this template".
> A spawned package then **pulls** the locked shared set once via
> `npx skills add … --copy`, rather than relying on stale copied trees or the
> estate's hourly skills push fan-out (this template is not a push consumer —
> A-774). Repo-local `initialise-package-repo` is never part of that pull set.

## What it changes vs. what it reports

**Automated — in-repo file edits (working tree):**

- **Reset `changelog/`** to just its `README.md` — delete every dated entry.
- **Re-seed `.release-please-manifest.json`** so `"."` equals the starting
  `package.json` version (the #1 release-please failure mode).
- **Rewrite the `package.json` identity** — `name`, `description`, `keywords`,
  `repository`, `homepage`, `bugs` — from the repo's own facts. Never touches the
  dependency/script shell, and never `src/`.
- **Reconcile `infrastructure/repo-config.yaml`** — `npmScope` and `defaultBranch`,
  preserving comments and quoting.
- **Pull the shared skills** — `npx skills add` from
  `acme-skunkworks/agent-skills` for the locked set (`changelog`, `cleanup-repo`,
  `commit`, `initialise-skills`, `linear-sync`, `preflight`, `release-status`,
  `send-it`, `triage-pr`) into both Claude Code and Cursor trees
  (`--agent claude-code --agent cursor --copy`). Does **not** overwrite this
  scaffolder.
- **Clear the template-seed skill-config gitignore** (A-812) — strip
  `.claude/skills/*/config.json` and `.agents/skills/*/config.json` (and the
  accompanying comment) from `.gitignore` so the resolved configs written next
  are trackable and can be committed. The ignore remains on the template seed
  only so "Use this template" never copies a local resolved config.

**Automated — GitHub settings via `gh api` (repo-admin required):**

- **Create the `npm-release` environment** (main-only deployment-branch policy).
- **Create the `GO/NO GO` required-check ruleset** (pinned to the GitHub Actions
  integration, `integration_id: 15368`).
- **Ensure the Trunk changelog bypass** (ADR 0004 / A-808) — repo-level `Trunk`
  ruleset with `road-runner-bot` (`2195582`) as a bypass actor so
  `pkg-release.yml`'s `changelog-enrich` job can push `changelog/**`. Creates
  `Trunk` when absent; merges the bypass into an existing repo-sourced Trunk
  without wiping other actors. Does **not** mutate the org-level
  `Protect main trunk` ruleset.
- **Enable the Release workflow** (`pkg-release.yml`, disabled on the template).

**Wrapped:** the **`initialise-skills`** skill, to generate each skill's
`config.json` from the corrected repo facts — run **after** the skills pull and
the skill-config gitignore strip so configs match the pulled bundle versions and
are left trackable for the consumer to commit (A-812).

**Reported, not automated** (org/browser/cross-repo privilege — the skill verifies
and prints exact next steps):

- Author the package's real `src/` API.
- Onboard the release-orchestrator (install road-runner-bot + add the `matrix.repo`
  entry — A-648).
- Confirm org secret `ROADRUNNER_PRIVATE_KEY` and org var `ROADRUNNER_CLIENT_ID`
  grant **selected** access to the new repo (required by `changelog-enrich`'s
  `secrets: inherit` App-token mint — A-821).
- Verify Claude review prerequisites (`CLAUDE_CODE_OAUTH_TOKEN` + the Claude App).
- npm OIDC Trusted Publisher + the manual first publish.

## Process

1. **Dry run.** From the host repo root, preview every pending change:

   ```bash
   node .claude/skills/initialise-package-repo/scripts/initialise-package-repo.mjs --dry-run --json
   ```

   The CLI reads the repo's identity via `gh repo view`. Exit code `3` means `gh`
   is unauthenticated or this is not a GitHub repo — resolve that (`gh auth login`)
   before continuing. Parse the JSON: `ops.files` (per file-edit status, including
   `skillsPull: pending`), `ops.github` (per setting), and `reminders` (the manual
   steps).

2. **Gather the human-authored facts.** The CLI auto-derives `name` and every URL
   from `gh repo view`, and `description` from the GitHub repo description. Ask the
   user for anything they want to override — chiefly the package **`description`**
   and **`keywords`** (the template defaults are placeholders). Collect them into a
   `facts` object: `{ name?, description?, keywords? }`.

3. **Present the diff and confirm the file edits.** Show the dry-run report. Call
   out the changelog entries to be deleted, the manifest re-seed, the identity
   rewrite, and the **pending shared-skills pull**. **This is the confirmation gate
   for the working-tree edits** — do not write before it.

4. **Apply the file edits** (including the skills pull), piping the gathered facts
   as stdin JSON:

   ```bash
   echo '{"facts":{"description":"…","keywords":["…"]}}' \
     | node .claude/skills/initialise-package-repo/scripts/initialise-package-repo.mjs --write --files-only --json
   ```

   `--files-only` runs the changelog/manifest/identity/repo-config edits **and**
   `npx skills add … --copy` for the locked shared set. Needs network. Confirm
   `ops.files.skillsPull.status` is `pulled` before continuing.

5. **Generate the skill configs.** Run the **`initialise-skills`** skill
   end-to-end (its own dry-run → confirm → write → idempotency flow, including the
   Linear-facts step via the Linear MCP). Do not reimplement it — invoke it. Must
   run **after** step 4 so configs match the just-pulled bundles and the
   skill-config gitignore has already been cleared. Remind the operator that the
   generated `.claude/skills/*/config.json` and `.agents/skills/*/config.json`
   files are **committed** in the consumer (agent-skills contract) — they are no
   longer gitignored after step 4.

6. **Confirm and apply the GitHub settings.** These need repo-admin and change
   server-side state, so confirm separately, then:

   ```bash
   node .claude/skills/initialise-package-repo/scripts/initialise-package-repo.mjs --write --github-only --json
   ```

   Each op is idempotent — it probes current state first and skips anything already
   present (env + main policy, a same-named ruleset, Trunk bypass present, an
   already-active workflow).

7. **Report the manual next steps.** Surface the `reminders` from the report — the
   `src/` API, orchestrator onboarding, `ROADRUNNER_*` selected access, Claude
   review prerequisites, and the npm OIDC bootstrap + first publish — each
   cross-linking its `README.md#setup` subsection. The repo is not "done" until
   these are handled.

8. **Confirm idempotency.** Re-run the dry run; every file/GitHub op should now
   report `unchanged` / `present` / `already-customised` (apart from the manual
   steps). The skills pull still reports `pending` on dry-run (it does not probe
   lock hashes) — a second `--write` re-pulls safely.

## Flags

- `--dry-run` (default) — detect and report; write nothing (skills pull reports
  `pending`, no network).
- `--write` — apply the changes (skills pull runs `npx skills add`).
- `--files-only` — only the in-repo file edits **and** the skills pull (Phase 4).
- `--github-only` — only the GitHub settings (Phase 6). Mutually exclusive with
  `--files-only`; omit both to do everything.
- `--json` — machine-readable report (parse this to drive the flow); human text
  otherwise.
- `--repo-root <path>` — the repo to operate on (default: cwd).
- **stdin JSON** — `{ "facts": { "name"?, "description"?, "keywords"? } }`, read
  when stdin is piped (not a TTY).

## Safety

- **Dry-run first, write only after confirmation.** Nothing is written without an
  explicit `--write` pass gated on the user's go-ahead. The file edits (incl.
  skills pull) and the GitHub settings have separate confirmation gates.
- **Idempotent.** Every op probes current state and no-ops when already done: the
  changelog reset is clean once only `README.md` remains; the manifest re-seed is a
  no-op when `"."` already matches; the identity rewrite is skipped once the name is
  no longer the placeholder; the environment/ruleset/workflow calls skip when
  already present. The skills pull is safe to re-run (`skills add --copy`
  refreshes in place) and never overwrites this scaffolder.
- **Never touches `src/`.** Replacing the placeholder API is the author's job —
  reported, not automated.
- **Only the deterministic GitHub settings are automated.** Org secrets, App
  installs, the orchestrator matrix, and the browser-driven npm bootstrap are
  verified-and-reported, never silently assumed done.

## Prerequisites

- A repo created from `acme-skunkworks/npm-package-template`.
- `gh` authenticated with **repo-admin** on the target repo (the environment and
  ruleset calls need admin).
- Network access for `npx skills add` (the shared-skills pull).
- Bootstrap copies of the shared skills (and this scaffolder) from the template
  tree — enough to run before the pull refreshes them.
- Node.js ≥22 for the bundled scripts (no npm dependencies).
