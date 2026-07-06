---
name: initialise-skills
description: >-
  Scan the host repo a set of agent skills is installed into and reconcile every
  installed skill's config.json with detected facts — base branch, monorepo
  package roots, changelog directory, Linear issue-key prefixes, review bots,
  protected branches — plus the Linear team name and workspace slug fetched via
  the Linear MCP. Use when first installing these skills into a repo, or to
  refresh the configs after the skill set or repo layout changes. Also emits a
  committed `.claude/skills.lock` inventory of installed skill versions, and ensures
  the preflight skill's `.preflight-summary.json` scratch output is gitignored.
  Idempotent and safe to re-run: it reconciles drift rather than clobbering
  deliberate manual edits, presents a dry-run diff first, and only writes after
  confirmation — preserving each config's key order and formatting so a no-op run
  leaves files byte-identical.
license: MIT
compatibility: >-
  Requires the `git` CLI (base-branch and issue-key detection) and Node.js ≥22
  for the bundled scripts (Node built-ins only — no npm deps, no build step). The
  Linear team name and workspace slug come from the Linear MCP server when
  available, else are flagged for manual input; everything else is still
  detected. Reads each skill's config.example.json for its key set. The GitHub
  App / token check is optional — it uses `gh` when authenticated, else falls
  back to a reminder.
metadata:
  version: 0.10.2
  author: Rob Easthope
allowed-tools: Read, Bash(node:*), Bash(git:*), Bash(gh:*), mcp__linear-server__list_teams, mcp__linear-server__get_team
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

## The `skills.lock` step

Alongside the config reconcile, this skill emits a committed **`.claude/skills.lock`**
at the repo root — a machine-readable inventory of which skill versions are installed
and where they came from:

```json
{ "source": "https://github.com/acme-skunkworks/agent-skills", "ref": "main",
  "skills": { "changelog": "1.2.0", "send-it": "2.1.3", "…": "…" } }
```

- **`skills`** — a full inventory of every installed bundle (including `preflight`
  and this skill), read from each `SKILL.md` `metadata.version`. Keys are sorted, so
  a re-run with no version changes is a **byte-stable no-op** (the file only rewrites
  when a version actually moves). The lock lives at the fixed `.claude/skills.lock`
  path regardless of where the bundles were vendored (`skills/`, `.claude/skills/`,
  `.agents/skills/`), and consumers **commit** it.
- **`source` / `ref`** — provenance the script cannot derive (skills.sh records
  nowhere where a consumer installed from). Supply them as `facts.lockSource` /
  `facts.lockRef` in the write step's stdin (see step 2); an existing lock's values
  are preserved when omitted. When neither is available the field is written as
  `null` and the report flags it (`source/ref not supplied`) — never fabricated.

This is the foundation for detecting which repos are behind — see
[Checking for updates](#checking-for-updates) below.

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

2. **Fill the facts.** For each `needs-manual-input` Linear key
   (`linearTeamName`, `linearWorkspaceSlug`), fetch the value via the Linear MCP
   when it is available — `mcp__linear-server__list_teams` for the team name, and
   the workspace slug from the team/organisation — otherwise ask the user. Collect
   these into a `facts` object. Also add the **lock provenance** here:
   `lockSource` (the source repo the skills were installed from — the
   agent-skills repo URL) and `lockRef` (the ref installed from; **default `main`**,
   the fleet convention, unless a tag/SHA was pinned). Skip either when an existing
   `.claude/skills.lock` already records it — its value is preserved.

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
   echo '{"facts":{"linearTeamName":"…","linearWorkspaceSlug":"…","lockSource":"https://github.com/acme-skunkworks/agent-skills","lockRef":"main"},"acceptDrift":{"changelog":["issueKeys"]}}' \
     | node <skills-dir>/initialise-skills/scripts/initialise.mjs --write --json
   ```

   Report what was written from the returned `totals`, plus the `gitignore` field
   (its `status` — `added`, `created`, `present`, or `negated`; the field is absent
   entirely when `preflight` isn't installed, as the `.gitignore` step is skipped)
   and the `lock` field (its `status` — `written`, `unchanged`, or `would-write`;
   `needsFacts: true` means `lockSource`/`lockRef` still need supplying).

5. **Confirm idempotency.** Run the dry run once more; every key should now be
   `unchanged` (apart from drifts you chose to keep and any still-missing manual
   values). When `preflight` is installed, `gitignore.status` should be `present`
   (or `negated`, if the repo deliberately un-ignores the file — also a stable
   no-op); when it isn't, the `.gitignore` step is skipped and there's no
   `gitignore` field to check. `lock.status` should be `unchanged`. This proves the
   configs, the `.gitignore`, and the `skills.lock` are stable and a future re-run
   is a no-op.

6. **GitHub App & token check.** If this repo will run the shared Claude workflows
   (`reusable-claude*.yml` and their caller stubs), the GitHub App must be installed
   and the `CLAUDE_CODE_OAUTH_TOKEN` repository Actions secret set — the workflows
   authenticate with it and fail on an empty token (A-646). The required secret is
   **`CLAUDE_CODE_OAUTH_TOKEN`, not `ANTHROPIC_API_KEY`**.

   Probe for the secret (best-effort — skip silently if `gh` is unavailable or
   unauthenticated; a repo that runs no Claude workflows needs neither). Run the
   listing and the name-check as **two separate steps** and read each result — do
   **not** collapse them into one `gh … | grep` pipe, which would report the same
   failure for a `gh` error and a genuine absence, hiding the can't-verify case:

   ```bash
   # step 1 — list the repo's Actions secrets; a non-zero exit here is "can't verify"
   gh secret list --repo <owner>/<repo> --app actions
   # step 2 — only when step 1 succeeded, check whether the name is in that output
   ```

   - **present** (step 1 succeeds and lists the name) → report OK; nothing to do.
   - **absent** (step 1 succeeds but the name is missing) → **warn** and remind the
     operator to run **`/install-github-app`**, which installs the App and adds the
     secret.
   - **can't verify** (step 1 itself errors — e.g. a `403` without repo-admin scope,
     or `gh` not installed) → surface it as "couldn't verify the token — please
     confirm `CLAUDE_CODE_OAUTH_TOKEN` is set manually", **never block or fail the
     run**. A can't-tell is not an absence.

   The App install itself can't be reliably introspected without the App's own token,
   so the secret's presence is the reliable proxy; the `/install-github-app` reminder
   covers installing the App and setting the secret together.

7. **Multi-bundle repos — one manual step.** If this repo itself ships several
   independently-versioned skill bundles, `send-it`'s `bundleVersioning` is **not**
   auto-written (it isn't in `send-it`'s `config.example.json` key set, so detection
   has nothing to populate). Add it to `send-it/config.json` by hand —
   `{ "root": "<bundle-dir>", "manifest": "package.json", "skillFile": "SKILL.md" }`
   — to enable the per-bundle version-bump check. Single-package repos skip this.

## Reviewing an existing config

To inspect what a repo's skills are currently configured with — without
reconciling or writing anything — run the read-only review:

```bash
node <skills-dir>/initialise-skills/scripts/initialise.mjs --review
```

For each installed skill it prints its full `config.json`: every key's current
value, its classification (`inferred` / `unchanged` / `drift` / `manual-kept` /
`needs-manual-input` / `unknown-kept` — see the table above), and a one-line
description of what the key is and where its value comes from, drawn from
[`references/detectable-keys.md`](references/detectable-keys.md). Keys a consumer
set that no skill template knows about show as `unknown-kept` (kept verbatim, no
description), and template keys not yet present in `config.json` show as
`— not set`, so the review is the whole picture rather than just the pending
diff a dry-run would show. The human text shows each key's `used by … —
<detection source>` line; the key's fallback default is carried in the `--json`
form only, to keep the human table readable. Add `--json` for the
machine-readable form (a `skills[]` array of `{ key, value, isSet, status,
usedBy, detectionSource, fallback }` entries, plus `totals`). It never writes to
disk and skips the `.gitignore` step.

## Changing a setting later

Once a consumer's `config.json` exists, **hand-editing it is a supported way to
change a setting** — you don't have to route every change through this skill. Open
`skills/<name>/config.json` (or wherever the bundle is vendored), change the value,
and save. It is a real file the consumer owns; the shared skills read it at runtime.

A manual edit like that **survives future `initialise-skills` re-runs**. On the next
run the reconcile classifies your value as `drift` — a real value that differs from
what detection would produce — and **keeps it**, reporting both the kept value and
the detected one (see the [status table](#how-it-decides-what-to-write) above). It is
never silently overwritten: drift is only replaced if you explicitly opt in for that
key (the per-key `acceptDrift` gate in step 3). So a deliberate manual edit and a
detected fact coexist — the tool reconciles the facts it can detect without clobbering
the ones you set by hand.

Prefer [`--set <skill>.<key>=<value>`](#setting-an-arbitrary-value) below when you
want the same change made through the tool — it validates the key against the
skill's `config.example.json` and preserves key order and formatting — but a direct
hand-edit is equally valid and equally safe.

## Setting an arbitrary value

Detection, the stdin `facts`, and `acceptDrift` between them cover every value the
script can derive or accept — but not a value you simply want to *choose* (a
non-default base branch, a bespoke changelog directory, a boolean toggle). For
those, `--set <skill>.<key>=<value>` writes an arbitrary value straight into a
named skill's `config.json`:

```bash
# dry-run first (default) — preview the change, write nothing
node <skills-dir>/initialise-skills/scripts/initialise.mjs \
  --set changelog.baseBranch=develop \
  --set changelog.affectedPackages=false

# re-run with --write to apply
node <skills-dir>/initialise-skills/scripts/initialise.mjs \
  --set changelog.baseBranch=develop --write
```

The flag is **repeatable** and the address is `<skill>.<key>` — the skill's bundle
directory name, then a top-level key. The value is parsed as JSON (`true` / `42` /
`["A"]` type correctly) and falls back to a bare string when it isn't valid JSON
(so `develop` stays `"develop"`). It is validated up front, before anything is
written: the skill must be installed, the key must exist in that skill's
`config.example.json` (unknown keys are **refused**, never silently created), and
the value's type must match that key's example placeholder (so a string can't land
in a boolean field). Any failure exits non-zero and touches nothing.

`--set` rides the normal reconcile — detection still runs and your values are
layered on top, winning over what a detector would produce for the same key — and
goes through the same merge/serialise path, so key order and formatting are
preserved and a re-run with the same value is a no-op. It is a write mode, so it
**cannot be combined with `--review`** (which is read-only). In the report a set
key shows as `set to <value> (was <old>)`.

## Flags

- `--dry-run` (default) — detect, merge and report; write nothing.
- `--write` — apply the reconcile to each skill's `config.json`.
- `--review` — **read-only.** Print every installed skill's full current config:
  each key's current value, its classification (the same six statuses), and a
  short description sourced from
  [`references/detectable-keys.md`](references/detectable-keys.md). Unlike the
  dry-run it shows the current value of every key — including `unknown-kept` keys
  no template knows about — so it is a complete picture, not just the pending
  diff. Writes nothing and skips the `.gitignore` step. See
  [Reviewing an existing config](#reviewing-an-existing-config).
- `--set <skill>.<key>=<value>` — **repeatable.** Write an arbitrary value into a
  named skill's `config.json` (a value detection wouldn't produce). The key must
  exist in that skill's `config.example.json` and the value's type must match its
  placeholder, else it's refused. Rides the normal reconcile (dry-run first;
  `--write` to apply) and overrides detection for that key. Cannot be combined with
  `--review`. See [Setting an arbitrary value](#setting-an-arbitrary-value).
- `--json` — emit the machine-readable report (parse this to drive steps 2–3, or
  to consume the `--review` snapshot); human text otherwise.
- `--repo-root <path>` — the host repo the detectors scan (default: cwd).
- `--skills-dir <path>` — where the sibling bundles live (default: auto-detected
  relative to this script).
- **stdin JSON** — `{ "facts": { … }, "acceptDrift": { "<skill>": ["<key>"] } }`,
  read when stdin is piped (not a TTY). Each `acceptDrift` key may be a **skill
  name** (`"changelog"`) or the **repo-relative config path**
  (`"skills/changelog/config.json"`); its value is an array of key names. `facts`
  also carries the lock provenance `lockSource` / `lockRef` (see step 2).

## Checking for updates

To see which installed skills are behind the source repo, run the bundled
`check-updates.mjs` against a checkout of the source (the consumer holds only its
old vendored copies, so the target versions come from the source):

```bash
node <skills-dir>/initialise-skills/scripts/check-updates.mjs \
  --source <path-to-agent-skills-checkout> [--ref <tag-or-sha>] [--json]
```

It diffs the consumer's `.claude/skills.lock` against the source's bundle versions —
at `--ref` (via `git show`) when given, else the source working tree — and prints
the per-skill bump list: `updates` (behind — the actionable list), plus `added`
(new upstream skills), `removed`, `downgrades` (consumer ahead), and `upToDate`.
`--lock <path>` targets a specific consumer's lock (default `<cwd>/.claude/skills.lock`),
so a fleet orchestrator can check any repo without changing directory. See
[`references/skills-lock.md`](references/skills-lock.md) for the lock schema.

## Safety

- **Dry-run first, write only after confirmation.** Nothing is written without an
  explicit `--write` pass gated on the user's go-ahead.
- **Never clobbers deliberate edits.** Drift is preserved unless you opt in per key.
- **No deletes, no reordering.** Existing keys keep their order; only changed keys
  are touched; consumer-added keys are left alone. A malformed existing
  `config.json` is skipped (reported, never overwritten).
- **The `.gitignore` edit is append-only.** One file touched outside a
  skill's `config.json` is the repo's root `.gitignore`, and only to append the
  `.preflight-summary.json` entry when it is missing — never reordering or removing
  existing lines, and a no-op once present.
- **The `skills.lock` write is deterministic and byte-stable.** The other file
  touched outside a `config.json` is `.claude/skills.lock`, fully regenerated with
  sorted keys and no timestamp — so it only rewrites when a version actually changes,
  and a no-op run leaves it byte-identical. It preserves an existing lock's
  `source`/`ref` and never fabricates them.
- **The GitHub App / token probe is read-only.** `gh secret list` returns secret
  **names only, never values**, and the skill makes **no** GitHub writes of any kind
  — on an absent or unverifiable secret it only ever prints a reminder.

## Prerequisites

- The skills whose configs you want populated are installed alongside this one.
- A git repository with an `origin` remote for full base-branch / issue-key
  detection (both degrade to sensible fallbacks when absent).
- The Linear MCP server for the team name / workspace slug (optional — those two
  keys are flagged for manual input without it).
- The `gh` CLI authenticated with repo-admin scope enables the GitHub App / token
  probe (step 6). Without that scope (or without `gh` at all) the probe can't read
  the secret list, so it degrades to a "couldn't verify — confirm
  `CLAUDE_CODE_OAUTH_TOKEN` manually" note — a can't-tell, never a failure. The
  textual `/install-github-app` reminder is the separate **absent** outcome, emitted
  only when the probe *succeeds* and finds the secret genuinely missing. Either way
  the skill still runs fully.
