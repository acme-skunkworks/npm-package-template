# Monorepo config (changelog `affectedPackages`)

Changelog's `affected_packages` field is **opt-in**. Single-package repos leave
the gate off; monorepos turn it on. `initialise-skills` detects the shape and
reconciles the related keys — this note is the agent-facing flip guide.

## Keys

| Key | Role |
| --- | --- |
| `affectedPackages` | Gate. When `false` (default), `set-affected-packages` is a no-op and entries omit `affected_packages`. |
| `packageRoots` | Path prefixes that map `<root>/<name>/…` → package `<name>` when the gate is on. |
| `fallbackPackage` | Name used for paths that match no root (structural default `infrastructure`). |

Detection sources and fallbacks: [`detectable-keys.md`](detectable-keys.md).

## Single-package (default)

- Detector finds no workspace → `affectedPackages: false`.
- `packageRoots` stays the example placeholder `["apps", "packages", "services"]`
  and is reported **`unchanged`**, not `needs-manual-input` (A-813). The
  placeholder is unused at runtime while the gate is off.
- Leaving the placeholder (rather than writing `[]`) keeps the
  "ours equals base → infer" path open if the repo later gains a workspace.

## Monorepo

- `pnpm-workspace.yaml` `packages:` globs, or root `package.json` `workspaces`,
  or existing `apps` / `packages` / `services` dirs → non-empty `packageRoots`.
- `affectedPackages: true`; roots inferred from the tree.
- Changelog enrichment then writes `affected_packages` from the branch diff.

## Single → monorepo

1. Add a real workspace (`pnpm-workspace.yaml` or npm `workspaces`).
2. Re-run `/initialise-skills` (dry-run first).
3. **`packageRoots`:** if still the example placeholder, it **infers** the
   detected roots.
4. **`affectedPackages`:** a prior single-package run wrote the real value
   `false`. That is **drift** against a newly detected `true` (never-clobber).
   Opt in:

```bash
# Preview, then write — either accept the detected flip…
echo '{"acceptDrift":{"changelog":["affectedPackages"]}}' \
  | node <skills-dir>/initialise-skills/scripts/initialise.mjs --write

# …or set it explicitly:
node <skills-dir>/initialise-skills/scripts/initialise.mjs \
  --set changelog.affectedPackages=true --write
```

## Monorepo → single-package

Turn the gate off; roots may stay as documentation or be left alone — runtime
ignores them when the gate is off:

```bash
node <skills-dir>/initialise-skills/scripts/initialise.mjs \
  --set changelog.affectedPackages=false --write
```

## Intentional divergence

A repo may keep non-default `packageRoots` with `affectedPackages: false`
(e.g. this repo's dogfood `packageRoots: ["skills"]`). Detection may report
**drift**; drift is kept on purpose. Do not "fix" that pair to match unless
the operator opts in.
