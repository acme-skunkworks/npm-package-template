# initialise-skills

Scan the repo this set of agent skills is installed into and reconcile every
installed skill's `config.json` with detected facts — base branch, monorepo
package roots, changelog directory, Linear issue-key prefixes, review bots,
protected branches, plus the Linear team name and workspace slug. Idempotent and
safe to re-run: it reconciles drift rather than clobbering deliberate edits,
previews a dry-run diff first, and writes only after confirmation.

## Install

From any consumer repo:

```bash
npx skills add https://github.com/acme-skunkworks/agent-skills --skill initialise-skills --agent claude-code --agent cursor --copy
```

`--copy` writes real files so the bundle is portable. Don't use `-g` / `--global`
— the install should live in the consumer repo. Install it alongside the skills
whose configs you want populated (`changelog`, `send-it`, `cleanup-repo`,
`linear-sync`, `triage-pr`, …).

## Configure

This skill needs **no config of its own** — it has no per-repo knobs. Everything
it writes is detected from the host repo or supplied at run time (the Linear team
name / workspace slug via the Linear MCP, or by hand).

**Changing a setting later is safe by hand.** A *consumer's* per-skill
`config.json` is a real file you own: edit it directly to change a setting, and the
change **survives future re-runs** — the reconcile classifies a manual value as
`drift` and keeps it (never clobbering a deliberate edit), replacing it only if you
opt in per key. Use `--set <skill>.<key>=<value>` if you'd rather make the same
change through the tool; a direct hand-edit is equally supported.

## Use

Run it through your agent (it drives the dry-run → confirm → write flow), or
invoke the bundled script directly:

```bash
# Preview (writes nothing)
node skills/initialise-skills/scripts/initialise.mjs --dry-run

# Review the current config of every installed skill — read-only, no reconcile
node skills/initialise-skills/scripts/initialise.mjs --review

# Set an arbitrary value a detector wouldn't produce (repeatable; validated
# against the skill's config.example.json; dry-run first, --write to apply)
node skills/initialise-skills/scripts/initialise.mjs --set changelog.baseBranch=develop --write

# Write, supplying the facts the script can't detect on its own — and, optionally,
# the drifted keys you've chosen to accept (keyed by skill name or config path)
echo '{"facts":{"linearTeamName":"Acme Co","linearWorkspaceSlug":"acme-co"},"acceptDrift":{"changelog":["issueKeys"]}}' \
  | node skills/initialise-skills/scripts/initialise.mjs --write
```

`<skills-dir>` is auto-detected relative to the script, so running from the repo
root usually just works; override with `--skills-dir` / `--repo-root` if needed.

## What it does

For each installed skill it reads that skill's `config.example.json` (the key set
to reconcile) and its existing `config.json` (if any), then classifies each key by
a three-way comparison — example placeholder vs existing value vs detected value —
into `inferred` (write it), `unchanged`, `drift` (a deliberate edit — kept),
`needs-manual-input`, `manual-kept`, or `unknown-kept`. Only `inferred` keys are
written; drift is preserved unless you opt in per key. See
[`references/detectable-keys.md`](references/detectable-keys.md) for every key,
its detection source, and fallback.

To push a value detection can't derive, `--set <skill>.<key>=<value>` (repeatable)
writes an arbitrary value into a named skill's `config.json`, validated against
its `config.example.json` key set and placeholder type — dry-run first, `--write`
to apply, and it overrides detection for that key.

`preflight` is skipped on purpose — it self-detects base branch and workspaces and
reads an optional root-level `preflight.config.json`, so there is nothing in-bundle
to populate.

It also emits a committed **`.claude/skills.lock`** — a machine-readable inventory
of every installed skill's version plus the `source`/`ref` they came from
(supplied as `facts.lockSource` / `facts.lockRef`). Consumers commit it, and
`check-updates.mjs` uses it to report which skills are behind a target ref of the
source repo:

```bash
node skills/initialise-skills/scripts/check-updates.mjs --source <agent-skills-checkout> [--ref <tag-or-sha>]
```

See [`references/skills-lock.md`](references/skills-lock.md) for the lock schema and
the update-detection flow.

## Requirements

- `git` CLI (base-branch and issue-key detection; degrades to fallbacks if absent).
- Node.js ≥22 (per the package's `engines`) for the bundled scripts — no npm deps.
- The Linear MCP server is **optional**: the team name and workspace slug are
  fetched through it when present, and flagged for manual input when not.
