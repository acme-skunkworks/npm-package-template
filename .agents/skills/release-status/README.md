# release-status

Diagnose the **release-please** release pipeline, read-only. Preview the next
version from the merged Conventional-Commit PR titles since the last tag, show the
open `release-please--branches--main` PR and its required-check status, detect the
recurring stale `autorelease: pending` stall, and confirm tag-vs-version parity —
all without changing anything.

## Install

From any consumer repo:

```bash
npx skills add https://github.com/acme-skunkworks/agent-skills --skill release-status --agent claude-code --agent cursor --copy
```

`--copy` writes real files so the bundle is portable. Don't use `-g` / `--global`
— the install should live in the consumer repo.

## Configure

In the **source** repo this skill ships only
[`config.example.json`](config.example.json), a template — the per-skill
`config.json` is generated on install, never vendored from source. In a **consumer**
repo the resolved `config.json` **is** committed alongside the vendored bundle (it
holds that repo's real values and SKILL.md reads it as required runtime config).
Generate it by running the `initialise-skills` skill, or copy the example to
`config.json`, then edit it in your installed copy:

| Key | Meaning | Default |
| --- | --- | --- |
| `mainBranch` | The trunk release-please releases from. | `main` |
| `releaseBranch` | The branch release-please opens its release PR on. | `release-please--branches--main` |
| `requiredCheck` | The exact name (incl. emoji) of the required status check the orchestrator polls before merging the release PR. | `🔬 Build & Lint` |
| `stalePendingLabel` | The label release-please applies while a release is in flight; **stale** when it lingers on a *merged* PR. | `autorelease: pending` |

## Requirements

- `gh` CLI, authenticated (`gh auth status` must pass) — used to read the release
  PR, its checks, and merged PRs.
- `git` — used to read the root `package.json` version, the tags, and the last
  tag's date.
- Node.js >=22 (ES-module support), for the bundled diagnosis helper. No npm
  dependencies, no build step.

## What it does

The bundled `scripts/release-status.mjs` gathers four independent signals and
prints a structured report (or `--json`):

1. **Version preview** — the bump and version the merged Conventional-Commit PR
   titles since the last tag imply (`feat:`→minor, `fix:`/`perf:`/`revert:`→patch,
   `!`/`BREAKING CHANGE:`→major; `docs`/`chore`/`ci`/… cut no release).
2. **Release PR** — the open `release-please--branches--main` PR (if any) and its
   required-check (`🔬 Build & Lint`) status.
3. **Stale `autorelease: pending`** — whether the last merged release PR still
   carries the pending label, the recurring stall where release-please aborts and
   releases stop firing.
4. **Tag-vs-version parity** — whether a `v<package.json version>` tag exists
   (clean no-op) or is missing (a publish is pending) — the `release.yml`
   version-vs-tag gate.

```bash
node scripts/release-status.mjs                    # human-readable report
node scripts/release-status.mjs --json             # machine-readable JSON
node scripts/release-status.mjs --repo owner/name  # target a repo (else auto-detected)
node scripts/release-status.mjs --self-test        # offline assertions (no network)
node scripts/release-status.mjs --help             # usage (alias: -h)
```

## Read-only / advisory

This skill **changes nothing** — no commits, labels, PR edits, tags, or releases.
It is a **sibling of `send-it`, not invoked by it**: `send-it` is the pre-merge
ship flow (it stops at In Review); `release-status` inspects post-merge `main`.
When it detects the stale-pending stall, it reports the remediation (remove the
label from the merged release PR, then re-run the orchestrator) for a human or a
write-capable tool to carry out.
