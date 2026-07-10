---
title: "Pull shared skills once at scaffold time in initialise-package-repo"
release_note: "Spawned packages refresh the locked agent-skills set via npx skills add --copy during initialise-package-repo, instead of relying on a stale copied tree or the skills push fan-out."
created_at: "2026-07-10T09:25:33Z"
merged_at:
branch: "a-776-pull-skills-on-scaffold"
pr:
commit:
merge_strategy:
author: "rob@acmeskunkworks.io"
co_authors: []
category: feature
breaking: false
issues: ["A-776"]
stats:
  files_changed:
  loc_added:
  loc_removed:
---

## Added

- A **shared-skills pull** step in `initialise-package-repo` ([A-776](https://linear.app/acme-skunkworks/issue/A-776)): on `--write --files-only`
  it runs `npx skills add … --copy` for the locked set from `acme-skunkworks/agent-skills`
  into both Claude Code and Cursor trees, before `initialise-skills` generates configs.
  Dry-run reports `pending` with no network; the repo-local scaffolder is never in the pull
  set.
- Unit tests for argv construction (both agents, `--copy`, no `-g`) and the dry-run / write /
  error paths.

## Changed

- Documented pull-on-instantiation in the scaffolder SKILL/README (both mirrors), `CLAUDE.md`
  Template-propagation note, and the README spawned-repo checklist: committed skill bundles
  remain bootstrap only; this template stays out of the skills push fan-out ([A-774](https://linear.app/acme-skunkworks/issue/A-774)). Stripping
  committed bundles for a global install stays deferred to [A-790](https://linear.app/acme-skunkworks/issue/A-790) / [A-781](https://linear.app/acme-skunkworks/issue/A-781).
