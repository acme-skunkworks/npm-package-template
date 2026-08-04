---
title: "Document dual merge policy for feature vs release PRs"
release_note:
version:
created_at: "2026-08-03T18:21:07Z"
merged_at:
branch: "a-1176-update-send-it-derive-bump-claudemd-adr-for-merge-commits"
pr:
commit:
author: "rob@acmeskunkworks.io"
co_authors: []
category: docs
breaking: false
issues: ["A-1176"]
stats:
  files_changed:
  loc_added:
  loc_removed:
  commits:
---

## Changed

- Document the dual merge policy in `CLAUDE.md`, `README.md`, and `ci.yml`
  comments: feature PRs land as merge commits (release-please ranks Conventional
  Commits on `main`, [A-824](https://linear.app/rheged-studio/issue/A-824)); release and fan-out PRs stay squash; Conventional
  PR titles remain required but are no longer the sole post-merge bump signal;
  commitlint / validate-commits remain the per-commit gate.
