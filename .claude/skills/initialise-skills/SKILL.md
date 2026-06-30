---
name: initialise-skills
description: >-
  Scan the host repo a set of agent skills is installed into and reconcile every
  installed skill's config.json with detected facts — base branch, monorepo
  package roots, changelog directory, Linear issue-key prefixes, review bots,
  protected branches — plus the Linear team name and workspace slug fetched via
  the Linear MCP. Use when first installing these skills into a repo, or to
  refresh the configs after the skill set or repo layout changes. Also ensures the
  preflight skill's `.preflight-summary.json` scratch output is gitignored.
  Idempotent and safe to re-run: it reconciles drift rather than clobbering
  deliberate manual edits, presents a dry-run diff first, and only writes after
  confirmation — preserving each config's key order and formatting so a no-op run
  leaves files byte-identical.
license: MIT
compatibility: >-
  Requires the `git` CLI (for base-branch and issue-key detection) and Node.js
  ≥22 for the bundled scripts (no npm dependencies — Node built-ins only, no build
  step). The Linear team name and workspace slug are fetched via the Linear MCP
  server when available; without it, those two values are flagged for manual
  input and everything else is still detected. Reads each installed skill's
  config.example.json for its key set, so newly-added skills are picked up with no
  change here.
metadata:
  version: 0.6.1
  author: Rob Easthope
allowed-tools: Read, Bash(node:*), Bash(git:*), mcp__linear-server__list_teams, mcp__linear-server__get_team
---

# initialise-skills

Populate and keep accurate the per-skill `config.json` files that the shared
agent skills (`changelog`, `send-it`, `cleanup-repo`, `linear-sync`, `triage-pr`,
…) read at runtime. Run inside the host repo, it detects repo facts, maps them
onto each installed skill's config schema, and writes accurate configs — without
ever clobbering a value a human deliberately set.

It is **dry-run first** and **idempotent**: the first step always previews the
diff, writes happen only after you confirm, and a re-run with nothing new to
detect leaves every file byte-for-byte unchanged.

## How it decides what to write

For each installed skill it loads two things: the skill's own
`config.example.json` (which defines the **set of keys** to reconcile) and the
existing `config.json` (which may be absent on a fresh install). Each key is then
classified by a three-way comparison — example placeholder vs existing value vs
detected value:

| Status | Meaning | Action |
| --- | --- | --- |
| `inferred` | No value yet, or still the example placeholder | Write the detected value |
| `unchanged` | Existing value already equals what we detected | No-op |
| `drift` | A real value that differs from detection — a deliberate edit | **Keep it**; report both values |
| `needs-manual-input` | No detector and no value (e.g. a Linear slug with no MCP) | Leave for you to supply |
| `manual-kept` | A real value we have no detector for | Keep it |
| `unknown-kept` | A key in `config.json` no skill template knows about | Keep it, untouched |

Detection is keyed by config-**key name**, not by skill, so one detector serves
every skill that uses a key (one `baseBranch` detector covers `changelog`,
`send-it`; one `issueKeys` detector covers `changelog`, `cleanup-repo`,
`linear-sync`). See [`references/detectable-keys.md`](references/detectable-keys.md)
for the full table of keys, their detection sources, and fallbacks.

`preflight` is intentionally skipped: it self-detects its base branch and
workspaces and reads an *optional* `preflight.config.json` at the repo root, not
an in-bundle `config.json` — so there is nothing for this skill to populate. (Its
one trace here is the `.gitignore` step below: when preflight is installed, its
`.preflight-summary.json` scratch output is added to the repo's `.gitignore`.)

## The `.gitignore` step

The `preflight` skill writes `.preflight-summary.json` to the repo root on every
real run, so without an ignore rule it surfaces as an untracked change after a
`/send-it` run. When `preflight` is installed, this skill ensures the host repo's
root `.gitignore` excludes it — the **one** mutation it makes outside a skill's
`config.json`. The edit is **append-only and idempotent**: it adds the commented
entry only when absent (creating `.gitignore` if there is none), and never
reorders or removes existing lines. The dry-run report shows the pending edit
(`will add …`); a re-run after writing reports `already ignored`.

## Process

1. **Dry run.** From the host repo root, run the bundled script for a machine-readable preview:

   ```bash
   node <skills-dir>/initialise-skills/scripts/initialise.mjs --dry-run --json
   ```

   `<skills-dir>` is wherever the bundles are installed (e.g. `skills/`,
   `.claude/skills/`, `.agents/skills/`); the script auto-detects its siblings
   relative to its own location, so usually you can just run it from the repo
   root. Parse the JSON: `skills[]` with per-key `status`, plus `driftKeys`,
   `manualKeys`, and `totals`.

2. **Fill the Linear facts.** For each `needs-manual-input` Linear key
   (`linearTeamName`, `linearWorkspaceSlug`), fetch the value via the Linear MCP
   when it is available — `mcp__linear-server__list_teams` for the team name, and
   the workspace slug from the team/organisation — otherwise ask the user. Collect
   these into a `facts` object.

3. **Present the diff and confirm.** Show the human report (re-run without
   `--json`, or render the parsed JSON). Call out the `inferred` keys that will be
   written, the `drift` keys that will be kept, and the `needs-manual-input` keys.
   **For each `drift` key, ask whether to accept the detected value** (the per-key
   opt-in). Gather the accepted ones into an `acceptDrift` map keyed by skill name,
   e.g. `{ "changelog": ["issueKeys"] }`. This is the confirmation gate — do not
   write before it.

4. **Write.** Re-run with `--write`, piping the gathered facts and drift opt-ins
   as stdin JSON:

   ```bash
   echo '{"facts":{"linearTeamName":"…","linearWorkspaceSlug":"…"},"acceptDrift":{"changelog":["issueKeys"]}}' \
     | node <skills-dir>/initialise-skills/scripts/initialise.mjs --write --json
   ```

   Report what was written from the returned `totals`, plus the `gitignore` field
   (its `status` — `added`, `created`, or `present`).

5. **Confirm idempotency.** Run the dry run once more; every key should now be
   `unchanged` (apart from drifts you chose to keep and any still-missing manual
   values), and `gitignore.status` should be `present`. This proves the configs
   and the `.gitignore` are stable and a future re-run is a no-op.

6. **Multi-bundle repos — one manual step.** If this repo itself ships several
   independently-versioned skill bundles, `send-it`'s `bundleVersioning` is **not**
   auto-written (it isn't in `send-it`'s `config.example.json` key set, so detection
   has nothing to populate). Add it to `send-it/config.json` by hand —
   `{ "root": "<bundle-dir>", "manifest": "package.json", "skillFile": "SKILL.md" }`
   — to enable the per-bundle version-bump check. Single-package repos skip this.

## Flags

- `--dry-run` (default) — detect, merge and report; write nothing.
- `--write` — apply the reconcile to each skill's `config.json`.
- `--json` — emit the machine-readable report (parse this to drive steps 2–3);
  human text otherwise.
- `--repo-root <path>` — the host repo the detectors scan (default: cwd).
- `--skills-dir <path>` — where the sibling bundles live (default: auto-detected
  relative to this script).
- **stdin JSON** — `{ "facts": { … }, "acceptDrift": { "<skill>": ["<key>"] } }`,
  read when stdin is piped (not a TTY). Each `acceptDrift` key may be a **skill
  name** (`"changelog"`) or the **repo-relative config path**
  (`"skills/changelog/config.json"`); its value is an array of key names.

## Safety

- **Dry-run first, write only after confirmation.** Nothing is written without an
  explicit `--write` pass gated on the user's go-ahead.
- **Never clobbers deliberate edits.** Drift is preserved unless you opt in per key.
- **No deletes, no reordering.** Existing keys keep their order; only changed keys
  are touched; consumer-added keys are left alone. A malformed existing
  `config.json` is skipped (reported, never overwritten).
- **The `.gitignore` edit is append-only.** The only file touched outside a
  skill's `config.json` is the repo's root `.gitignore`, and only to append the
  `.preflight-summary.json` entry when it is missing — never reordering or removing
  existing lines, and a no-op once present.

## Prerequisites

- The skills whose configs you want populated are installed alongside this one.
- A git repository with an `origin` remote for full base-branch / issue-key
  detection (both degrade to sensible fallbacks when absent).
- The Linear MCP server for the team name / workspace slug (optional — those two
  keys are flagged for manual input without it).
