---
title: "Clear skill-config gitignore so spawned consumers can commit configs"
release_note: "initialise-package-repo now strips the template-seed skill config.json gitignore so spawned packages can commit runnable skill configs for CI and fresh clones (A-812)."
created_at: "2026-07-10T17:24:45Z"
merged_at:
branch: "a-812-fix-skill-config-gitignore-consumer-contract"
pr:
commit:
merge_strategy:
author: "rob@acmeskunkworks.io"
co_authors: []
category: fix
breaking: false
issues: ["A-812"]
stats:
  files_changed:
  loc_added:
  loc_removed:
---

## Fixed

- `/initialise-package-repo` strips `.claude/skills/*/config.json` and
  `.agents/skills/*/config.json` (and the accompanying comment) from `.gitignore`
  during post-generation setup, so `initialise-skills` can write **trackable**
  configs the consumer commits ([A-812](https://linear.app/acme-skunkworks/issue/A-812)).
- Corrected `CLAUDE.md` and the template `.gitignore` comment: resolved skill
  `config.json` is generated on install then **committed** in consumers; the
  ignore remains only as a template-seed guard so "Use this template" does not
  copy local configs.

## Changed

- Bumped the repo-local `initialise-package-repo` skill to `0.4.0` (both Claude
  Code and Cursor trees) with tests for the strip planner.
