---
title: "Drop the work-in-progress warning now the template is live"
release_note:
created_at: "2026-07-01T19:13:03Z"
merged_at:
branch: "a-324-enable-github-template-flag"
pr:
commit:
merge_strategy:
author: "rob@acmeskunkworks.io"
co_authors: []
category: docs
breaking: false
issues: ["A-324"]
stats:
  files_changed:
  loc_added:
  loc_removed:
---

## Changed

- Removed the "work in progress — not ready for use" warning from `README.md` now that
  the GitHub Template flag is enabled on the repo ([A-324](https://linear.app/acme-skunkworks/issue/A-324)). The README now describes the
  repo as a live template and points at the generation checklist in `CLAUDE.md`. This is
  the finisher for the [A-637](https://linear.app/acme-skunkworks/issue/A-637) second parity pass — the template is functionally ready and
  flipped on.
