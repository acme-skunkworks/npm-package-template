---
title: "Add npm ecosystem to Dependabot with Conventional commit prefixes"
release_note:
version:
created_at: "2026-07-28T15:13:50Z"
merged_at:
branch: "a-980-dependabot-conventional-commit-templates"
pr:
commit:
author: "rob@acmeskunkworks.io"
co_authors: []
category: chore
breaking: false
issues: ["A-980"]
stats:
  files_changed:
  loc_added:
  loc_removed:
  commits:
---

## Added

- An `npm` package ecosystem in `.github/dependabot.yml`
  ([A-980](https://linear.app/acme-skunkworks/issue/A-980)), grouped weekly so one lockfile
  churn lands or reverts atomically. Its `commit-message` template sets `prefix`,
  `prefix-development` and `include: scope`, so bumps read `chore(deps): …` and
  `chore(deps-dev): …`. Setting both prefixes matters: `prefix` alone leaves
  development-dependency bumps on Dependabot's own default subject, which is not
  Conventional and would fail the commit gate once it becomes a required check.

## Notes

- The existing `github-actions` ecosystem is deliberately **unchanged**: its `prefix: "ci"`
  already produces `ci(deps): …`, which is Conventional, semantically accurate for workflow
  bumps, and consistent across the estate. `chore` is reserved for the npm ecosystem so the
  two remain distinguishable; both are no-release types, so neither cuts a version alone.
- Until now this repo had no npm ecosystem at all, so its dev toolchain was never bumped by
  Dependabot.
- Repos spawned from this template inherit the corrected config, so new repos start compliant.
