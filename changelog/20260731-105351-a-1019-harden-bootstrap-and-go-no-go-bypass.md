---
title: "Harden bootstrap publish + GO/NO GO road-runner-bot bypass"
release_note:
version:
created_at: "2026-07-31T10:53:51Z"
merged_at:
branch: "a-1019-harden-parent-package-templates-so-the-release-bootstrap"
pr:
commit:
author: "rob@acmeskunkworks.io"
co_authors: []
category: fix
breaking: false
issues: ["A-1019"]
stats:
  files_changed:
  loc_added:
  loc_removed:
---

## Fixed

- `initialise-package-repo` now provisions the `Require GO/NO GO gate` ruleset **with**
  the road-runner-bot bypass (`2195582`), and create-or-updates an existing ruleset that
  lacks it — matching Trunk bypass parity so `changelog-enrich` write-back to `main`
  is not rejected with `GH013` ([A-1019](https://linear.app/rheged-studio/issue/A-1019)).
- Bootstrap publish runbook, README OIDC checklist, and init skill `MANUAL_REMINDERS`
  now require creating the `v<initial>` git tag + GitHub release after the first
  `release:manual` publish, so release-please has a clean baseline and does not
  re-release the initial feature set as a spurious bump.

## Changed

- Docs (README / CLAUDE.md / skill SKILL + README) no longer say "No bot bypass" for
  GO/NO GO; they document the enricher bypass as required estate-wide for npm packages.
