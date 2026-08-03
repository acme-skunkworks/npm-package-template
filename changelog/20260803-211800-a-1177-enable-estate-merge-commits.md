---
title: 'Enable merge commits in initialise Trunk payload and re-vendor send-it'
release_note: ''
created_at: '2026-08-03T21:18:00Z'
merged_at:
branch: a-1177-enable-estate-merge-commits-keep-squash-allowed-for-release
pr:
commit:
author: rob@acmeskunkworks.io
co_authors: []
category: chore
breaking: false
issues:
  - A-1177
stats:
  files_changed:
  loc_added:
  loc_removed:
  commits:
---

## Changed

**Estate merge-commit cutover ([A-1177](https://linear.app/acme-skunkworks/issue/A-1177))**

- `initialise-package-repo` Trunk payload — `allowed_merge_methods: ["merge","squash"]`
- Re-vendor `send-it` **0.7.0** + refresh `AGENTS.md` (fan-outs paused, A-809)
