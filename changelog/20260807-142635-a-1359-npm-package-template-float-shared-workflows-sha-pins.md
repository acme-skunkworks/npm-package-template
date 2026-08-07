---
title: "Float shared-workflows SHA pins to @v1"
release_note: ""
version:
created_at: "2026-08-07T14:26:35Z"
merged_at:
branch: a-1359-npm-package-template-float-shared-workflows-sha-pins-to-v1
pr:
commit:
author: "rob@acmeskunkworks.io"
co_authors: []
category: chore
breaking: false
issues:
  - A-1359
stats:
  files_changed:
  loc_added:
  loc_removed:
---

## Changed

**Float shared-workflows reusable workflow pins to @v1 ([A-1359](https://linear.app/rheged-studio/issue/A-1359))**

- Point `validate-payload.yml` at `reusable-validate-payload.yml@v1` instead of a commit SHA
- Point `pkg-release.yml` changelog-enrich job at `reusable-changelog-enrich.yml@v1` instead of a commit SHA
