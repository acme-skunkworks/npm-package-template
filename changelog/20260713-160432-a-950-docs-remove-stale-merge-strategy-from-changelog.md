---
title: "Remove stale merge_strategy from the changelog frontmatter schema docs"
release_note:
created_at: "2026-07-13T16:04:32Z"
merged_at:
branch: "a-950-docs-remove-stale-merge_strategy-from-changelog-frontmatter"
pr:
commit:
author: "rob@acmeskunkworks.io"
co_authors: []
category: docs
breaking: false
issues: ["A-950"]
stats:
  files_changed:
  loc_added:
  loc_removed:
---

## Changed

- Removed the `merge_strategy` field from the frontmatter schema block in
  `changelog/README.md`. The Simple changelog project dropped `merge_strategy`
  from the changelog contract ([A-802](https://linear.app/acme-skunkworks/issue/A-802))
  and the in-repo `changelog-core` model no longer records it, so the documented
  schema no longer advertises a field that repos scaffolded from this template
  would otherwise inherit as stale ([A-950](https://linear.app/acme-skunkworks/issue/A-950)).
