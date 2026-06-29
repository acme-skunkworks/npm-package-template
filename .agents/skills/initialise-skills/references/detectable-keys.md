# Detectable config keys

The detector registry is keyed by config-**key name**, not by skill, so one
detector serves every skill that uses a key. A key found in a skill's
`config.example.json` with no entry here is reported `needs-manual-input`.

| Key | Used by | Detection source | Fallback / when undetectable |
| --- | --- | --- | --- |
| `baseBranch` | changelog, send-it | `git symbolic-ref refs/remotes/origin/HEAD`, stripped of `origin/` | `main` |
| `issueKeys` | changelog, cleanup-repo, linear-sync, triage-pr | Leading `<KEY>-<num>` (uppercased; single-letter keys like `A` accepted) from the **most recently committed** branch — `git for-each-ref --sort=-committerdate` — so a renamed team yields its current key, not the historical union; or supplied facts | `needs-manual-input` when no branches match |
| `linearTeamName` | cleanup-repo, linear-sync, triage-pr | Supplied via stdin `facts` (Linear MCP `list_teams`) | `needs-manual-input` |
| `linearWorkspaceSlug` | changelog | Supplied via stdin `facts` (Linear MCP) | `needs-manual-input` |
| `changelog` | send-it | `true` when the `changelog` skill is installed alongside or a `changelog/` directory exists; `false` when the repo has neither (no changelog flow) | `true` |
| `changelogDir` | changelog | Structural default | `changelog` |
| `packageRoots` | changelog | `pnpm-workspace.yaml` `packages:` globs → top dirs; else root `package.json` `workspaces` field | `["apps", "packages", "services"]` |
| `fallbackPackage` | changelog | Structural default | `infrastructure` |
| `affectedPackages` | changelog | `true` when a workspace config is detected (same signal as `packageRoots`); `false` otherwise — so single-package repos omit the redundant `affected_packages` field | `false` |
| `mainBranch` | cleanup-repo | Same as `baseBranch` (the detected default branch) | `main` |
| `protectedBranches` | cleanup-repo | Structural default | `["main"]` |
| `shippablePaths` | send-it | Root `package.json` `files` field (paths npm ships), else detected package roots | `[]` |
| `shippableManifestKeys` | send-it | Fixed | `["name", "version", "files", "publishConfig"]` |
| `bundleVersioning` | send-it | Present only when the repo ships multiple skill bundles (a `skills/`-style dir with ≥1 `SKILL.md` subdir) | omitted otherwise |
| `reviewBots` | triage-pr | Fixed | `["claude", "cursor", "coderabbitai"]` |
| `maxCiRounds` | triage-pr | Fixed | `5` |
| `followUpLabel` | triage-pr | Fixed (opt-in follow-up capture; empty = no label) | `""` |
| `followUpProject` | triage-pr | Fixed (opt-in follow-up capture; empty = no project) | `""` |
| `followUpState` | triage-pr | Fixed (opt-in follow-up capture; initial state for created issues) | `"Backlog"` |
| `workspaces` | preflight | n/a — preflight self-detects | never written |

## Notes and known limitations (v0.1.0)

- **`preflight` is skipped entirely.** It reads an optional root-level
  `preflight.config.json` and auto-detects base branch + workspaces, so an
  in-bundle `config.json` would never be read. The skip list lives in
  `scripts/lib/discover.mjs` (`SELF_CONFIGURING`). A future version could let a
  skill declare this in its `SKILL.md` metadata instead of hardcoding the name.
- **`bundleVersioning` is reconciled only if already present.** It isn't in
  send-it's `config.example.json` (the single-package template), so it is never
  *added* by detection — only kept (`unknown-kept`) where a consumer already set
  it. Multi-bundle consumers add it by hand.
- **`issueKeys` order is not drift.** Detected `["A"]` vs configured `["A"]`
  compares with set semantics (order-insensitive); the existing order is preserved
  on write to avoid churn.
- **`issueKeys` prefers the current key, not the historical union.** Detection reads
  the prefix of the most recently committed branch, so a repo whose Linear team was
  renamed (…→ASW→SK→A) yields `["A"]` rather than every prefix on stale branches
  (A-556). Pass `facts.issueKeys` to override when the heuristic is wrong (e.g. a
  fresh repo with no keyed branches, or one genuinely using several keys).
- **Structural defaults can read as a placeholder.** When an existing value equals
  both the example placeholder and the structural default, the key is `unchanged`
  (not flagged), because the detector emits that same default confidently.
