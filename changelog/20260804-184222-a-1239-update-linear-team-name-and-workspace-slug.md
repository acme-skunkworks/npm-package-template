---
title: Update Linear team name and workspace slug
release_note: ""
created_at: "2026-08-04T18:42:22Z"
merged_at: ""
branch: a-1239-npm-package-template-update-linearteamname
pr:
commit: ""
author: rob@acmeskunkworks.io
co_authors: []
category: chore
breaking: false
issues:
  - A-1239
stats:
  files_changed:
  loc_added:
  loc_removed:
  commits:
---

## Changed

**Linear identity ([A-1239](https://linear.app/rheged-studio/issue/A-1239))** — point root `config.json` `linearWorkspaceSlug` at `rheged-studio`, regenerate local skill configs (gitignored in this template) with `linearTeamName: Rheged Studio` / `linearWorkspaceSlug: rheged-studio` via `initialise --set` on both mirrors, and rewrite stale `linear.app/acme-skunkworks` URLs across changelog entries.
