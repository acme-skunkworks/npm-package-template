---
title: "Adopt validate-commits as a required Conventional Commits check"
created_at: '2026-07-31T11:32:13Z'
category: chore
breaking: false
linear: [A-983]
prs: []
merged_at:
commit:
pr:
version:
stats:
  files_changed:
  loc_added:
  loc_removed:
  commits:
---

## Added

- Adopt validate-commits as a required Conventional Commits check

## Changed

- Required-status-check ruleset updated to enforce Conventional Commits on the
  PR commit range (additive to the existing PR-title gate where present).
