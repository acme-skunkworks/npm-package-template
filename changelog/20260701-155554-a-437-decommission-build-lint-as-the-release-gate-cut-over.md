---
title: "Rename the CI gate check-run go/no-go → GO/NO GO"
release_note:
created_at: "2026-07-01T15:55:54Z"
merged_at:
branch: "a-437-decommission-build-lint-as-the-release-gate-cut-over-to-gono"
pr:
commit:
merge_strategy:
author: "hello@robeasthope.com"
co_authors: []
category: chore
breaking: false
issues: ["A-437"]
stats:
  files_changed:
  loc_added:
  loc_removed:
  commits:
---

## Changed

- The estate-canonical release gate check-run is now emitted as `GO/NO GO`
  (uppercase, space-separated) instead of the stale lowercase `go/no-go`, aligning
  the reference template with the rest of the fleet after the [A-542](https://linear.app/acme-skunkworks/issue/A-542) rename. The
  aggregator's `name:` and the describing prose in `CLAUDE.md` /
  `docs/TEMPLATE-BOOTSTRAP.md` were updated in step, and the template's own `main`
  ruleset (`Require GO/NO GO gate`) now requires `GO/NO GO`, pinned to the GitHub
  Actions integration.
- Retired the transitional [A-419](https://linear.app/acme-skunkworks/issue/A-419) dual-accept scaffolding (the notes about the
  orchestrator waiting on `🔬 Build & Lint`) now that the orchestrator polls
  `GO/NO GO` only ([A-596](https://linear.app/acme-skunkworks/issue/A-596) / [A-437](https://linear.app/acme-skunkworks/issue/A-437)). The `🔬 Build & Lint` job role was already gone
  from this template via the [A-447](https://linear.app/acme-skunkworks/issue/A-447) caller swap; this only removes the stale prose.
