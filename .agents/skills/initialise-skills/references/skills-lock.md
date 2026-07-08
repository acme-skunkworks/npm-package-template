# `skills.lock` — installed-version inventory + update detection

`initialise-skills` writes a committed **`.claude/skills.lock`** at the consumer
repo root: a machine-readable record of which skill versions are installed and
where they came from. It is the foundation for cross-repo update visibility — the
data the `check-updates.mjs` diff tool (and a fleet-update orchestrator) reads to
decide which repos are behind.

## Schema

```json
{
  "source": "https://github.com/acme-skunkworks/agent-skills",
  "ref": "main",
  "skills": {
    "changelog": "0.9.1",
    "send-it": "0.6.1",
    "…": "…"
  }
}
```

| Field | Meaning |
| --- | --- |
| `source` | The source repo the skills were installed from. Provenance the script can't derive, so it is **supplied explicitly** as `facts.lockSource`. `null` until supplied. |
| `ref` | The git ref installed from — `main` by convention, or a pinned tag/SHA. Supplied as `facts.lockRef`. `null` until supplied. |
| `skills` | Every installed bundle → its version, read from each `SKILL.md` `metadata.version` (package.json `version` fallback). A full inventory, including `preflight` and `initialise-skills`. Keys are sorted; a version that can't be read is recorded as `null`. |

### Why provenance is explicit, not derived

skills.sh records nowhere where a consumer installed from (the CLI has no `--ref`
flag; installs track the source's default branch), and this reconciler is generic
and shippable — it must not hardcode or guess the source URL. So `source`/`ref` are
supplied by the orchestration as stdin `facts`, exactly like the Linear team
name / workspace slug the script already can't detect. An existing lock's values
are **preserved** when a re-run omits the facts, so re-running without re-supplying
them is a clean no-op rather than a wipe.

### Determinism

The lock is fully regenerated each run — sorted keys, 2-space JSON, trailing
newline, **no timestamp** — so an unchanged run leaves it byte-identical and it
only rewrites when a version actually moves. This matches the byte-stable-on-no-op
promise the config and `.gitignore` reconciles already keep.

## Detecting updates — `check-updates.mjs`

A consumer holds only its old vendored copies, so the *target* (upstream) versions
must come from a checkout of the source repo:

```bash
node scripts/check-updates.mjs --source <agent-skills-checkout> [--ref <tag-or-sha>] \
  [--lock <path>] [--json]
```

- **`--source <path>`** (required) — a local checkout of the source agent-skills repo.
- **`--ref <ref>`** — read each target version at this ref via `git show <ref>:skills/<name>/SKILL.md`; omit to read the source working tree.
- **`--lock <path>`** — the consumer lock to diff (default `<cwd>/.claude/skills.lock`), so a fleet orchestrator can check any repo without changing directory.
- **`--json`** — machine-readable report; human text otherwise.

It diffs the lock's `skills` against the target versions and partitions them:

| Field | Meaning |
| --- | --- |
| `updates` | `[{ name, from, to, bump }]` where the target is strictly newer (`bump` ∈ `major`/`minor`/`patch`) — the actionable upgrade list. |
| `upToDate` | Skills already at the target version. |
| `added` | `[{ name, version }]` present upstream but not in the lock (a new skill available to install). |
| `removed` | Skills in the lock but absent upstream. |
| `downgrades` | `[{ name, from, to }]` where the consumer is ahead of the target. |
| `unknown` | `[{ name, from, to }]` where a version couldn't be compared. |
| `updatesAvailable` | `true` when `updates` **or** `added` is non-empty — i.e. the consumer is behind on a locked skill or has yet to vendor a brand-new upstream one. |

Versions compare on the `major.minor.patch` release core (pre-release/build
metadata is ignored). A fleet-update orchestrator uses `updatesAvailable` to skip
already-current repos and `updates` to populate an update PR's body.

> **`updatesAvailable: false` is not the same as "nothing to report."** The flag
> reflects only the *forward-actionable* buckets (`updates` + `added`). A repo can
> have `updatesAvailable: false` yet still carry `removed`, `downgrades`, or
> `unknown` entries — surfaced as their own fields (and, in the human report, as
> their own lines) but deliberately not treated as an available update. A consumer
> that wants "is there anything at all to look at?" should inspect those fields too,
> not just `updatesAvailable`.
