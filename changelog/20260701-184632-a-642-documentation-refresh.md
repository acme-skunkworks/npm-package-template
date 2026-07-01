---
title: "Documentation refresh for the 2nd parity pass"
release_note:
created_at: "2026-07-01T18:46:32Z"
merged_at:
branch: "a-642-documentation-refresh"
pr:
commit:
merge_strategy:
author: "rob@acmeskunkworks.io"
co_authors: []
category: docs
breaking: false
issues: ["A-642", "A-238"]
stats:
  files_changed:
  loc_added:
  loc_removed:
---

## Changed

- Refreshed `CLAUDE.md`, `changelog/README.md`, `docs/TEMPLATE-BOOTSTRAP.md`, and
  `infrastructure/README.md` to the end state of the [A-637](https://linear.app/acme-skunkworks/issue/A-637) second parity pass:
  - CI callers documented at **v1.0.2** (`9febdb1`, was `9b7e7dc`).
  - The release workflow described as the thin **`pkg-release.yml`** caller of the
    shared `reusable-pkg-release.yml`, replacing the long inline `release.yml` prose
    while keeping the security model (OIDC Trusted Publishing, build-once/publish-exact
    artifact, branch-restricted `npm-release` environment, GitHub Packages mirror). The
    Trusted Publisher filename guidance is now `pkg-release.yml`; the workflow **name**
    stays `Release`. The `act` capability matrix and infra-scripts table updated to
    match, and `publish-via-raw-npm.sh` / `publish-to-github-packages.sh` are marked as
    CI-unused unit-tested reference (alongside the `ensure-*.sh` scripts).
  - The agent-skills **v1.1.0 generated-config** model: per-skill `config.json` is no
    longer committed (gitignored, materialised by `initialise-skills`); the generation
    checklist and skills section updated, plus the v1.1.0 behavioural changes (`send-it`
    release-type by semantic category, `preflight` `blockOnWarnings`, `changelog`
    branch-scoped add-links).
- Verified no lowercase `go/no-go` regressed (only the historical [A-437](https://linear.app/acme-skunkworks/issue/A-437) changelog entry
  retains it, intentionally) and that stale `release.yml` references remain only in the
  immutable dated changelog history.
- Folded in **[A-238](https://linear.app/acme-skunkworks/issue/A-238)**: added a "Decisions live in Linear, not ADRs" convention for the
  template and spawned repos, and the Open Source initiative catalogue note.
