---
title: "Catch up agent-skills shared bundles to HEAD"
release_note: ""
version:
created_at: "2026-08-05T13:47:54Z"
merged_at:
branch: a-1272-catch-up-agent-skills-npm-package-template
pr:
commit:
author: "rob@acmeskunkworks.io"
co_authors: []
category: chore
breaking: false
issues:
  - A-1272
affected_packages:
  - infrastructure
stats:
  files_changed:
  loc_added:
  loc_removed:
---

## Changed

**Re-vendor shared agent-skills to source `main` ([A-1272](https://linear.app/rheged-studio/issue/A-1272))**

- Wipe + re-copy shared skill bundles on `.claude` and `.agents` from `acme-skunkworks/agent-skills`
- Restore per-skill `config.json` (A-706) and reconcile via `initialise-skills`
- Land `triage-pr` human-envelope / review-wait / `deferNonBlocking` and `send-it.triage` where those skills are installed
- Preserve repo-local skills; keep Linear identity `Rheged Studio` / `rheged-studio`
